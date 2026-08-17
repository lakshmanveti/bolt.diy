import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getAppTemplatesSupabase } from '~/lib/app-starters/supabase.server';
import { isValidCategorySlug, slugifyCategory } from '~/lib/app-starters/types';

export async function loader({ context, params }: LoaderFunctionArgs) {
  const category = slugifyCategory(params.category || '');

  if (!isValidCategorySlug(category)) {
    return json({ error: 'Invalid category' }, { status: 400 });
  }

  const supabase = getAppTemplatesSupabase((context.cloudflare?.env as Record<string, string | undefined>) || {});

  if (!supabase) {
    return json({ template: null }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('app_templates')
    .select('category, title, description, keywords, files, start_command')
    .eq('category', category)
    .maybeSingle();

  if (error) {
    if (error.code === '42P01') {
      return json({ template: null }, { status: 404 });
    }

    return json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return json({ template: null }, { status: 404 });
  }

  return json({
    template: {
      category: data.category,
      title: data.title,
      description: data.description || '',
      keywords: Array.isArray(data.keywords) ? data.keywords : [],
      files: data.files && typeof data.files === 'object' ? data.files : {},
      startCommand: data.start_command || 'npm install && npm run dev',
    },
  });
}
