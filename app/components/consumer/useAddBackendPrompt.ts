import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { supabaseConnection } from '~/lib/stores/supabase';
import { chatId } from '~/lib/persistence/useChatHistory';
import { dockerPreviewBusy } from '~/lib/runtime';
import {
  projectHasSourceFiles,
  projectHasSupabaseBackend,
  projectNeedsPersistence,
  ADD_BACKEND_FOLLOWUP,
} from '~/lib/backend/needs-persistence';
import { openSettingsTab } from '~/lib/stores/settings-modal';

type PromptStatus = 'dismissed' | 'completed';

function statusKey(chat: string | undefined) {
  return `bl.add-backend:${chat || 'default'}`;
}

function eligibleKey(chat: string | undefined) {
  return `bl.add-backend-eligible:${chat || 'default'}`;
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function readStatus(chat: string | undefined): PromptStatus | null {
  const value = readSession(statusKey(chat));
  return value === 'dismissed' || value === 'completed' ? value : null;
}

function readEligible(chat: string | undefined): boolean | null {
  // Only persist a positive match. "no" was locking the prompt out when files
  // landed after the first preview-ready snapshot (common after a preview flush).
  return readSession(eligibleKey(chat)) === 'yes' ? true : null;
}

export function useAddBackendPrompt(isStreaming: boolean) {
  const files = useStore(workbenchStore.files);
  const previews = useStore(workbenchStore.previews);
  const previewBusy = useStore(dockerPreviewBusy);
  const connection = useStore(supabaseConnection);
  const currentChatId = useStore(chatId);
  const [status, setStatus] = useState<PromptStatus | null>(null);
  const [eligible, setEligible] = useState<boolean | null>(null);

  const previewReady = previews.some((preview) => preview.ready && Boolean(preview.baseUrl));
  const alreadyWired = useMemo(() => projectHasSupabaseBackend(files), [files]);
  const hasSources = useMemo(() => projectHasSourceFiles(files), [files]);
  const connected = Boolean(connection.token && connection.selectedProjectId);

  useEffect(() => {
    setStatus(readStatus(currentChatId));
    setEligible(readEligible(currentChatId));
  }, [currentChatId]);

  useEffect(() => {
    if (eligible === true || isStreaming || previewBusy || !previewReady || !hasSources || alreadyWired) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (!projectNeedsPersistence(files)) {
        return;
      }

      writeSession(eligibleKey(currentChatId), 'yes');
      setEligible(true);
    }, 800);

    return () => window.clearTimeout(timer);
  }, [alreadyWired, currentChatId, eligible, files, hasSources, isStreaming, previewBusy, previewReady]);

  const visible =
    eligible === true &&
    status !== 'dismissed' &&
    status !== 'completed' &&
    !isStreaming &&
    previewReady &&
    !alreadyWired;

  const dismiss = useCallback(() => {
    writeSession(statusKey(currentChatId), 'dismissed');
    setStatus('dismissed');
  }, [currentChatId]);

  const complete = useCallback(() => {
    writeSession(statusKey(currentChatId), 'completed');
    setStatus('completed');
  }, [currentChatId]);

  const openConnect = useCallback(() => {
    openSettingsTab('supabase', { from: 'integrations' });
  }, []);

  return {
    visible,
    connected,
    dismiss,
    complete,
    followup: ADD_BACKEND_FOLLOWUP,
    openConnect,
  };
}
