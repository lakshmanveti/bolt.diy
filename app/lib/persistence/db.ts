import type { Message } from 'ai';
import { createScopedLogger } from '~/utils/logger';
import type { ChatHistoryItem } from './useChatHistory';
import type { Snapshot } from './types';
import { isSupabaseConfigured } from '~/lib/supabase/client';
import {
  supabaseDeleteChat,
  supabaseDeleteSnapshot,
  supabaseGetAllChats,
  supabaseGetChat,
  supabaseGetNextId,
  supabaseGetSnapshot,
  supabaseSetSnapshot,
  supabaseUpsertChat,
} from './supabase-db';

export interface IChatMetadata {
  gitUrl: string;
  gitBranch?: string;
  netlifySiteId?: string;
}

const logger = createScopedLogger('ChatHistory');

async function cacheChatLocally(db: IDBDatabase, chat: ChatHistoryItem): Promise<void> {
  await idbSetMessages(db, chat.id, chat.messages, chat.urlId, chat.description, chat.timestamp, chat.metadata);
}

async function syncWarn(action: string, error: unknown) {
  logger.warn(`Supabase ${action} failed — IndexedDB kept as local cache`, error);
}

// this is used at the top level and never rejects
export async function openDatabase(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') {
    console.error('indexedDB is not available in this environment.');
    return undefined;
  }

  return new Promise((resolve) => {
    const request = indexedDB.open('boltHistory', 2);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('chats')) {
          const store = db.createObjectStore('chats', { keyPath: 'id' });
          store.createIndex('id', 'id', { unique: true });
          store.createIndex('urlId', 'urlId', { unique: true });
        }
      }

      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'chatId' });
        }
      }
    };

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event: Event) => {
      resolve(undefined);
      logger.error((event.target as IDBOpenDBRequest).error);
    };
  });
}

/**
 * One-time push of local IndexedDB chats into Supabase when remote is empty.
 * Safe to call on app boot.
 */
export async function migrateIndexedDbToSupabase(db: IDBDatabase): Promise<void> {
  if (!isSupabaseConfigured()) {
    return;
  }

  try {
    const remote = await supabaseGetAllChats();

    // null => not signed in or supabase unavailable — do not treat as empty remote
    if (remote === null) {
      return;
    }

    if (remote.length > 0) {
      return;
    }

    const local = await idbGetAll(db);

    for (const chat of local) {
      await supabaseUpsertChat(
        chat.id,
        chat.messages,
        chat.urlId,
        chat.description,
        chat.timestamp,
        chat.metadata,
      );

      const snapshot = await idbGetSnapshot(db, chat.id);

      if (snapshot) {
        await supabaseSetSnapshot(chat.id, snapshot);
      }
    }

    if (local.length > 0) {
      logger.info(`Migrated ${local.length} local chat(s) to Supabase for signed-in user`);
    }
  } catch (error) {
    syncWarn('migrate', error);
  }
}

async function idbGetAll(db: IDBDatabase): Promise<ChatHistoryItem[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result as ChatHistoryItem[]);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(db: IDBDatabase): Promise<ChatHistoryItem[]> {
  if (isSupabaseConfigured()) {
    try {
      const remote = await supabaseGetAllChats();

      if (remote) {
        for (const chat of remote) {
          await cacheChatLocally(db, chat);
        }

        return remote;
      }
    } catch (error) {
      syncWarn('getAll', error);
    }
  }

  return idbGetAll(db);
}

async function idbSetMessages(
  db: IDBDatabase,
  id: string,
  messages: Message[],
  urlId?: string,
  description?: string,
  timestamp?: string,
  metadata?: IChatMetadata,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readwrite');
    const store = transaction.objectStore('chats');

    if (timestamp && isNaN(Date.parse(timestamp))) {
      reject(new Error('Invalid timestamp'));
      return;
    }

    const request = store.put({
      id,
      messages,
      urlId,
      description,
      timestamp: timestamp ?? new Date().toISOString(),
      metadata,
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function setMessages(
  db: IDBDatabase,
  id: string,
  messages: Message[],
  urlId?: string,
  description?: string,
  timestamp?: string,
  metadata?: IChatMetadata,
): Promise<void> {
  await idbSetMessages(db, id, messages, urlId, description, timestamp, metadata);

  if (isSupabaseConfigured()) {
    try {
      await supabaseUpsertChat(id, messages, urlId, description, timestamp, metadata);
    } catch (error) {
      syncWarn('setMessages', error);
    }
  }
}

export async function getMessages(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  if (isSupabaseConfigured()) {
    try {
      const remote = await supabaseGetChat(id);

      if (remote) {
        await cacheChatLocally(db, remote);
        return remote;
      }
    } catch (error) {
      syncWarn('getMessages', error);
    }
  }

  return (await getMessagesById(db, id)) || (await getMessagesByUrlId(db, id));
}

export async function getMessagesByUrlId(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const index = store.index('urlId');
    const request = index.get(id);

    request.onsuccess = () => resolve(request.result as ChatHistoryItem);
    request.onerror = () => reject(request.error);
  });
}

export async function getMessagesById(db: IDBDatabase, id: string): Promise<ChatHistoryItem> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result as ChatHistoryItem);
    request.onerror = () => reject(request.error);
  });
}

async function idbDeleteById(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['chats', 'snapshots'], 'readwrite');
    const chatStore = transaction.objectStore('chats');
    const snapshotStore = transaction.objectStore('snapshots');

    const deleteChatRequest = chatStore.delete(id);
    const deleteSnapshotRequest = snapshotStore.delete(id);

    let chatDeleted = false;
    let snapshotDeleted = false;

    const checkCompletion = () => {
      if (chatDeleted && snapshotDeleted) {
        resolve(undefined);
      }
    };

    deleteChatRequest.onsuccess = () => {
      chatDeleted = true;
      checkCompletion();
    };
    deleteChatRequest.onerror = () => reject(deleteChatRequest.error);

    deleteSnapshotRequest.onsuccess = () => {
      snapshotDeleted = true;
      checkCompletion();
    };

    deleteSnapshotRequest.onerror = (event) => {
      if ((event.target as IDBRequest).error?.name === 'NotFoundError') {
        snapshotDeleted = true;
        checkCompletion();
      } else {
        reject(deleteSnapshotRequest.error);
      }
    };

    transaction.onerror = () => reject(transaction.error);
  });
}

export async function deleteById(db: IDBDatabase, id: string): Promise<void> {
  await idbDeleteById(db, id);

  if (isSupabaseConfigured()) {
    try {
      await supabaseDeleteChat(id);
    } catch (error) {
      syncWarn('deleteById', error);
    }
  }
}

export async function getNextId(db: IDBDatabase): Promise<string> {
  if (isSupabaseConfigured()) {
    try {
      const remoteNext = await supabaseGetNextId();
      const localNext = await idbGetNextId(db);
      const next = String(Math.max(Number(remoteNext || 0), Number(localNext || 0)));

      return next === '0' ? '1' : next;
    } catch (error) {
      syncWarn('getNextId', error);
    }
  }

  return idbGetNextId(db);
}

async function idbGetNextId(db: IDBDatabase): Promise<string> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const request = store.getAllKeys();

    request.onsuccess = () => {
      const highestId = request.result.reduce((cur, acc) => Math.max(+cur, +acc), 0);
      resolve(String(+highestId + 1));
    };

    request.onerror = () => reject(request.error);
  });
}

export async function getUrlId(db: IDBDatabase, id: string): Promise<string> {
  const idList = await getUrlIds(db);

  if (!idList.includes(id)) {
    return id;
  }

  let i = 2;

  while (idList.includes(`${id}-${i}`)) {
    i++;
  }

  return `${id}-${i}`;
}

async function getUrlIds(db: IDBDatabase): Promise<string[]> {
  if (isSupabaseConfigured()) {
    try {
      const remote = await supabaseGetAllChats();

      if (remote) {
        return remote.map((c) => c.urlId).filter((x): x is string => Boolean(x));
      }
    } catch (error) {
      syncWarn('getUrlIds', error);
    }
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction('chats', 'readonly');
    const store = transaction.objectStore('chats');
    const idList: string[] = [];

    const request = store.openCursor();

    request.onsuccess = (event: Event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;

      if (cursor) {
        idList.push(cursor.value.urlId);
        cursor.continue();
      } else {
        resolve(idList);
      }
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function forkChat(db: IDBDatabase, chatId: string, messageId: string): Promise<string> {
  const chat = await getMessages(db, chatId);

  if (!chat) {
    throw new Error('Chat not found');
  }

  const messageIndex = chat.messages.findIndex((msg) => msg.id === messageId);

  if (messageIndex === -1) {
    throw new Error('Message not found');
  }

  const messages = chat.messages.slice(0, messageIndex + 1);

  return createChatFromMessages(db, chat.description ? `${chat.description} (fork)` : 'Forked chat', messages);
}

export async function duplicateChat(db: IDBDatabase, id: string): Promise<string> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  return createChatFromMessages(db, `${chat.description || 'Chat'} (copy)`, chat.messages);
}

export async function createChatFromMessages(
  db: IDBDatabase,
  description: string,
  messages: Message[],
  metadata?: IChatMetadata,
): Promise<string> {
  const newId = await getNextId(db);
  const newUrlId = await getUrlId(db, newId);

  await setMessages(db, newId, messages, newUrlId, description, undefined, metadata);

  return newUrlId;
}

export async function updateChatDescription(db: IDBDatabase, id: string, description: string): Promise<void> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  if (!description.trim()) {
    throw new Error('Description cannot be empty');
  }

  await setMessages(db, id, chat.messages, chat.urlId, description, chat.timestamp, chat.metadata);
}

export async function updateChatMetadata(
  db: IDBDatabase,
  id: string,
  metadata: IChatMetadata | undefined,
): Promise<void> {
  const chat = await getMessages(db, id);

  if (!chat) {
    throw new Error('Chat not found');
  }

  await setMessages(db, id, chat.messages, chat.urlId, chat.description, chat.timestamp, metadata);
}

async function idbGetSnapshot(db: IDBDatabase, chatId: string): Promise<Snapshot | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readonly');
    const store = transaction.objectStore('snapshots');
    const request = store.get(chatId);

    request.onsuccess = () => resolve(request.result?.snapshot as Snapshot | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function getSnapshot(db: IDBDatabase, chatId: string): Promise<Snapshot | undefined> {
  if (isSupabaseConfigured()) {
    try {
      const remote = await supabaseGetSnapshot(chatId);

      if (remote) {
        await idbSetSnapshot(db, chatId, remote);
        return remote;
      }
    } catch (error) {
      syncWarn('getSnapshot', error);
    }
  }

  return idbGetSnapshot(db, chatId);
}

async function idbSetSnapshot(db: IDBDatabase, chatId: string, snapshot: Snapshot): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readwrite');
    const store = transaction.objectStore('snapshots');
    const request = store.put({ chatId, snapshot });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function setSnapshot(db: IDBDatabase, chatId: string, snapshot: Snapshot): Promise<void> {
  await idbSetSnapshot(db, chatId, snapshot);

  if (isSupabaseConfigured()) {
    try {
      await supabaseSetSnapshot(chatId, snapshot);
    } catch (error) {
      syncWarn('setSnapshot', error);
    }
  }
}

export async function deleteSnapshot(db: IDBDatabase, chatId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('snapshots', 'readwrite');
    const store = transaction.objectStore('snapshots');
    const request = store.delete(chatId);

    request.onsuccess = () => resolve();

    request.onerror = (event) => {
      if ((event.target as IDBRequest).error?.name === 'NotFoundError') {
        resolve();
      } else {
        reject(request.error);
      }
    };
  });

  if (isSupabaseConfigured()) {
    try {
      await supabaseDeleteSnapshot(chatId);
    } catch (error) {
      syncWarn('deleteSnapshot', error);
    }
  }
}
