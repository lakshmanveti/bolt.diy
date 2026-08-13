import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { atom } from 'nanostores';
import { redirectToLogin } from '~/lib/supabase/auth-redirect';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('SupabaseAuth');
const OWNER_KEY_STORAGE = 'buildlive_owner_key';

export type ChatRow = {
  id: string;
  owner_key: string | null;
  user_id: string | null;
  url_id: string | null;
  description: string | null;
  messages: unknown;
  metadata: unknown | null;
  timestamp: string;
  updated_at: string;
};

export type SnapshotRow = {
  chat_id: string;
  owner_key: string | null;
  user_id: string | null;
  snapshot: unknown;
  updated_at: string;
};

let client: SupabaseClient | null | undefined;
let authListenerBound = false;

export const authUserStore = atom<User | null>(null);
export const authSessionStore = atom<Session | null>(null);
export const authReadyStore = atom(false);

export function isSupabaseConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return false;
  }

  const urlStr = String(url).trim();
  const keyStr = String(key).trim();

  if (!urlStr || !keyStr) {
    return false;
  }

  // Ignore leftover .env placeholders
  if (urlStr.includes('your_supabase') || keyStr.includes('your_supabase')) {
    return false;
  }

  return true;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) {
    return client;
  }

  if (typeof window === 'undefined' || !isSupabaseConfigured()) {
    client = null;
    return null;
  }

  client = createClient(String(import.meta.env.VITE_SUPABASE_URL), String(import.meta.env.VITE_SUPABASE_ANON_KEY), {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: localStorage,
    },
  });

  return client;
}

/** Call once from the client root to hydrate session + subscribe. */
export async function initSupabaseAuth(): Promise<void> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    authReadyStore.set(true);
    return;
  }

  if (!authListenerBound) {
    authListenerBound = true;
    supabase.auth.onAuthStateChange(async (event, session) => {
      authSessionStore.set(session);
      authUserStore.set(session?.user ?? null);

      if (event === 'SIGNED_IN' && session?.user) {
        try {
          await claimDeviceChats();
        } catch (error) {
          logger.warn('Failed to claim device chats', error);
        }
      }

      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        if (isSupabaseConfigured()) {
          redirectToLogin();
        }
      }
    });
  }

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    logger.warn('getSession failed', error);
  }

  authSessionStore.set(data.session ?? null);
  authUserStore.set(data.session?.user ?? null);
  authReadyStore.set(true);
}

export function getAuthUser(): User | null {
  return authUserStore.get();
}

export async function requireAuthUser(): Promise<User | null> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return null;
  }

  const existing = authUserStore.get();

  if (existing) {
    return existing;
  }

  const { data } = await supabase.auth.getUser();
  authUserStore.set(data.user ?? null);

  return data.user ?? null;
}

export async function signUpWithEmail(email: string, password: string) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error('Supabase is not configured');
  }

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    throw error;
  }

  return data;
}

export async function signInWithEmail(email: string, password: string) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error('Supabase is not configured');
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    throw error;
  }

  return data;
}

export async function signOut() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    return;
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    throw error;
  }
}

export async function sendPasswordRecoveryEmail(email?: string) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error('Supabase is not configured');
  }

  const target = email?.trim() || authUserStore.get()?.email;

  if (!target) {
    throw new Error('No email address on file');
  }

  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined;

  const { error } = await supabase.auth.resetPasswordForEmail(target, {
    redirectTo,
  });

  if (error) {
    throw error;
  }
}

export async function updatePassword(newPassword: string) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error('Supabase is not configured');
  }

  const trimmed = newPassword.trim();

  if (trimmed.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  const { data, error } = await supabase.auth.updateUser({ password: trimmed });

  if (error) {
    throw error;
  }

  if (data.user) {
    authUserStore.set(data.user);
  }

  return data;
}

/** Stable per-browser key used only to claim pre-auth rows into the logged-in user. */
export function getOwnerKey(): string {
  if (typeof localStorage === 'undefined') {
    return 'anonymous';
  }

  try {
    const existing = localStorage.getItem(OWNER_KEY_STORAGE);

    if (existing) {
      return existing;
    }

    const created =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `owner-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    localStorage.setItem(OWNER_KEY_STORAGE, created);

    return created;
  } catch {
    return 'anonymous';
  }
}

export async function claimDeviceChats(): Promise<number> {
  const supabase = getSupabaseClient();
  const user = await requireAuthUser();

  if (!supabase || !user) {
    return 0;
  }

  const ownerKey = getOwnerKey();
  const { data, error } = await supabase.rpc('claim_device_chats', { p_owner_key: ownerKey });

  if (error) {
    logger.warn('claim_device_chats failed', error);
    throw error;
  }

  return typeof data === 'number' ? data : 0;
}
