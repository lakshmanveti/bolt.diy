import type { Message } from 'ai';
import { createScopedLogger } from '~/utils/logger';
import type { ChatHistoryItem } from './useChatHistory';
import type { Snapshot } from './types';
import type { IChatMetadata } from './db';
import {
  getSupabaseClient,
  requireAuthUser,
  type ChatRow,
} from '~/lib/supabase/client';

const logger = createScopedLogger('SupabaseChatDB');

function rowToChat(row: ChatRow): ChatHistoryItem {
  return {
    id: row.id,
    urlId: row.url_id ?? undefined,
    description: row.description ?? undefined,
    messages: (row.messages as Message[]) || [],
    timestamp: row.timestamp,
    metadata: (row.metadata as IChatMetadata | undefined) ?? undefined,
  };
}

/** Remote sync only when a Supabase Auth user is signed in. */
async function getAuthedClient() {
  const supabase = getSupabaseClient();
  const user = await requireAuthUser();

  if (!supabase || !user) {
    return null;
  }

  return { supabase, user };
}

export async function supabaseGetAllChats(): Promise<ChatHistoryItem[] | null> {
  const ctx = await getAuthedClient();

  if (!ctx) {
    return null;
  }

  const { data, error } = await ctx.supabase
    .from('chats')
    .select('*')
    .eq('user_id', ctx.user.id)
    .order('updated_at', { ascending: false });

  if (error) {
    logger.error('Failed to list chats', error);
    throw error;
  }

  return (data as ChatRow[]).map(rowToChat);
}

export async function supabaseGetChat(id: string): Promise<ChatHistoryItem | null> {
  const ctx = await getAuthedClient();

  if (!ctx) {
    return null;
  }

  const byId = await ctx.supabase
    .from('chats')
    .select('*')
    .eq('user_id', ctx.user.id)
    .eq('id', id)
    .maybeSingle();

  if (byId.error) {
    logger.error('Failed to get chat by id', byId.error);
    throw byId.error;
  }

  if (byId.data) {
    return rowToChat(byId.data as ChatRow);
  }

  const byUrl = await ctx.supabase
    .from('chats')
    .select('*')
    .eq('user_id', ctx.user.id)
    .eq('url_id', id)
    .maybeSingle();

  if (byUrl.error) {
    logger.error('Failed to get chat by url_id', byUrl.error);
    throw byUrl.error;
  }

  return byUrl.data ? rowToChat(byUrl.data as ChatRow) : null;
}

export async function supabaseUpsertChat(
  id: string,
  messages: Message[],
  urlId?: string,
  description?: string,
  timestamp?: string,
  metadata?: IChatMetadata,
): Promise<void> {
  const ctx = await getAuthedClient();

  if (!ctx) {
    return;
  }

  if (timestamp && Number.isNaN(Date.parse(timestamp))) {
    throw new Error('Invalid timestamp');
  }

  const now = new Date().toISOString();

  const { error } = await ctx.supabase.from('chats').upsert(
    {
      id,
      user_id: ctx.user.id,
      owner_key: null,
      url_id: urlId ?? null,
      description: description ?? null,
      messages,
      metadata: metadata ?? null,
      timestamp: timestamp ?? now,
      updated_at: now,
    },
    { onConflict: 'id' },
  );

  if (error) {
    logger.error('Failed to upsert chat', error);
    throw error;
  }
}

export async function supabaseDeleteChat(id: string): Promise<void> {
  const ctx = await getAuthedClient();

  if (!ctx) {
    return;
  }

  const { error } = await ctx.supabase.from('chats').delete().eq('user_id', ctx.user.id).eq('id', id);

  if (error) {
    logger.error('Failed to delete chat', error);
    throw error;
  }
}

export async function supabaseGetSnapshot(chatId: string): Promise<Snapshot | undefined> {
  const ctx = await getAuthedClient();

  if (!ctx) {
    return undefined;
  }

  const { data, error } = await ctx.supabase
    .from('snapshots')
    .select('snapshot')
    .eq('user_id', ctx.user.id)
    .eq('chat_id', chatId)
    .maybeSingle();

  if (error) {
    logger.error('Failed to get snapshot', error);
    throw error;
  }

  return (data?.snapshot as Snapshot | undefined) ?? undefined;
}

export async function supabaseSetSnapshot(chatId: string, snapshot: Snapshot): Promise<void> {
  const ctx = await getAuthedClient();

  if (!ctx) {
    return;
  }

  const { error } = await ctx.supabase.from('snapshots').upsert(
    {
      chat_id: chatId,
      user_id: ctx.user.id,
      owner_key: null,
      snapshot,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'chat_id' },
  );

  if (error) {
    logger.error('Failed to upsert snapshot', error);
    throw error;
  }
}

export async function supabaseDeleteSnapshot(chatId: string): Promise<void> {
  const ctx = await getAuthedClient();

  if (!ctx) {
    return;
  }

  const { error } = await ctx.supabase.from('snapshots').delete().eq('user_id', ctx.user.id).eq('chat_id', chatId);

  if (error && error.code !== 'PGRST116') {
    logger.error('Failed to delete snapshot', error);
    throw error;
  }
}
