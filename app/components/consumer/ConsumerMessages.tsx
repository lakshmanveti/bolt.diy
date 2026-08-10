import type { Message } from 'ai';
import { Fragment, forwardRef, type ForwardedRef } from 'react';
import { classNames } from '~/utils/classNames';
import { UserMessage } from '~/components/chat/UserMessage';
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
  return content.replace(MODEL_REGEX, '').replace(PROVIDER_REGEX, '').trim();
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
  parts?: (TextUIPart | ReasoningUIPart | ToolInvocationUIPart | SourceUIPart | FileUIPart | StepStartUIPart)[];
}) {
  return (
    <div className="overflow-hidden w-full">
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
                  className={classNames('flex gap-4 py-3 w-full rounded-lg', {
                    'mt-3': index > 0,
                  })}
                >
                  <div className="grid grid-col-1 w-full">
                    {isUserMessage ? (
                      <UserMessage content={content} parts={parts} />
                    ) : (
                      <ConsumerAssistantMessage
                        content={typeof content === 'string' ? content : ''}
                        append={props.append}
                        chatMode={props.chatMode}
                        setChatMode={props.setChatMode}
                        model={props.model}
                        provider={props.provider}
                        parts={parts}
                      />
                    )}
                  </div>
                </div>
              );
            })
          : null}
        {isStreaming && (
          <div className="text-center w-full text-bolt-elements-item-contentAccent i-svg-spinners:3-dots-fade text-3xl mt-3" />
        )}
      </div>
    );
  },
);
