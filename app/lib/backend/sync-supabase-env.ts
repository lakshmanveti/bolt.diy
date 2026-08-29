import { fetchProjectApiKeys, supabaseConnection } from '~/lib/stores/supabase';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';

const ENV_KEYS = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const;

function quoteEnvValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function mergeViteSupabaseEnv(existing: string, url: string, anonKey: string): string {
  const values: Record<(typeof ENV_KEYS)[number], string> = {
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_ANON_KEY: anonKey,
  };
  const seen = new Set<string>();
  const normalized = existing.replace(/\r\n/g, '\n');
  const lines = normalized.trim() === '' ? [] : normalized.split('\n');
  const next = lines.map((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);

    if (!match) {
      return line;
    }

    const key = match[1] as (typeof ENV_KEYS)[number];

    if (key in values) {
      seen.add(key);
      return `${key}=${quoteEnvValue(values[key])}`;
    }

    return line;
  });

  let inserted = false;

  for (const key of ENV_KEYS) {
    if (!seen.has(key)) {
      if (!inserted && next.length > 0 && next[next.length - 1] !== '') {
        next.push('');
      }

      inserted = true;
      next.push(`${key}=${quoteEnvValue(values[key])}`);
    }
  }

  return `${next.join('\n').replace(/\n+$/, '')}\n`;
}

function readProjectFile(relativePath: string): string {
  const fullPath = `${WORK_DIR}/${relativePath}`;
  const dirent = workbenchStore.files.get()[fullPath];

  if (dirent?.type !== 'file' || dirent.isBinary || !dirent.content) {
    return '';
  }

  return dirent.content;
}

async function writeProjectFile(relativePath: string, content: string): Promise<void> {
  const { getDockerRuntime } = await import('~/lib/runtime');
  await getDockerRuntime().writeFile(relativePath, content);
  workbenchStore.files.setKey(`${WORK_DIR}/${relativePath}`, {
    type: 'file',
    content,
    isBinary: false,
    isLocked: false,
  });
}

/**
 * Write connected-project keys into the generated app .env so Vite can see them.
 * Also patches .env.local when it already exists (it overrides .env).
 */
export async function syncSupabaseEnvToProject(): Promise<boolean> {
  const connection = supabaseConnection.get();
  let credentials = connection.credentials;

  if ((!credentials?.supabaseUrl || !credentials?.anonKey) && connection.selectedProjectId && connection.token) {
    try {
      await fetchProjectApiKeys(connection.selectedProjectId, connection.token);
      credentials = supabaseConnection.get().credentials;
    } catch {
      // keep going with whatever credentials we have
    }
  }

  const url = credentials?.supabaseUrl?.trim();
  const anonKey = credentials?.anonKey?.trim();

  if (!url || !anonKey) {
    return false;
  }

  let wrote = false;

  for (const fileName of ['.env', '.env.local'] as const) {
    const existing = readProjectFile(fileName);

    if (fileName === '.env.local' && !existing) {
      continue;
    }

    const next = mergeViteSupabaseEnv(existing, url, anonKey);

    if (next === existing) {
      continue;
    }

    await writeProjectFile(fileName, next);
    wrote = true;
  }

  return wrote;
}
