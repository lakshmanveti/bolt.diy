import { memo, useMemo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { rehypePlugins, remarkPlugins, allowedHTMLElements } from '~/utils/markdown';
import { stripCodeFenceFromArtifact } from '~/components/chat/Markdown';
import ThoughtBox from '~/components/chat/ThoughtBox';
import styles from '~/components/chat/Markdown.module.scss';
import type { Message } from 'ai';
import type { ProviderInfo } from '~/types/model';

interface ConsumerMarkdownProps {
  children: string;
  html?: boolean;
  limitedMarkdown?: boolean;
  append?: (message: Message) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;
}

/**
 * Markdown for end users: artifacts become friendly build cards; raw code dumps are hidden.
 */
export const ConsumerMarkdown = memo(
  ({ children, html = false, limitedMarkdown = false, append, setChatMode, model, provider }: ConsumerMarkdownProps) => {
    const components = useMemo(() => {
      return {
        div: ({ className, children: divChildren, node, ...props }) => {
          if (className?.includes('__boltArtifact__')) {
            // Progress lives in the preview panel — keep chat free of build status noise.
            return null;
          }

          if (className?.includes('__boltThought__')) {
            return <ThoughtBox title="Thinking">{divChildren}</ThoughtBox>;
          }

          if (className?.includes('__boltSelectedElement__')) {
            return null;
          }

          if (className?.includes('__boltQuickAction__')) {
            return <div className="flex items-center gap-2 flex-wrap mt-3">{divChildren}</div>;
          }

          return (
            <div className={className} {...props}>
              {divChildren}
            </div>
          );
        },
        pre: () => (
          <div className="my-2 text-xs text-bolt-elements-textSecondary italic">Updated part of the app</div>
        ),
        button: ({ node, children: btnChildren, ...props }) => {
          const dataProps = node?.properties as Record<string, unknown>;

          if (
            dataProps?.class?.toString().includes('__boltQuickAction__') ||
            dataProps?.dataBoltQuickAction === 'true'
          ) {
            const type = dataProps['data-type'] || dataProps.dataType;
            const message = dataProps['data-message'] || dataProps.dataMessage;
            const href = dataProps['data-href'] || dataProps.dataHref;

            // Skip file-open actions in consumer mode
            if (type === 'file') {
              return null;
            }

            return (
              <button
                className="rounded-md justify-center px-3 py-1.5 text-xs bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent opacity-90 hover:opacity-100 flex items-center gap-2 cursor-pointer"
                {...props}
                onClick={() => {
                  if ((type === 'message' || type === 'implement') && append) {
                    if (type === 'implement' && setChatMode) {
                      setChatMode('build');
                    }

                    append({
                      id: `quick-action-${Date.now()}`,
                      content: [
                        {
                          type: 'text',
                          text: `[Model: ${model}]\n\n[Provider: ${provider?.name}]\n\n${message}`,
                        },
                      ] as any,
                      role: 'user',
                    });
                  } else if (type === 'link' && typeof href === 'string') {
                    try {
                      const url = new URL(href, window.location.origin);
                      window.open(url.toString(), '_blank', 'noopener,noreferrer');
                    } catch {
                      // ignore invalid urls
                    }
                  }
                }}
              >
                {btnChildren}
              </button>
            );
          }

          return <button {...props}>{btnChildren}</button>;
        },
      } satisfies Components;
    }, [append, model, provider, setChatMode]);

    return (
      <ReactMarkdown
        allowedElements={allowedHTMLElements}
        className={styles.MarkdownContent}
        components={components}
        remarkPlugins={remarkPlugins(limitedMarkdown)}
        rehypePlugins={rehypePlugins(html)}
      >
        {stripCodeFenceFromArtifact(children)}
      </ReactMarkdown>
    );
  },
);
