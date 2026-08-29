import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { useState, useEffect, useCallback } from 'react';
import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { type JSONValue, type Message } from 'ai';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { logStore } from '~/lib/stores/logs'; // Import logStore
import {
  getMessages,
  getUrlId,
  openDatabase,
  setMessages,
  duplicateChat,
  createChatFromMessages,
  getSnapshot,
  setSnapshot,
  migrateIndexedDbToSupabase,
  type IChatMetadata,
} from './db';
import { authReadyStore, authUserStore, isSupabaseConfigured } from '~/lib/supabase/client';
import type { FileMap } from '~/lib/stores/files';
import type { Snapshot } from './types';
import { createChatId } from './chat-id';
import { getEffectiveExecutionTarget, getDockerRuntime, isDockerRuntimeAvailable } from '~/lib/runtime';
import { projectHasSupabaseBackend } from '~/lib/backend/needs-persistence';
import { syncSupabaseEnvToProject } from '~/lib/backend/sync-supabase-env';
import { recoverLiveChatSession, writeLiveChatSession } from './live-chat-session';

function isSyntheticSnapshotMessage(message: Message): boolean {
  const content = typeof message.content === 'string' ? message.content : '';

  if (
    message.annotations?.includes('no-store') &&
    (content.includes('Restore project from snapshot') ||
      content.includes('restored-project-setup') ||
      content.includes('restored your chat from a snapshot'))
  ) {
    return true;
  }

  return (
    content.includes('id="restored-project-setup"') ||
    (message.role === 'assistant' && content.includes('restored your chat from a snapshot'))
  );
}

function withoutSyntheticSnapshotMessages(messages: Message[]): Message[] {
  return messages.filter((message) => !isSyntheticSnapshotMessage(message));
}

async function waitForDockerRuntime(
  runtime: ReturnType<typeof getDockerRuntime>,
  timeoutMs: number,
): Promise<boolean> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (await runtime.checkHealth({ strict: true })) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return runtime.checkHealth({ strict: true });
}

export interface ChatHistoryItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
  metadata?: IChatMetadata;
}

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;

export const db = persistenceEnabled ? await openDatabase() : undefined;

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);
export const chatMetadata = atom<IChatMetadata | undefined>(undefined);
export function useChatHistory() {
  const navigate = useNavigate();
  const { id: mixedId } = useLoaderData<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const authReady = useStore(authReadyStore);
  const authUser = useStore(authUserStore);

  const recovered = mixedId ? recoverLiveChatSession(mixedId) : undefined;
  const [archivedMessages, setArchivedMessages] = useState<Message[]>([]);
  const [initialMessages, setInitialMessages] = useState<Message[]>(
    () => withoutSyntheticSnapshotMessages(recovered?.messages ?? []),
  );
  const [ready, setReady] = useState<boolean>(() => !mixedId || Boolean(recovered?.streaming));
  const [urlId, setUrlId] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [interrupted, setInterrupted] = useState(() => Boolean(recovered?.streaming));
  const [loadGeneration, setLoadGeneration] = useState(0);

  useEffect(() => {
    if (!db) {
      setReady(true);

      if (persistenceEnabled) {
        const error = new Error('Chat persistence is unavailable');
        logStore.logError('Chat persistence initialization failed', error);
        toast.error('Chat persistence is unavailable');
      }

      return;
    }

    // Wait for auth hydration so we don't miss Supabase reads on first paint
    if (isSupabaseConfigured() && !authReady) {
      if (!mixedId) {
        setReady(true);
      }

      return;
    }

    if (isSupabaseConfigured() && authUser) {
      void migrateIndexedDbToSupabase(db);
    }

    if (mixedId) {
      const load = Promise.all([
        getMessages(db, mixedId),
        getSnapshot(db, mixedId),
      ]);
      const timeout = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('Timed out loading chat')), 8000);
      });

      Promise.race([load, timeout])
        .then(async ([storedMessages, snapshot]) => {
          if (storedMessages && storedMessages.messages.length > 0) {
            /*
             * const snapshotStr = localStorage.getItem(`snapshot:${mixedId}`); // Remove localStorage usage
             * const snapshot: Snapshot = snapshotStr ? JSON.parse(snapshotStr) : { chatIndex: 0, files: {} }; // Use snapshot from DB
             */
            const validSnapshot = snapshot || { chatIndex: '', files: {} };

            const rewindId = searchParams.get('rewindTo');
            const rewindIdx = rewindId
              ? storedMessages.messages.findIndex((m) => m.id === rewindId)
              : -1;
            const endingIdx = rewindIdx >= 0 ? rewindIdx + 1 : storedMessages.messages.length;

            /*
             * Show the real conversation. Snapshot files hydrate Docker/editor
             * silently — do not replace chat with a "restored from snapshot" banner.
             */
            setArchivedMessages([]);

            const filteredMessages = withoutSyntheticSnapshotMessages(
              storedMessages.messages.slice(0, endingIdx),
            );

            if (validSnapshot.chatIndex || Object.keys(validSnapshot.files || {}).length > 0) {
              restoreSnapshot(mixedId, validSnapshot);
            }

            if (getEffectiveExecutionTarget() === 'docker') {
              try {
                chatId.set(storedMessages.id);
                const runtime = getDockerRuntime();
                const daemonReady =
                  isDockerRuntimeAvailable() || (await waitForDockerRuntime(runtime, 60_000));

                if (daemonReady) {
                  const resume = await runtime.resume(storedMessages.id);

                  if (resume.hasFiles) {
                    runtime.setHydrateSkipWrites(true);
                  } else {
                    for (const [filePath, value] of Object.entries(validSnapshot.files || {})) {
                      if (value?.type === 'file' && typeof value.content === 'string') {
                        await runtime.writeFile(filePath.replace(/^\/home\/project\//, ''), value.content);
                      }
                    }
                  }

                  const wroteEnv = await syncSupabaseEnvToProject().catch(() => false);
                  const files = workbenchStore.files.get();

                  if (wroteEnv || projectHasSupabaseBackend(files) || projectHasSupabaseBackend(validSnapshot.files || {})) {
                    await runtime.restartPreview({ ignoreHydrateSkip: true });
                  }
                } else {
                  console.warn('[ChatHistory] Runtime daemon did not become ready in time');
                }
              } catch (error) {
                console.warn('[ChatHistory] Docker resume failed', error);
              }
            }

            setInitialMessages(filteredMessages);
            setUrlId(storedMessages.urlId);
            description.set(storedMessages.description);
            chatId.set(storedMessages.id);
            chatMetadata.set(storedMessages.metadata);
          } else {
            const live = recoverLiveChatSession(mixedId);

            if (live?.messages.length) {
              setInitialMessages(withoutSyntheticSnapshotMessages(live.messages));
              chatId.set(live.chatId);
              setInterrupted(Boolean(live.streaming));
            } else if (initialMessages.length === 0) {
              setLoadError('This chat could not be loaded. Retry to try again.');
            }
          }

          setReady(true);
        })
        .catch((error) => {
          console.error(error);

          logStore.logError('Failed to load chat messages or snapshot', error);
          toast.error('Failed to load chat: ' + error.message);

          const live = recoverLiveChatSession(mixedId);

          if (live?.messages.length) {
            setInitialMessages(withoutSyntheticSnapshotMessages(live.messages));
            chatId.set(live.chatId);
            setInterrupted(true);
          } else {
            setLoadError(error instanceof Error ? error.message : 'Failed to load chat');
          }

          setReady(true);
        });
    } else {
      setReady(true);
    }
  }, [mixedId, db, navigate, searchParams, authReady, authUser?.id, loadGeneration]);

  const takeSnapshot = useCallback(
    async (chatIdx: string, files: FileMap, _chatId?: string | undefined, chatSummary?: string) => {
      const id = chatId.get();

      if (!id || !db) {
        return;
      }

      const snapshot: Snapshot = {
        chatIndex: chatIdx,
        files,
        summary: chatSummary,
      };

      // localStorage.setItem(`snapshot:${id}`, JSON.stringify(snapshot)); // Remove localStorage usage
      try {
        await setSnapshot(db, id, snapshot);
      } catch (error) {
        console.error('Failed to save snapshot:', error);
        toast.error('Failed to save chat snapshot.');
      }
    },
    [db],
  );

  const restoreSnapshot = useCallback(async (_id: string, snapshot?: Snapshot) => {
    // Docker owns project files on disk. Hydrate the in-memory editor/ZIP cache from the snapshot.
    const validSnapshot = snapshot || { chatIndex: '', files: {} };

    if (!validSnapshot?.files) {
      return;
    }

    const { workbenchStore } = await import('~/lib/stores/workbench');

    for (const [key, value] of Object.entries(validSnapshot.files)) {
      if (value?.type === 'file' && typeof value.content === 'string') {
        workbenchStore.hydrateFileFromSnapshot(key, value.content);
      }
    }
  }, []);

  return {
    ready: !mixedId || ready,
    initialMessages,
    interrupted,
    loadError,
    retryLoad: () => {
      const live = recoverLiveChatSession(mixedId);

      if (live?.messages.length) {
        setInitialMessages(withoutSyntheticSnapshotMessages(live.messages));
        chatId.set(live.chatId);
        setInterrupted(Boolean(live.streaming));
        setLoadError(undefined);
        setReady(true);
        return;
      }

      setLoadError(undefined);
      setReady(false);
      setLoadGeneration((n) => n + 1);
    },
    updateChatMestaData: async (metadata: IChatMetadata) => {
      const id = chatId.get();

      if (!db || !id) {
        return;
      }

      try {
        await setMessages(db, id, initialMessages, urlId, description.get(), undefined, metadata);
        chatMetadata.set(metadata);
      } catch (error) {
        toast.error('Failed to update chat metadata');
        console.error(error);
      }
    },
    storeMessageHistory: async (messages: Message[]) => {
      if (!db || messages.length === 0) {
        return;
      }

      const { firstArtifact } = workbenchStore;
      messages = messages.filter(
        (m) => !m.annotations?.includes('no-store') && !isSyntheticSnapshotMessage(m),
      );

      let _urlId = urlId;

      if (!urlId && firstArtifact?.id) {
        _urlId = await getUrlId(db, firstArtifact.id);
        setUrlId(_urlId);
      }

      let chatSummary: string | undefined = undefined;
      const lastMessage = messages[messages.length - 1];

      if (lastMessage.role === 'assistant') {
        const annotations = lastMessage.annotations as JSONValue[];
        const filteredAnnotations = (annotations?.filter(
          (annotation: JSONValue) =>
            annotation && typeof annotation === 'object' && Object.keys(annotation).includes('type'),
        ) || []) as { type: string; value: any } & { [key: string]: any }[];

        if (filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')) {
          chatSummary = filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')?.summary;
        }
      }

      takeSnapshot(messages[messages.length - 1].id, workbenchStore.files.get(), _urlId, chatSummary);

      if (!description.get() && firstArtifact?.title) {
        description.set(firstArtifact?.title);
      }

      if (initialMessages.length === 0 && !chatId.get()) {
        chatId.set(createChatId());
      }

      const finalChatId = chatId.get();

      if (!finalChatId) {
        console.error('Cannot save messages, chat ID is not set.');
        toast.error('Failed to save chat messages: Chat ID missing.');

        return;
      }

      writeLiveChatSession({
        chatId: finalChatId,
        urlId: _urlId,
        messages,
        streaming: true,
      });

      await setMessages(
        db,
        finalChatId,
        [...archivedMessages, ...messages],
        _urlId,
        description.get(),
        undefined,
        chatMetadata.get(),
      );
    },
    duplicateCurrentChat: async (listItemId: string) => {
      if (!db || (!mixedId && !listItemId)) {
        return;
      }

      try {
        const newId = await duplicateChat(db, mixedId || listItemId);
        const base = window.location.pathname.startsWith('/studio') ? '/studio/chat' : '/chat';
        navigate(`${base}/${newId}`);
        toast.success('Chat duplicated successfully');
      } catch (error) {
        toast.error('Failed to duplicate chat');
        console.log(error);
      }
    },
    importChat: async (description: string, messages: Message[], metadata?: IChatMetadata) => {
      if (!db) {
        return;
      }

      try {
        const newId = await createChatFromMessages(db, description, messages, metadata);
        const base = window.location.pathname.startsWith('/studio') ? '/studio/chat' : '/chat';
        window.location.href = `${base}/${newId}`;
        toast.success('Chat imported successfully');
      } catch (error) {
        if (error instanceof Error) {
          toast.error('Failed to import chat: ' + error.message);
        } else {
          toast.error('Failed to import chat');
        }
      }
    },
    exportChat: async (id = urlId) => {
      if (!db || !id) {
        return;
      }

      const chat = await getMessages(db, id);
      const chatData = {
        messages: chat.messages,
        description: chat.description,
        exportDate: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };
}
