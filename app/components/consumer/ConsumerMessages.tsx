import type { Message } from 'ai';
import { Fragment, forwardRef, type ForwardedRef } from 'react';
import { classNames } from '~/utils/classNames';
import { MODEL_REGEX, PROVIDER_REGEX } from '~/utils/constants';
import { ConsumerMarkdown } from './ConsumerMarkdown';
import type { ProviderInfo } from '~/types/model';
import type {
  TextUIPart,
  ReasoningUIPart,
  ToolInvocationUIPart,
  SourceUIPart,
  FileUIPart,
  StepStartUIPart,
} from '@ai-sdk/ui-utils';
import { Markdown } from '~/components/chat/Markdown';

interface ConsumerMessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: Message[];
  append?: (message: Message) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;
}

function stripMetadata(content: string) {
  const artifactRegex = /<boltArtifact\s+[^>]*>[\s\S]*?<\/boltArtifact>/gm;
  return content.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, '').replace(artifactRegex, '').trim();
}

function extractUserText(content: Message['content']): string {
  if (typeof content === 'string') {
    return stripMetadata(content);
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
    .map((part: any) => stripMetadata(part.text))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function ConsumerUserBubble({
  content,
  parts,
}: {
  content: Message['content'];
  parts?: (TextUIPart | ReasoningUIPart | ToolInvocationUIPart | SourceUIPart | FileUIPart | StepStartUIPart)[];
}) {
  const text = extractUserText(content);
  const images =
    parts?.filter(
      (part): part is FileUIPart => part.type === 'file' && 'mimeType' in part && part.mimeType.startsWith('image/'),
    ) || [];

  return (
    <div className="ml-auto max-w-[92%] rounded-2xl rounded-br-md bg-accent-500/12 px-3.5 py-2.5 text-sm text-bolt-elements-textPrimary">
      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {images.map((item, index) => (
            <img
              key={index}
              src={`data:${item.mimeType};base64,${item.data}`}
              alt={`Attachment ${index + 1}`}
              className="max-h-40 rounded-lg object-cover"
            />
          ))}
        </div>
      )}
      {text ? <Markdown html>{text}</Markdown> : null}
    </div>
  );
}

function ConsumerAssistantMessage({
  content,
  append,
  chatMode,
  setChatMode,
  model,
  provider,
}: {
  content: string;
  append?: (message: Message) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;
}) {
  return (
    <div className="mr-auto max-w-[95%] text-sm text-bolt-elements-textPrimary">
      <ConsumerMarkdown
        append={append}
        chatMode={chatMode}
        setChatMode={setChatMode}
        model={model}
        provider={provider}
        html
      >
        {stripMetadata(content)}
      </ConsumerMarkdown>
    </div>
  );
}

export const ConsumerMessages = forwardRef<HTMLDivElement, ConsumerMessagesProps>(
  (props: ConsumerMessagesProps, ref: ForwardedRef<HTMLDivElement> | undefined) => {
    const { id, isStreaming = false, messages = [] } = props;

    return (
      <div id={id} className={props.className} ref={ref}>
        {messages.length > 0
          ? messages.map((message, index) => {
              const { role, content, parts } = message;
              const isUserMessage = role === 'user';
              const isHidden = message.annotations?.includes('hidden');

              if (isHidden) {
                return <Fragment key={index} />;
              }

              return (
                <div
                  key={index}
                  className={classNames('flex w-full', {
                    'mt-3': index > 0,
                    'justify-end': isUserMessage,
                    'justify-start': !isUserMessage,
                  })}
                >
                  {isUserMessage ? (
                    <ConsumerUserBubble content={content} parts={parts} />
                  ) : (
                    <ConsumerAssistantMessage
                      content={typeof content === 'string' ? content : ''}
                      append={props.append}
                      chatMode={props.chatMode}
                      setChatMode={props.setChatMode}
                      model={props.model}
                      provider={props.provider}
                    />
                  )}
                </div>
              );
            })
          : null}
        {isStreaming && (
          <div className="mt-3 text-bolt-elements-textTertiary i-svg-spinners:3-dots-fade text-2xl" />
        )}
      </div>
    );
  },
);
