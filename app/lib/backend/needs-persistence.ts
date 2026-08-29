import type { FileMap } from '~/lib/stores/files';

const SOURCE_EXT = /\.(tsx|jsx|ts|js|mjs|cjs|vue)$/i;
const SKIP_PATH = /(?:^|\/)(?:node_modules|dist|build|\.git|coverage)(?:\/|$)|(?:package-lock|pnpm-lock|yarn\.lock)/i;

const ALREADY_WIRED = [
  /@supabase\/supabase-js/,
  /VITE_SUPABASE_URL/,
  /SUPABASE_ANON_KEY/,
  /from\s+['"]@supabase\//,
];

const FORM_SIGNALS = [/<form[\s>]/i, /\bonSubmit\s*=/, /handleSubmit\s*[:=]/, /type=["']submit["']/];

const CRUD_SIGNALS = [
  /\b(create|update|delete|remove|edit)\b.{0,40}\b(item|record|entry|todo|task|contact|booking|comment|post|user|product|inventory)\b/i,
  /\b(todo|todos|contacts|bookings|inventory|comments|crud)\b/i,
  /\b(addTodo|deleteTodo|updateTodo|addItem|removeItem|saveRecord)\b/,
];

const MOCK_DB_SIGNALS = [
  /JSON\.(parse|stringify)\s*\(\s*(?:window\.)?localStorage/,
  /(?:window\.)?localStorage\.(getItem|setItem).{0,80}JSON\.(parse|stringify)/,
  /JSON\.(parse|stringify).{0,80}(?:window\.)?localStorage/,
];

function isSourceFile(path: string): boolean {
  if (SKIP_PATH.test(path)) {
    return false;
  }

  return SOURCE_EXT.test(path);
}

function collectSource(files: FileMap): { path: string; content: string }[] {
  const sources: { path: string; content: string }[] = [];

  for (const [path, dirent] of Object.entries(files)) {
    if (dirent?.type !== 'file' || dirent.isBinary || !dirent.content) {
      continue;
    }

    if (!isSourceFile(path) && !path.includes('/supabase/migrations/')) {
      continue;
    }

    sources.push({ path, content: dirent.content });
  }

  return sources;
}

function anyMatch(content: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(content));
}

export function projectHasSourceFiles(files: FileMap): boolean {
  return collectSource(files).some((file) => isSourceFile(file.path));
}

export function projectHasSupabaseMigrations(files: FileMap): boolean {
  return collectSource(files).some(
    (file) => file.path.includes('/supabase/migrations/') && file.content.trim().length > 0,
  );
}

export function projectHasSupabaseClient(files: FileMap): boolean {
  return collectSource(files).some((file) => anyMatch(file.content, ALREADY_WIRED));
}

export function projectHasSupabaseBackend(files: FileMap): boolean {
  return projectHasSupabaseMigrations(files) || projectHasSupabaseClient(files);
}

export function isSupabaseMigrationPath(filePath: string | undefined): boolean {
  if (!filePath) {
    return false;
  }

  return /(?:^|\/)supabase\/migrations\/.+\.sql$/i.test(filePath.replaceAll('\\', '/'));
}

export function projectNeedsPersistence(files: FileMap): boolean {
  if (projectHasSupabaseMigrations(files)) {
    return false;
  }

  const sources = collectSource(files).filter((file) => isSourceFile(file.path));

  if (sources.length === 0) {
    return false;
  }

  const combined = sources.map((file) => file.content).join('\n');
  const hasForm = anyMatch(combined, FORM_SIGNALS);
  const hasCrud = anyMatch(combined, CRUD_SIGNALS);
  const hasMockDb = anyMatch(combined, MOCK_DB_SIGNALS);

  if (hasForm || hasCrud || hasMockDb) {
    return true;
  }

  return false;
}

export const ADD_BACKEND_FOLLOWUP =
  "Keep the current UI. Add Supabase so this app's forms and CRUD data persist. Use the VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY already in .env (do not invent placeholders or throw if they look missing). Create SQL migrations, wire @supabase/supabase-js, add RLS policies, and do not rebuild the app from scratch.";

function stripPromptMeta(text: string): string {
  return text
    .replace(/^\[Model:.*?\]\s*/gim, '')
    .replace(/^\[Provider:.*?\]\s*/gim, '')
    .trim();
}

export function isAddBackendRequest(text: string): boolean {
  const value = stripPromptMeta(text);

  if (!value) {
    return false;
  }

  if (value.includes('Add Supabase so this app')) {
    return true;
  }

  if (/\b(don'?t|do not|without|no)\b.{0,24}\b(backend|supabase)\b/i.test(value)) {
    return false;
  }

  const mentionsSupabase = /\bsupabase\b/i.test(value);
  const mentionsBackend = /\b(backend|database|persist(?:ence)?)\b/i.test(value);
  const integrateVerb = /\b(add|integrate|integration|connect|enable|setup|set\s+up|wire|use)\b/i.test(value);

  if (mentionsSupabase && integrateVerb) {
    return true;
  }

  return mentionsSupabase && mentionsBackend;
}

function addBackendStatusKey(chatId: string | undefined) {
  return `bl.add-backend:${chatId || 'default'}`;
}

export function markAddBackendRequested(chatId: string | undefined) {
  try {
    const key = addBackendStatusKey(chatId);
    const current = sessionStorage.getItem(key);

    if (current === 'completed') {
      return;
    }

    sessionStorage.setItem(key, 'requested');
  } catch {
    // ignore
  }
}

export function supabaseActionsAllowed(chatId: string | undefined, files: FileMap): boolean {
  if (projectHasSupabaseMigrations(files) || projectHasSupabaseClient(files)) {
    return true;
  }

  try {
    const status = sessionStorage.getItem(addBackendStatusKey(chatId));
    return status === 'requested' || status === 'completed';
  } catch {
    return false;
  }
}
