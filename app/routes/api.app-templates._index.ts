import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAppTemplatesSupabase } from '~/lib/app-starters/supabase.server';
import { isValidCategorySlug, slugifyCategory } from '~/lib/app-starters/types';

type EnvMap = Record<string, string | undefined>;

function contextEnv(context: LoaderFunctionArgs['context'] | ActionFunctionArgs['context']): EnvMap {
  return (context.cloudflare?.env as EnvMap | undefined) || {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 16);
}

function asFileMap(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const files: Record<string, string> = {};

  for (const [path, content] of Object.entries(value as Record<string, unknown>)) {
    if (typeof path !== 'string' || typeof content !== 'string') {
      continue;
    }

    const normalized = path.replaceAll('\\', '/').replace(/^\/+/, '');

    if (!normalized || normalized.includes('..') || normalized.length > 240) {
      continue;
    }

    if (content.length > 200_000) {
      continue;
    }

    files[normalized] = content;

    if (Object.keys(files).length >= 120) {
      break;
    }
  }

  return files;
}

async function listTemplates(context: LoaderFunctionArgs['context'] | ActionFunctionArgs['context']) {
  const supabase = getAppTemplatesSupabase(contextEnv(context));

  if (!supabase) {
    return json({ templates: [], reason: 'not_configured' });
  }

  const { data, error } = await supabase
    .from('app_templates')
    .select('category, title, description, keywords')
    .order('updated_at', { ascending: false });

  if (error) {
    if (error.code === '42P01') {
      return json({ templates: [] });
    }

    return json({ templates: [], error: error.message }, { status: 500 });
  }

  return json({
    templates: (data || []).map((row) => ({
      category: row.category,
      title: row.title,
      description: row.description || '',
      keywords: Array.isArray(row.keywords) ? row.keywords : [],
    })),
  });
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  return listTemplates(context);
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return listTemplates(context);
  }

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const supabase = getAppTemplatesSupabase(contextEnv(context));

  if (!supabase) {
    return json({ saved: false, reason: 'not_configured' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    category?: string;
    title?: string;
    description?: string;
    keywords?: unknown;
    files?: unknown;
    startCommand?: string;
    sourceChatId?: string;
  };

  const category = slugifyCategory(body.category || '');

  if (!isValidCategorySlug(category)) {
    return json({ error: 'Invalid category' }, { status: 400 });
  }

  const files = asFileMap(body.files);

  if (!files || (!files['package.json'] && !files['index.html'])) {
    return json({ error: 'Template files are incomplete' }, { status: 400 });
  }

  const title = (body.title || category).trim().slice(0, 80) || category;
  const row = {
    category,
    title,
    description: (body.description || title).trim().slice(0, 400),
    keywords: asStringArray(body.keywords),
    files,
    start_command: (body.startCommand || 'npm install && npm run dev').slice(0, 200),
    source_chat_id: typeof body.sourceChatId === 'string' ? body.sourceChatId.slice(0, 80) : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase.from('app_templates').insert(row);

  if (error) {
    if (error.code === '23505') {
      return json({ saved: false, reason: 'exists' }, { status: 409 });
    }

    return json({ error: error.message }, { status: 500 });
  }

  return json({ saved: true, category });
}
