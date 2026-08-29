import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts } from '~/lib/hooks';
import { getDockerRuntime } from '~/lib/runtime';
import { chatId, description, markLiveChatStreaming, syncLiveChatUrl, useChatHistory, writeLiveChatSession, createChatId } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { getEnvBlockedLlmProviders, getEnvDefaultLlmModel, getEnvDefaultLlmProvider, isBlockedLlmProvider } from '~/lib/modules/llm/defaults';
import { authReadyStore, authSessionStore, authUserStore, isSupabaseConfigured } from '~/lib/supabase/client';
import { isHostedPlanActive, userSubscriptionStore } from '~/lib/billing/subscription';
import {
  chatLlmConfigReadyStore,
  evaluateChatLlmConfig,
  loadUserPreferences,
  saveUserPreferences,
  syncPreferencesToCookies,
  userPreferencesReadyStore,
  userPreferencesStore,
  type UserPreferences,
} from '~/lib/supabase/user-preferences';
import { providersStore, updateProviderSettings } from '~/lib/stores/settings';
import { DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import { ConsumerShell } from '~/components/consumer/ConsumerShell';
import { SessionRestoreLoader } from '~/components/consumer/SessionRestoreLoader';
import { consumerUiMode } from '~/lib/consumer/mode';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useLoaderData, useSearchParams } from '@remix-run/react';
import { createSampler } from '~/utils/sampler';
import { getTemplates, selectStarterTemplate } from '~/utils/selectStarterTemplate';
import {
  clearPendingAppTemplate,
  setPendingAppTemplateFromIntent,
  tryApplyCuratedStarter,
  useSaveAppTemplateOnPreview,
} from '~/lib/app-starters';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { filesToArtifacts } from '~/utils/fileUtils';
import { supabaseConnection } from '~/lib/stores/supabase';
import { defaultDesignScheme, type DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import type { TextUIPart, FileUIPart, Attachment } from '@ai-sdk/ui-utils';
import { useMCPStore } from '~/lib/stores/mcp';
import type { LlmErrorAlertType } from '~/types/actions';

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { id: mixedId } = useLoaderData<{ id?: string }>() ?? {};
  const { ready, initialMessages, interrupted, loadError, retryLoad, storeMessageHistory, importChat, exportChat } =
    useChatHistory();
  const title = useStore(description);

  if (mixedId && !ready) {
    return <SessionRestoreLoader error={loadError} onRetry={retryLoad} />;
  }

  return (
    <>
      {ready && (
        <ChatImpl
          key={mixedId ?? 'new'}
          description={title}
          initialMessages={initialMessages}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
          interrupted={interrupted}
        />
      )}
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: Message[];
    initialMessages: Message[];
    isLoading: boolean;
    parseMessages: (messages: Message[], isLoading: boolean) => void;
    storeMessageHistory: (messages: Message[]) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, parseMessages, storeMessageHistory } = options;

    // Clear restore-skip before parsing new turns so follow-up file writes actually hit Docker
    if (isLoading || messages.length > initialMessages.length) {
      getDockerRuntime().setHydrateSkipWrites(false);
    }

    if (isLoading) {
      getDockerRuntime().setStreamLocked(true);
    }

    parseMessages(messages, isLoading);

    const id = chatId.get();

    if (id && messages.length > 0) {
      writeLiveChatSession({ chatId: id, messages, streaming: isLoading });
    }

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  },
  50,
);

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
  interrupted?: boolean;
}

export const ChatImpl = memo(
  ({ description, initialMessages, storeMessageHistory, importChat, exportChat, interrupted }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading, setFakeLoading] = useState(false);

    useEffect(() => {
      if (interrupted) {
        workbenchStore.setReloadedMessages([]);
        return;
      }

      if (initialMessages.length > 0) {
        workbenchStore.setReloadedMessages(initialMessages.map((message) => message.id));
      }
      // Only on mount — mid-generate updates must not mark actions as already replayed.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (initialMessages.length > 0) {
        clearPendingAppTemplate();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const files = useStore(workbenchStore.files);
    const [designScheme, setDesignScheme] = useState<DesignScheme>(defaultDesignScheme);
    const actionAlert = useStore(workbenchStore.alert);
    const deployAlert = useStore(workbenchStore.deployAlert);
    const supabaseConn = useStore(supabaseConnection);
    const selectedProject = supabaseConn.stats?.projects?.find(
      (project) => project.id === supabaseConn.selectedProjectId,
    );
    const supabaseAlert = useStore(workbenchStore.supabaseAlert);
    const { activeProviders, promptId, autoSelectTemplate, contextOptimizationEnabled } = useSettings();
    const authReady = useStore(authReadyStore);
    const authUser = useStore(authUserStore);
    const authSession = useStore(authSessionStore);
    const userPreferencesReady = useStore(userPreferencesReadyStore);
    const chatLlmConfigReady = useStore(chatLlmConfigReadyStore);
    const storedUserPreferences = useStore(userPreferencesStore);
    const subscription = useStore(userSubscriptionStore);
    const [llmErrorAlert, setLlmErrorAlert] = useState<LlmErrorAlertType | undefined>(undefined);
    const [model, setModel] = useState('');
    const [provider, setProvider] = useState<ProviderInfo>(DEFAULT_PROVIDER as ProviderInfo);
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
    const appliedPreferencesKeyRef = useRef<string | null>(null);

    useEffect(() => {
      if (!isSupabaseConfigured()) {
        userPreferencesReadyStore.set(true);
        const savedModel = Cookies.get('selectedModel');
        const savedProvider = Cookies.get('selectedProvider');

        if (savedModel && savedProvider && !isBlockedLlmProvider(savedProvider)) {
          setModel(savedModel);
          const p = PROVIDER_LIST.find((x) => x.name === savedProvider);

          if (p) {
            setProvider(p as ProviderInfo);
          }
        }

        const storedApiKeys = Cookies.get('apiKeys');

        if (storedApiKeys) {
          try {
            setApiKeys(JSON.parse(storedApiKeys));
          } catch {
            Cookies.remove('apiKeys');
          }
        }

        chatLlmConfigReadyStore.set(Boolean(savedModel && savedProvider));
        return;
      }

      if (!authReady || !authUser) {
        return;
      }

      void loadUserPreferences();
    }, [authReady, authUser?.id]);

    useEffect(() => {
      void evaluateChatLlmConfig(userPreferencesStore.get());

      if (!isHostedPlanActive()) {
        return;
      }

      const envProvider = getEnvDefaultLlmProvider();
      const envModel = getEnvDefaultLlmModel();

      if (!storedUserPreferences?.provider && envProvider) {
        const matched = PROVIDER_LIST.find((p) => p.name === envProvider);

        if (matched) {
          setProvider(matched as ProviderInfo);
        }
      }

      if (!storedUserPreferences?.model && envModel) {
        setModel(envModel);
      }
    }, [subscription, storedUserPreferences]);

    useEffect(() => {
      if (!storedUserPreferences) {
        appliedPreferencesKeyRef.current = null;
        return;
      }

      const preferencesKey = JSON.stringify({
        provider: storedUserPreferences.provider,
        model: storedUserPreferences.model,
        apiKeys: storedUserPreferences.apiKeys,
        providerSettings: storedUserPreferences.providerSettings,
      });

      if (appliedPreferencesKeyRef.current === preferencesKey) {
        return;
      }

      appliedPreferencesKeyRef.current = preferencesKey;

      const matchedProvider = PROVIDER_LIST.find((p) => p.name === storedUserPreferences.provider);

      if (matchedProvider) {
        setProvider((current) => (current.name === matchedProvider.name ? current : (matchedProvider as ProviderInfo)));
      }

      setModel(storedUserPreferences.model);
      setApiKeys(storedUserPreferences.apiKeys);

      if (storedUserPreferences.providerSettings) {
        const currentProviders = providersStore.get();

        for (const [name, settings] of Object.entries(storedUserPreferences.providerSettings)) {
          const existing = currentProviders[name]?.settings;

          if (existing?.enabled === settings.enabled && existing?.baseUrl === settings.baseUrl) {
            continue;
          }

          updateProviderSettings(name, settings);
        }
      }
    }, [storedUserPreferences]);

    const persistPreferences = useCallback(
      debounce(async (prefs: UserPreferences) => {
        if (!isSupabaseConfigured() || !chatLlmConfigReady) {
          return;
        }

        try {
          const providerSettingsSnapshot = providersStore.get();
          const providerSettings: UserPreferences['providerSettings'] = {};

          for (const [name, entry] of Object.entries(providerSettingsSnapshot)) {
            providerSettings[name] = entry.settings;
          }

          const saved = await saveUserPreferences({
            ...prefs,
            providerSettings,
          });
          syncPreferencesToCookies(saved);
        } catch (error) {
          logger.warn('Failed to persist user preferences', error);
        }
      }, 800),
      [chatLlmConfigReady],
    );

    const handlePreferencesSaved = useCallback((prefs: UserPreferences) => {
      const matchedProvider = PROVIDER_LIST.find((p) => p.name === prefs.provider);

      if (matchedProvider) {
        setProvider(matchedProvider as ProviderInfo);
      }

      setModel(prefs.model);
      setApiKeys(prefs.apiKeys);
      syncPreferencesToCookies(prefs);
    }, []);
    const { showChat } = useStore(chatStore);
    const uiMode = useStore(consumerUiMode);
    const [animationScope, animate] = useAnimate();
    const [chatMode, setChatMode] = useState<'discuss' | 'build'>('build');
    const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
    const mcpSettings = useMCPStore((state) => state.settings);

    const {
      messages,
      isLoading,
      input,
      handleInputChange,
      setInput,
      stop,
      append,
      setMessages,
      reload,
      error,
      data: chatData,
      setData,
      addToolResult,
    } = useChat({
      api: '/api/chat',
      headers: authSession?.access_token
        ? { Authorization: `Bearer ${authSession.access_token}` }
        : undefined,
      body: {
        apiKeys,
        files,
        promptId,
        contextOptimization: contextOptimizationEnabled,
        chatMode,
        designScheme,
        supabase: {
          isConnected: supabaseConn.isConnected,
          hasSelectedProject: !!selectedProject,
          credentials: {
            supabaseUrl: supabaseConn?.credentials?.supabaseUrl,
            anonKey: supabaseConn?.credentials?.anonKey,
          },
        },
        maxLLMSteps: mcpSettings.maxLLMSteps,
      },
      sendExtraMessageFields: true,
      onError: (e) => {
        setFakeLoading(false);
        handleError(e, 'chat');
      },
      onFinish: (message, response) => {
        markLiveChatStreaming(false);
        const usage = response.usage;
        setData(undefined);

        if (usage) {
          console.log('Token usage:', usage);
          logStore.logProvider('Chat response completed', {
            component: 'Chat',
            action: 'response',
            model,
            provider: provider.name,
            usage,
            messageLength: message.content.length,
          });
        }

        logger.debug('Finished streaming');
      },
      initialMessages,
      initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    });
    useEffect(() => {
      const prompt = searchParams.get('prompt');

      // console.log(prompt, searchParams, model, provider);

      if (prompt) {
        setSearchParams({});
        runAnimation();
        append({
          role: 'user',
          content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
        });
      }
    }, [model, provider, searchParams]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages, resetParser } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    const parsedChatKey = useRef<string | undefined>();

    useEffect(() => {
      const key = initialMessages[0]?.id ?? 'new';

      if (parsedChatKey.current !== key) {
        parsedChatKey.current = key;
        resetParser();
      }

      processSampledMessages({
        messages,
        initialMessages,
        isLoading,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, parseMessages, resetParser, initialMessages]);

    const messagesRef = useRef(messages);
    messagesRef.current = messages;

    const wasStreamingRef = useRef(false);

    useEffect(() => {
      const streaming = isLoading || fakeLoading;

      if (streaming) {
        getDockerRuntime().setStreamLocked(true);
        markLiveChatStreaming(true);
      }

      if (wasStreamingRef.current && !streaming) {
        markLiveChatStreaming(false);

        const id = chatId.get();

        if (id) {
          syncLiveChatUrl(id);
        }

        window.setTimeout(() => {
          workbenchStore.schedulePreviewFlush();
        }, 300);
      }

      wasStreamingRef.current = streaming;
    }, [isLoading, fakeLoading]);

    useSaveAppTemplateOnPreview({ isLoading, fakeLoading });

    useEffect(() => {
      if (uiMode !== 'studio' || !interrupted || isLoading || fakeLoading) {
        return;
      }

      setLlmErrorAlert({
        type: 'warning',
        title: 'Generation interrupted',
        description: 'Your chat is still here. Retry to continue building the app.',
        errorType: 'network',
      });
    }, [interrupted, isLoading, fakeLoading, uiMode]);

    const retryGeneration = useCallback(() => {
      setLlmErrorAlert(undefined);
      workbenchStore.setReloadedMessages([]);
      getDockerRuntime().setHydrateSkipWrites(false);
      getDockerRuntime().setStreamLocked(true);
      markLiveChatStreaming(true);

      const current = messagesRef.current;
      let lastUserIndex = -1;

      for (let i = current.length - 1; i >= 0; i -= 1) {
        if (current[i]?.role === 'user') {
          lastUserIndex = i;
          break;
        }
      }

      if (lastUserIndex < 0) {
        toast.error('Nothing to retry');
        markLiveChatStreaming(false);
        return;
      }

      const next = current.slice(0, lastUserIndex + 1);
      setMessages(next);

      window.setTimeout(() => {
        void reload();
      }, 0);
    }, [reload, setMessages]);

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();
      window.setTimeout(() => {
        workbenchStore.schedulePreviewFlush();
      }, 300);

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    const handleError = useCallback(
      (error: any, context: 'chat' | 'template' | 'llmcall' = 'chat') => {
        logger.error(`${context} request failed`, error);

        stop();
        setFakeLoading(false);

        let errorInfo = {
          message: 'An unexpected error occurred',
          isRetryable: true,
          statusCode: 500,
          provider: provider.name,
          type: 'unknown' as const,
          retryDelay: 0,
        };

        if (error.message) {
          try {
            const parsed = JSON.parse(error.message);

            if (parsed.error || parsed.message) {
              errorInfo = { ...errorInfo, ...parsed };
            } else {
              errorInfo.message = error.message;
            }
          } catch {
            errorInfo.message = error.message;
          }
        }

        let errorType: LlmErrorAlertType['errorType'] = 'unknown';
        let title = 'Request Failed';

        if (errorInfo.statusCode === 401 || errorInfo.message.toLowerCase().includes('api key')) {
          errorType = 'authentication';
          title = 'Authentication Error';
        } else if (errorInfo.statusCode === 429 || errorInfo.message.toLowerCase().includes('rate limit')) {
          errorType = 'rate_limit';
          title = 'Rate Limit Exceeded';
        } else if (errorInfo.message.toLowerCase().includes('quota')) {
          errorType = 'quota';
          title = 'Quota Exceeded';
        } else if (errorInfo.statusCode >= 500) {
          errorType = 'network';
          title = 'Server Error';
        }

        logStore.logError(`${context} request failed`, error, {
          component: 'Chat',
          action: 'request',
          error: errorInfo.message,
          context,
          retryable: errorInfo.isRetryable,
          errorType,
          provider: provider.name,
        });

        // Create API error alert
        setLlmErrorAlert({
          type: 'error',
          title,
          description: errorInfo.message,
          provider: provider.name,
          errorType,
        });
        setData([]);
        window.setTimeout(() => {
          workbenchStore.schedulePreviewFlush();
        }, 300);
      },
      [provider.name, stop],
    );

    const clearApiErrorAlert = useCallback(() => {
      setLlmErrorAlert(undefined);
    }, []);

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      // Switch into conversation UI immediately — do not wait on DOM animations
      chatStore.setKey('started', true);
      setChatStarted(true);

      try {
        await Promise.all([
          animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
          animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
        ]);
      } catch {
        // Consumer shell (and some layouts) may not include #intro / #examples
      }
    };

    // Helper function to create message parts array from text and images
    const createMessageParts = (text: string, images: string[] = []): Array<TextUIPart | FileUIPart> => {
      // Create an array of properly typed message parts
      const parts: Array<TextUIPart | FileUIPart> = [
        {
          type: 'text',
          text,
        },
      ];

      // Add image parts if any
      images.forEach((imageData) => {
        // Extract correct MIME type from the data URL
        const mimeType = imageData.split(';')[0].split(':')[1] || 'image/jpeg';

        // Create file part according to AI SDK format
        parts.push({
          type: 'file',
          mimeType,
          data: imageData.replace(/^data:image\/[^;]+;base64,/, ''),
        });
      });

      return parts;
    };

    // Helper function to convert File[] to Attachment[] for AI SDK
    const filesToAttachments = async (files: File[]): Promise<Attachment[] | undefined> => {
      if (files.length === 0) {
        return undefined;
      }

      const attachments = await Promise.all(
        files.map(
          (file) =>
            new Promise<Attachment>((resolve) => {
              const reader = new FileReader();

              reader.onloadend = () => {
                resolve({
                  name: file.name,
                  contentType: file.type,
                  url: reader.result as string,
                });
              };
              reader.readAsDataURL(file);
            }),
        ),
      );

      return attachments;
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        return;
      }

      if (isSupabaseConfigured() && !chatLlmConfigReady) {
        toast.error('Save your model and API key before chatting');
        return;
      }

      if (!provider?.name || !model?.trim()) {
        toast.error('Select a provider and model first');
        return;
      }

      if (isLoading) {
        abort();
        return;
      }

      if (chatStarted) {
        clearPendingAppTemplate();
      }

      getDockerRuntime().setStreamLocked(true);
      markLiveChatStreaming(true);

      if (!chatId.get()) {
        chatId.set(createChatId());
      }

      await getDockerRuntime().ensureSession(chatId.get());

      let finalMessageContent = messageContent;

      if (selectedElement) {
        console.log('Selected Element:', selectedElement);

        const elementInfo = `<div class=\"__boltSelectedElement__\" data-element='${JSON.stringify(selectedElement)}'>${JSON.stringify(`${selectedElement.displayText}`)}</div>`;
        finalMessageContent = messageContent + elementInfo;
      }

      runAnimation();

      if (!chatStarted) {
        setFakeLoading(true);

        const finishFirstPromptUi = () => {
          setInput('');
          Cookies.remove(PROMPT_COOKIE_KEY);
          setUploadedFiles([]);
          setImageDataList([]);
          resetEnhancer();
          textareaRef.current?.blur();
          setFakeLoading(false);
        };

        const attempt = await tryApplyCuratedStarter({
          message: finalMessageContent,
          model,
          provider,
        }).catch((error) => {
          logger.warn('Curated starter reuse failed; using full generate', error);
          return null;
        });

        const reused = attempt?.applied;

        if (reused) {
          clearPendingAppTemplate();
          const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;
          const now = Date.now();

          if (reused.deltaUserMessage) {
            setMessages([
              {
                id: `1-${now}`,
                role: 'user',
                content: userMessageText,
                parts: createMessageParts(userMessageText, imageDataList),
              },
              {
                id: `2-${now}`,
                role: 'assistant',
                content: reused.assistantMessage,
              },
              {
                id: `3-${now}`,
                role: 'user',
                content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${reused.deltaUserMessage}`,
                annotations: ['hidden'],
              },
            ]);
          } else {
            setMessages([
              {
                id: `1-${now}`,
                role: 'user',
                content: userMessageText,
                parts: createMessageParts(userMessageText, imageDataList),
              },
              {
                id: `2-${now}`,
                role: 'assistant',
                content: reused.assistantMessage,
              },
              {
                id: `3-${now}`,
                role: 'user',
                content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\nKeep the current UI. Do not rebuild from scratch.`,
                annotations: ['hidden'],
              },
            ]);
          }

          const reloadOptions =
            uploadedFiles.length > 0
              ? { experimental_attachments: await filesToAttachments(uploadedFiles) }
              : undefined;

          reload(reloadOptions);
          finishFirstPromptUi();

          return;
        }

        setPendingAppTemplateFromIntent(attempt?.classification, finalMessageContent);

        if (autoSelectTemplate) {
          const { template, title } = await selectStarterTemplate({
            message: finalMessageContent,
            model,
            provider,
          });

          if (template !== 'blank') {
            const temResp = await getTemplates(template, title).catch(() => null);

            if (temResp) {
              const { assistantMessage, userMessage } = temResp;
              const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

              setMessages([
                {
                  id: `1-${new Date().getTime()}`,
                  role: 'user',
                  content: userMessageText,
                  parts: createMessageParts(userMessageText, imageDataList),
                },
                {
                  id: `2-${new Date().getTime()}`,
                  role: 'assistant',
                  content: assistantMessage,
                },
                {
                  id: `3-${new Date().getTime()}`,
                  role: 'user',
                  content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userMessage}`,
                  annotations: ['hidden'],
                },
              ]);

              const reloadOptions =
                uploadedFiles.length > 0
                  ? { experimental_attachments: await filesToAttachments(uploadedFiles) }
                  : undefined;

              reload(reloadOptions);
              setInput('');
              Cookies.remove(PROMPT_COOKIE_KEY);

              setUploadedFiles([]);
              setImageDataList([]);

              resetEnhancer();

              textareaRef.current?.blur();
              setFakeLoading(false);

              return;
            }
          }
        }

        // If autoSelectTemplate is disabled or template selection failed, proceed with normal message
        const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;
        const attachments = uploadedFiles.length > 0 ? await filesToAttachments(uploadedFiles) : undefined;

        setMessages([
          {
            id: `${new Date().getTime()}`,
            role: 'user',
            content: userMessageText,
            parts: createMessageParts(userMessageText, imageDataList),
            experimental_attachments: attachments,
          },
        ]);
        reload(attachments ? { experimental_attachments: attachments } : undefined);
        setFakeLoading(false);
        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);

        setUploadedFiles([]);
        setImageDataList([]);

        resetEnhancer();

        textareaRef.current?.blur();

        return;
      }

      if (error != null) {
        setMessages(messages.slice(0, -1));
      }

      const modifiedFiles = workbenchStore.getModifiedFiles();

      chatStore.setKey('aborted', false);

      if (modifiedFiles !== undefined) {
        const userUpdateArtifact = filesToArtifacts(modifiedFiles, `${Date.now()}`);
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userUpdateArtifact}${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );

        workbenchStore.resetAllFileModifications();
      } else {
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );
      }

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);

      setUploadedFiles([]);
      setImageDataList([]);

      resetEnhancer();

      textareaRef.current?.blur();
    };

    /**
     * Handles the change event for the textarea and updates the input state.
     * @param event - The change event from the textarea.
     */
    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleInputChange(event);
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    const handleModelChange = (newModel: string) => {
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });

      if (provider?.name) {
        persistPreferences({
          provider: provider.name,
          model: newModel,
          apiKeys,
        });
      }
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });

      if (model) {
        persistPreferences({
          provider: newProvider.name,
          model,
          apiKeys,
        });
      }
    };

    const handleApiKeysChange = (providerName: string, apiKey: string) => {
      if (apiKeys[providerName] === apiKey) {
        return;
      }

      const next = { ...apiKeys, [providerName]: apiKey };
      setApiKeys(next);
      Cookies.set('apiKeys', JSON.stringify(next), { expires: 30 });

      if (provider?.name && model) {
        persistPreferences({
          provider: provider.name,
          model,
          apiKeys: next,
        });
      }
    };

    const handleWebSearchResult = useCallback(
      (result: string) => {
        const currentInput = input || '';
        const newInput = currentInput.length > 0 ? `${result}\n\n${currentInput}` : result;

        // Update the input via the same mechanism as handleInputChange
        const syntheticEvent = {
          target: { value: newInput },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        handleInputChange(syntheticEvent);
      },
      [input, handleInputChange],
    );

    const Shell = uiMode === 'studio' ? BaseChat : ConsumerShell;

    return (
      <Shell
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading || fakeLoading}
        onStreamingChange={(streaming) => {
          streamingState.set(streaming);
        }}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        model={model}
        setModel={handleModelChange}
        provider={provider}
        setProvider={handleProviderChange}
        providerList={activeProviders}
        handleInputChange={(e) => {
          onTextareaChange(e);
          debouncedCachePrompt(e);
        }}
        handleStop={abort}
        description={description}
        importChat={importChat}
        exportChat={exportChat}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return {
            ...message,
            content: parsedMessages[i] || '',
          };
        })}
        enhancePrompt={() => {
          enhancePrompt(
            input,
            (input) => {
              setInput(input);
              scrollTextArea();
            },
            model,
            provider,
            apiKeys,
          );
        }}
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        imageDataList={imageDataList}
        setImageDataList={setImageDataList}
        actionAlert={actionAlert}
        clearAlert={() => workbenchStore.clearAlert()}
        supabaseAlert={supabaseAlert}
        clearSupabaseAlert={() => workbenchStore.clearSupabaseAlert()}
        deployAlert={deployAlert}
        clearDeployAlert={() => workbenchStore.clearDeployAlert()}
        llmErrorAlert={llmErrorAlert}
        clearLlmErrorAlert={clearApiErrorAlert}
        retryLlmError={retryGeneration}
        data={chatData}
        chatMode={chatMode}
        setChatMode={setChatMode}
        append={append}
        designScheme={designScheme}
        setDesignScheme={setDesignScheme}
        selectedElement={selectedElement}
        setSelectedElement={setSelectedElement}
        addToolResult={addToolResult}
        onWebSearchResult={handleWebSearchResult}
        llmConfigReady={chatLlmConfigReady}
        userPreferencesReady={userPreferencesReady}
        onPreferencesSaved={handlePreferencesSaved}
        onApiKeysChange={handleApiKeysChange}
        apiKeys={apiKeys}
      />
    );
  },
);
