import { atom } from 'nanostores';
import type { Message } from 'ai';

const STORAGE_KEY = 'bl.live-chat';
const MAX_AGE_MS = 60 * 60 * 1000;

export type LiveChatSession = {
  chatId: string;
  urlId?: string;
  messages: Message[];
  streaming: boolean;
  updatedAt: number;
};

export const liveChatSession = atom<LiveChatSession | null>(null);

function isFresh(session: LiveChatSession, maxAge = MAX_AGE_MS): boolean {
  return Date.now() - session.updatedAt < maxAge;
}

function matchesId(session: LiveChatSession, id: string): boolean {
  return session.chatId === id || session.urlId === id;
}

function parseStored(): LiveChatSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as LiveChatSession;

    if (!parsed?.chatId || !Array.isArray(parsed.messages) || !isFresh(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function writeLiveChatSession(session: {
  chatId: string;
  urlId?: string;
  messages: Message[];
  streaming: boolean;
}): void {
  if (!session.chatId || session.messages.length === 0) {
    return;
  }

  const current = liveChatSession.get();
  const next: LiveChatSession = {
    chatId: session.chatId,
    urlId: session.urlId ?? current?.urlId,
    messages: session.messages,
    streaming: session.streaming,
    updatedAt: Date.now(),
  };

  liveChatSession.set(next);

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // quota / private mode — keep memory copy
  }
}

export function readLiveChatSession(chatId?: string): LiveChatSession | null {
  const fromMemory = liveChatSession.get();
  const stored = fromMemory && isFresh(fromMemory) ? fromMemory : parseStored();

  if (!stored) {
    return null;
  }

  liveChatSession.set(stored);

  if (chatId && !matchesId(stored, chatId)) {
    return null;
  }

  return stored;
}

/**
 * Recover chat after remount. Prefer an id match; otherwise use the only
 * recent in-flight session so a /chat/:urlId vs numeric chatId mismatch
 * does not dump the user into an empty loader.
 */
export function recoverLiveChatSession(chatId?: string): LiveChatSession | null {
  const matched = readLiveChatSession(chatId);

  if (matched) {
    return matched;
  }

  const any = readLiveChatSession();

  if (!any || !isFresh(any)) {
    return null;
  }

  if (chatId && !any.streaming) {
    return null;
  }

  return any;
}

export function markLiveChatStreaming(streaming: boolean): void {
  const current = liveChatSession.get() ?? parseStored();

  if (!current) {
    return;
  }

  writeLiveChatSession({
    chatId: current.chatId,
    urlId: current.urlId,
    messages: current.messages,
    streaming,
  });
}

export function syncLiveChatUrl(chatId: string): void {
  if (!chatId || typeof window === 'undefined') {
    return;
  }

  const path = window.location.pathname;
  const isStudio = path.startsWith('/studio');
  const expected = isStudio ? `/studio/chat/${chatId}` : `/chat/${chatId}`;

  if (path === expected || path.endsWith(`/chat/${chatId}`)) {
    return;
  }

  const url = new URL(window.location.href);
  url.pathname = expected;
  window.history.replaceState({}, '', url);
}

export function clearLiveChatSession(chatId?: string): void {
  const current = liveChatSession.get();

  if (chatId && current && current.chatId !== chatId && current.urlId !== chatId) {
    return;
  }

  liveChatSession.set(null);

  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
