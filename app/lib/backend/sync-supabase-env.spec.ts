import { describe, expect, it } from 'vitest';
import { mergeViteSupabaseEnv } from './sync-supabase-env';

describe('mergeViteSupabaseEnv', () => {
  it('appends keys when .env is empty', () => {
    expect(mergeViteSupabaseEnv('', 'https://proj.supabase.co', 'anon-key')).toBe(
      'VITE_SUPABASE_URL="https://proj.supabase.co"\nVITE_SUPABASE_ANON_KEY="anon-key"\n',
    );
  });

  it('replaces placeholders without dropping other keys', () => {
    const existing = 'VITE_API=1\nVITE_SUPABASE_URL=\nVITE_SUPABASE_ANON_KEY=changeme\n';

    expect(mergeViteSupabaseEnv(existing, 'https://proj.supabase.co', 'anon-key')).toBe(
      'VITE_API=1\nVITE_SUPABASE_URL="https://proj.supabase.co"\nVITE_SUPABASE_ANON_KEY="anon-key"\n',
    );
  });
});
