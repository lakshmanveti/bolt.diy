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

export function projectHasSupabaseBackend(files: FileMap): boolean {
  const sources = collectSource(files);

  if (sources.some((file) => file.path.includes('/supabase/migrations/'))) {
    return true;
  }

  return sources.some((file) => anyMatch(file.content, ALREADY_WIRED));
}

export function projectNeedsPersistence(files: FileMap): boolean {
  if (projectHasSupabaseBackend(files)) {
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
  'Keep the current UI. Add Supabase so this app\'s forms and CRUD data persist. Create SQL migrations, wire @supabase/supabase-js using the connected project, add RLS policies, and do not rebuild the app from scratch.';
