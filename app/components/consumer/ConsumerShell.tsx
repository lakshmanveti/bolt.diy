import type { JSONValue, Message } from 'ai';
import React, { type RefCallback, useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { Menu } from '~/components/sidebar/Menu.client';
import { classNames } from '~/utils/classNames';
import { PROVIDER_LIST } from '~/utils/constants';
import { APP_HERO_SUBTITLE, APP_HERO_TITLE } from '~/utils/brand';
import { BuildLiveLogo } from '~/components/ui/BuildLiveLogo';
import { openSidebar } from '~/lib/stores/sidebar';
import { AuthButton } from '~/components/auth/AuthButton';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';
import { onNewAppClick } from '~/lib/persistence/live-chat-session';
import { getApiKeysFromCookies } from '~/components/chat/APIKeyManager';
import { fetchModelList, invalidateModelList } from '~/lib/modules/llm/fetch-models';
import Cookies from 'js-cookie';
import { ChatBox } from '~/components/chat/ChatBox';
import { UserLlmPreferencesSetup } from '~/components/auth/UserLlmPreferencesSetup';
import { isSupabaseConfigured } from '~/lib/supabase/client';
import { userPreferencesStore } from '~/lib/supabase/user-preferences';
import { SupabaseChatAlert } from '~/components/chat/SupabaseAlert';
import DeployChatAlert from '~/components/deploy/DeployAlert';
import LlmErrorAlert from '~/components/chat/LLMApiAlert';
import type { ProgressAnnotation } from '~/types/context';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { ProviderInfo } from '~/types/model';
import type { DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import type { ActionAlert, SupabaseAlert, DeployAlert, LlmErrorAlertType } from '~/types/actions';
import { workbenchStore } from '~/lib/stores/workbench';
import {
  addBackendFollowupRequest,
  consumeAddBackendFollowup,
} from '~/lib/stores/settings-modal';
import { ConsumerMessages } from './ConsumerMessages';
import { AppPreview } from './AppPreview';
import { HeadlessBoltTerminal } from './HeadlessBoltTerminal.client';
import { AddBackendCard } from './AddBackendCard';
import { useAddBackendPrompt } from './useAddBackendPrompt';

const TEXTAREA_MIN_HEIGHT = 76;
const TEXTAREA_MAX_HEIGHT = 160;

export interface ConsumerShellProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement> | undefined;
  messageRef?: RefCallback<HTMLDivElement> | undefined;
  scrollRef?: RefCallback<HTMLDivElement> | undefined;
  showChat?: boolean;
  chatStarted?: boolean;
  isStreaming?: boolean;
  onStreamingChange?: (streaming: boolean) => void;
  messages?: Message[];
  description?: string;
  enhancingPrompt?: boolean;
  promptEnhanced?: boolean;
  input?: string;
  model?: string;
  setModel?: (model: string) => void;
  provider?: ProviderInfo;
  setProvider?: (provider: ProviderInfo) => void;
  providerList?: ProviderInfo[];
  handleStop?: () => void;
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
  handleInputChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  enhancePrompt?: () => void;
  importChat?: (description: string, messages: Message[]) => Promise<void>;
  exportChat?: () => void;
  uploadedFiles?: File[];
  setUploadedFiles?: (files: File[]) => void;
  imageDataList?: string[];
  setImageDataList?: (dataList: string[]) => void;
  actionAlert?: ActionAlert;
  clearAlert?: () => void;
  supabaseAlert?: SupabaseAlert;
  clearSupabaseAlert?: () => void;
  deployAlert?: DeployAlert;
  clearDeployAlert?: () => void;
  llmErrorAlert?: LlmErrorAlertType;
  clearLlmErrorAlert?: () => void;
  retryLlmError?: () => void;
  data?: JSONValue[] | undefined;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  append?: (message: Message) => void;
  designScheme?: DesignScheme;
  setDesignScheme?: (scheme: DesignScheme) => void;
  selectedElement?: ElementInfo | null;
  setSelectedElement?: (element: ElementInfo | null) => void;
  addToolResult?: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
  onWebSearchResult?: (result: string) => void;
  llmConfigReady?: boolean;
  userPreferencesReady?: boolean;
  onPreferencesSaved?: (prefs: import('~/lib/supabase/user-preferences').UserPreferences) => void;
  onApiKeysChange?: (providerName: string, apiKey: string) => void;
  apiKeys?: Record<string, string>;
}

export const ConsumerShell = React.forwardRef<HTMLDivElement, ConsumerShellProps>(
  (
    {
      textareaRef,
      showChat = true,
      chatStarted = false,
      isStreaming = false,
      onStreamingChange,
      model,
      setModel,
      provider,
      setProvider,
      providerList,
      input = '',
      enhancingPrompt,
      handleInputChange,
      enhancePrompt,
      sendMessage,
      handleStop,
      exportChat,
      uploadedFiles = [],
      setUploadedFiles,
      imageDataList = [],
      setImageDataList,
      messages,
      deployAlert,
      clearDeployAlert,
      supabaseAlert,
      clearSupabaseAlert,
      llmErrorAlert,
      clearLlmErrorAlert,
      retryLlmError,
      data,
      chatMode,
      setChatMode,
      append,
      designScheme,
      setDesignScheme,
      selectedElement,
      setSelectedElement,
      onWebSearchResult,
      llmConfigReady = true,
      userPreferencesReady = true,
      onPreferencesSaved,
      onApiKeysChange,
      apiKeys: apiKeysProp,
    },
    ref,
  ) => {
    const storedUserPreferences = useStore(userPreferencesStore);
    const [localApiKeys, setLocalApiKeys] = useState<Record<string, string>>(() =>
      isSupabaseConfigured() ? {} : getApiKeysFromCookies(),
    );
    const apiKeys = apiKeysProp ?? localApiKeys;
    const [modelList, setModelList] = useState<ModelInfo[]>([]);
    const [isModelSettingsCollapsed, setIsModelSettingsCollapsed] = useState(true);
    const [isListening, setIsListening] = useState(false);
    const [recognition, setRecognition] = useState<SpeechRecognition | null>(null);
    const [isModelLoading, setIsModelLoading] = useState<string | undefined>('all');
    const [progressAnnotations, setProgressAnnotations] = useState<ProgressAnnotation[]>([]);
    const [qrModalOpen, setQrModalOpen] = useState(false);
    const chatScrollRef = useRef<HTMLDivElement>(null);
    const stickToBottomRef = useRef(true);
    const [showJumpToLatest, setShowJumpToLatest] = useState(false);
    const addBackend = useAddBackendPrompt(Boolean(isStreaming));
    const followupRequested = useStore(addBackendFollowupRequest);

    const handleAddBackend = useCallback(() => {
      if (!addBackend.connected) {
        addBackend.openConnect();
        return;
      }

      sendMessage?.({} as any, addBackend.followup);
      addBackend.complete();
    }, [addBackend, sendMessage]);

    useEffect(() => {
      if (!followupRequested) {
        return;
      }

      consumeAddBackendFollowup();
      sendMessage?.({} as any, addBackend.followup);
      addBackend.complete();
    }, [addBackend, followupRequested, sendMessage]);

    const scrollChatToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
      const el = chatScrollRef.current;

      if (!el) {
        return;
      }

      el.scrollTo({ top: el.scrollHeight, behavior });
      stickToBottomRef.current = true;
      setShowJumpToLatest(false);
    }, []);

    const handleChatScroll = useCallback(() => {
      const el = chatScrollRef.current;

      if (!el) {
        return;
      }

      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      stickToBottomRef.current = nearBottom;
      setShowJumpToLatest(!nearBottom);
    }, []);

    useEffect(() => {
      workbenchStore.currentView.set('preview');
    }, []);

    useEffect(() => {
      if (data) {
        const progressList = data.filter(
          (x) => typeof x === 'object' && (x as any).type === 'progress',
        ) as ProgressAnnotation[];
        setProgressAnnotations(progressList);
      }
    }, [data]);

    useEffect(() => {
      onStreamingChange?.(isStreaming);
    }, [isStreaming, onStreamingChange]);

    useEffect(() => {
      if (typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)) {
        const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognitionInstance = new SpeechRecognitionAPI();
        recognitionInstance.continuous = true;
        recognitionInstance.interimResults = true;

        recognitionInstance.onresult = (event) => {
          const transcript = Array.from(event.results)
            .map((result) => result[0])
            .map((result) => result.transcript)
            .join('');

          if (handleInputChange) {
            handleInputChange({
              target: { value: transcript },
            } as React.ChangeEvent<HTMLTextAreaElement>);
          }
        };

        recognitionInstance.onerror = () => setIsListening(false);
        setRecognition(recognitionInstance);
      }
    }, []);

    useEffect(() => {
      if (apiKeysProp || !storedUserPreferences) {
        return;
      }

      setLocalApiKeys(storedUserPreferences.apiKeys);
    }, [apiKeysProp, storedUserPreferences]);

    useEffect(() => {
      if (apiKeysProp || isSupabaseConfigured() || typeof window === 'undefined') {
        return;
      }

      try {
        setLocalApiKeys(getApiKeysFromCookies());
      } catch {
        Cookies.remove('apiKeys');
      }
    }, [apiKeysProp]);

    useEffect(() => {
      if (!llmConfigReady || typeof window === 'undefined') {
        return;
      }

      let cancelled = false;

      setIsModelLoading('all');
      void fetchModelList()
        .then((list) => {
          if (!cancelled) {
            setModelList(list);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) {
            setIsModelLoading(undefined);
          }
        });

      return () => {
        cancelled = true;
      };
    }, [llmConfigReady]);

    const handleApiKeysChangeLocal = async (providerName: string, apiKey: string) => {
      if (apiKeys[providerName] === apiKey) {
        return;
      }

      const newApiKeys = { ...apiKeys, [providerName]: apiKey };

      if (!apiKeysProp) {
        setLocalApiKeys(newApiKeys);
        Cookies.set('apiKeys', JSON.stringify(newApiKeys));
      }

      onApiKeysChange?.(providerName, apiKey);
      setIsModelLoading(providerName);
      invalidateModelList(providerName);

      try {
        const list = await fetchModelList(providerName);
        setModelList((prev) => [...prev.filter((m) => m.provider !== providerName), ...list]);
      } catch {
        // ignore
      } finally {
        setIsModelLoading(undefined);
      }
    };

    const handleSendMessage = (event: React.UIEvent, messageInput?: string) => {
      sendMessage?.(event, messageInput);
      setSelectedElement?.(null);

      if (recognition) {
        recognition.abort();
        setIsListening(false);

        if (handleInputChange) {
          handleInputChange({ target: { value: '' } } as React.ChangeEvent<HTMLTextAreaElement>);
        }
      }
    };

    const handleFileUpload = () => {
      const inputEl = document.createElement('input');
      inputEl.type = 'file';
      inputEl.accept = 'image/*';
      inputEl.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];

        if (!file) {
          return;
        }

        const reader = new FileReader();
        reader.onload = (ev) => {
          setUploadedFiles?.([...uploadedFiles, file]);
          setImageDataList?.([...imageDataList, ev.target?.result as string]);
        };
        reader.readAsDataURL(file);
      };
      inputEl.click();
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;

      if (!items) {
        return;
      }

      for (const item of items) {
        if (!item.type.startsWith('image/')) {
          continue;
        }

        e.preventDefault();
        const file = item.getAsFile();

        if (!file) {
          break;
        }

        const reader = new FileReader();
        reader.onload = (ev) => {
          setUploadedFiles?.([...uploadedFiles, file]);
          setImageDataList?.([...imageDataList, ev.target?.result as string]);
        };
        reader.readAsDataURL(file);
        break;
      }
    };

    const activeSession = Boolean(chatStarted || isStreaming || (messages && messages.length > 0));
    const messageCount = messages?.length ?? 0;
    const lastMessageRole = messages?.[messageCount - 1]?.role;
    const latestUserPrompt = (() => {
      for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
        const message = messages![i];

        if (message.role !== 'user') {
          continue;
        }

        if (typeof message.content === 'string') {
          return message.content;
        }

        if (Array.isArray(message.content)) {
          const text = message.content
            .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
            .map((part: any) => part.text)
            .join(' ')
            .trim();

          if (text) {
            return text;
          }
        }
      }

      return undefined;
    })();

    // Always jump down when the user sends a message.
    useEffect(() => {
      if (!activeSession || lastMessageRole !== 'user') {
        return;
      }

      scrollChatToBottom('smooth');
    }, [activeSession, lastMessageRole, messageCount, scrollChatToBottom]);

    // Follow streaming / growing content while the user is near the bottom.
    useEffect(() => {
      if (!activeSession || !stickToBottomRef.current) {
        return;
      }

      scrollChatToBottom(isStreaming ? 'auto' : 'smooth');
    }, [messages, isStreaming, progressAnnotations, activeSession, addBackend.visible, scrollChatToBottom]);

    const composer = (
      <div className="flex flex-col gap-2 w-full">
        {(supabaseAlert || deployAlert || llmErrorAlert) && (
          <div className="flex flex-col gap-2">
            {deployAlert && (
              <DeployChatAlert
                alert={deployAlert}
                clearAlert={() => clearDeployAlert?.()}
                postMessage={(message) => {
                  sendMessage?.({} as any, message);
                  clearDeployAlert?.();
                }}
              />
            )}
            {supabaseAlert && (
              <SupabaseChatAlert
                alert={supabaseAlert}
                clearAlert={() => clearSupabaseAlert?.()}
                postMessage={(message) => {
                  sendMessage?.({} as any, message);
                  clearSupabaseAlert?.();
                }}
              />
            )}
            {llmErrorAlert && (
              <LlmErrorAlert
                alert={llmErrorAlert}
                clearAlert={() => clearLlmErrorAlert?.()}
                onRetry={retryLlmError}
              />
            )}
          </div>
        )}

        {!userPreferencesReady ? (
          <div
            className="mt-4 h-24 animate-pulse rounded-md bg-bolt-elements-background-depth-3"
            aria-busy="true"
            aria-label="Loading model preferences"
          />
        ) : !llmConfigReady ? (
          <UserLlmPreferencesSetup
            providerList={providerList || (PROVIDER_LIST as ProviderInfo[])}
            onSaved={(prefs) => onPreferencesSaved?.(prefs)}
          />
        ) : (
          <ChatBox
            isModelSettingsCollapsed={isModelSettingsCollapsed}
            setIsModelSettingsCollapsed={setIsModelSettingsCollapsed}
            provider={provider}
            providerList={providerList || (PROVIDER_LIST as ProviderInfo[])}
            modelList={modelList}
            apiKeys={apiKeys}
            isModelLoading={isModelLoading}
            onApiKeysChange={handleApiKeysChangeLocal}
            uploadedFiles={uploadedFiles}
            imageDataList={imageDataList}
            textareaRef={textareaRef}
            input={input}
            handlePaste={handlePaste}
            TEXTAREA_MIN_HEIGHT={TEXTAREA_MIN_HEIGHT}
            TEXTAREA_MAX_HEIGHT={TEXTAREA_MAX_HEIGHT}
            isStreaming={isStreaming}
            handleSendMessage={handleSendMessage}
            isListening={isListening}
            startListening={() => {
              recognition?.start();
              setIsListening(true);
            }}
            stopListening={() => {
              recognition?.stop();
              setIsListening(false);
            }}
            chatStarted={activeSession}
            exportChat={exportChat}
            qrModalOpen={qrModalOpen}
            setQrModalOpen={setQrModalOpen}
            handleFileUpload={handleFileUpload}
            setProvider={setProvider}
            model={model}
            setModel={setModel}
            setUploadedFiles={setUploadedFiles}
            setImageDataList={setImageDataList}
            handleInputChange={handleInputChange}
            handleStop={handleStop}
            enhancingPrompt={enhancingPrompt}
            enhancePrompt={enhancePrompt}
            onWebSearchResult={onWebSearchResult}
            chatMode={chatMode}
            setChatMode={setChatMode}
            designScheme={designScheme}
            setDesignScheme={setDesignScheme}
            selectedElement={selectedElement}
            setSelectedElement={setSelectedElement}
            toolbarMode="minimal"
            chatInputDisabled={!llmConfigReady}
          />
        )}
      </div>
    );

    return (
      <div
        ref={ref}
        className={classNames('relative flex h-full w-full overflow-hidden', !showChat && 'opacity-0')}
        data-consumer-shell
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>
        <ClientOnly>{() => <HeadlessBoltTerminal />}</ClientOnly>

        {/* Keep selectors present so Chat.client runAnimation does not hang */}
        <div id="intro" className="hidden" />
        <div id="examples" className="hidden" />

        <div className="flex flex-col lg:flex-row w-full h-full min-h-0">
          {/* Live app / build status — left on desktop */}
          {activeSession && (
            <div className="flex-1 min-w-0 h-[45vh] lg:h-full order-first lg:order-none border-b lg:border-b-0 lg:border-r border-bolt-elements-borderColor">
              <ClientOnly>
                {() => (
                  <AppPreview
                    annotations={progressAnnotations}
                    isStreaming={isStreaming}
                    setSelectedElement={setSelectedElement}
                    promptSummary={latestUserPrompt}
                  />
                )}
              </ClientOnly>
            </div>
          )}

          {/* Chat column — right on desktop; composer pinned to bottom */}
          <div
            className={classNames(
              'flex flex-col h-full min-h-0 bg-bolt-elements-background-depth-1',
              activeSession ? 'lg:w-[380px] xl:w-[420px] w-full shrink-0' : 'w-full',
            )}
          >
            <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 h-12 border-b border-bolt-elements-borderColor">
              <button
                type="button"
                onClick={openSidebar}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-accent-500/50 bg-bolt-elements-background-depth-2 text-accent-500 hover:bg-accent-500/10"
                aria-label="Open history"
                title="History"
              >
                <span className="i-ph:sidebar-simple h-4.5 w-4.5" />
              </button>
              <div className="min-w-0 flex-1">
                {activeSession ? (
                  <ClientOnly>
                    {() => (
                      <div className="truncate text-sm font-medium text-bolt-elements-textPrimary">
                        <ChatDescription />
                      </div>
                    )}
                  </ClientOnly>
                ) : null}
              </div>
              <a
                href="/"
                className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-2"
                title="New app"
                onClick={onNewAppClick}
              >
                <span className="i-ph:plus h-3.5 w-3.5" />
                New
              </a>
              <ClientOnly>{() => <AuthButton layout="header" />}</ClientOnly>
            </div>

            {!activeSession ? (
              <div className="flex flex-1 flex-col min-h-0 overflow-y-auto px-4 sm:px-6">
                <div className="flex flex-col items-center text-center px-2 pt-[10vh] pb-8 w-full max-w-xl mx-auto">
                  <h1 className="text-3xl lg:text-5xl font-semibold tracking-tight text-bolt-elements-textPrimary mb-3">
                    {APP_HERO_TITLE}
                  </h1>
                  <p className="text-base text-bolt-elements-textSecondary mb-8 max-w-md leading-relaxed">
                    {APP_HERO_SUBTITLE}
                  </p>
                  <div className="w-full text-left">{composer}</div>
                  <div className="mt-8 flex justify-center">
                    <BuildLiveLogo size="hero" />
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div
                  ref={chatScrollRef}
                  onScroll={handleChatScroll}
                  className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 pt-4 pb-2 modern-scrollbar relative"
                >
                  <div className="flex flex-col w-full pb-2">
                    <ClientOnly>
                      {() => (
                        <ConsumerMessages
                          className="flex flex-col w-full z-1"
                          messages={messages}
                          isStreaming={isStreaming}
                          append={append}
                          chatMode={chatMode}
                          setChatMode={setChatMode}
                          provider={provider}
                          model={model}
                        />
                      )}
                    </ClientOnly>
                    {addBackend.visible ? (
                      <AddBackendCard
                        connected={addBackend.connected}
                        onPrimary={handleAddBackend}
                        onDismiss={addBackend.dismiss}
                      />
                    ) : null}
                  </div>

                  {showJumpToLatest && (
                    <button
                      type="button"
                      className="sticky z-20 bottom-2 left-0 right-0 mx-auto flex items-center gap-1.5 rounded-full border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-1.5 text-xs text-bolt-elements-textPrimary shadow-md"
                      onClick={() => scrollChatToBottom('smooth')}
                    >
                      Latest message
                      <span className="i-ph:arrow-down w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="shrink-0 border-t border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 px-3 sm:px-4 py-3">
                  {composer}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  },
);
