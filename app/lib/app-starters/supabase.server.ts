import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type EnvMap = Record<string, string | undefined>;

function read(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed.includes('your_supabase')) {
    return undefined;
  }

  return trimmed;
}

export function getAppTemplatesSupabase(
  contextEnv?: EnvMap,
): SupabaseClient | null {
  const meta = import.meta.env as EnvMap;
  const url = read(
    contextEnv?.VITE_SUPABASE_URL || meta.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  );
  const service = read(contextEnv?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anon = read(
    contextEnv?.VITE_SUPABASE_ANON_KEY || meta.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY,
  );
  const key = service || anon;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
