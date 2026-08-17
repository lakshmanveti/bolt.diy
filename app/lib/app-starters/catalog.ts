import { createScopedLogger } from '~/utils/logger';
import { getSeedStarter, mergeCatalog } from './manifest';
import type { AppStarter, TemplateSummary } from './types';
import { isValidCategorySlug } from './types';

const logger = createScopedLogger('app-starters.catalog');

type TemplateListResponse = {
  templates?: TemplateSummary[];
};

type TemplateDetailResponse = {
  template?: {
    category: string;
    title: string;
    description: string;
    keywords: string[];
    files: Record<string, string>;
    startCommand: string;
  };
};

function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const files: Record<string, string> = {};

  for (const [path, content] of Object.entries(value as Record<string, unknown>)) {
    if (typeof path === 'string' && typeof content === 'string' && path.length > 0) {
      files[path] = content;
    }
  }

  return files;
}

export async function fetchCatalogSummaries(): Promise<TemplateSummary[]> {
  try {
    const response = await fetch('/api/app-templates', {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) {
      throw new Error(`Catalog list failed (${response.status})`);
    }

    const body = (await response.json()) as TemplateListResponse;
    return mergeCatalog(Array.isArray(body.templates) ? body.templates : []);
  } catch (error) {
    logger.warn('Catalog list unavailable; using seed templates', error);
    return mergeCatalog([]);
  }
}

export async function fetchTemplateByCategory(category: string): Promise<AppStarter | null> {
  if (!isValidCategorySlug(category)) {
    return getSeedStarter(category) ?? null;
  }

  try {
    const response = await fetch(`/api/app-templates/${encodeURIComponent(category)}`, {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
    });

    if (response.ok) {
      const body = (await response.json()) as TemplateDetailResponse;
      const row = body.template;

      if (row?.files && Object.keys(row.files).length > 0) {
        return {
          category: row.category,
          title: row.title,
          description: row.description,
          keywords: row.keywords || [],
          files: asStringRecord(row.files),
          startCommand: row.startCommand || 'npm install && npm run dev',
          readyMessage: `Here's a ${row.title.toLowerCase()}. Tell me what to change.`,
        };
      }
    }
  } catch (error) {
    logger.warn(`Failed to load DB template ${category}`, error);
  }

  return getSeedStarter(category) ?? null;
}

export async function saveAppTemplate(input: {
  category: string;
  title: string;
  description: string;
  keywords: string[];
  files: Record<string, string>;
  startCommand?: string;
  sourceChatId?: string;
}): Promise<{ saved: boolean; reason?: string }> {
  const response = await fetch('/api/app-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const body = (await response.json().catch(() => ({}))) as { saved?: boolean; reason?: string; error?: string };

  if (response.status === 409) {
    return { saved: false, reason: 'exists' };
  }

  if (!response.ok) {
    throw new Error(body.error || `Save template failed (${response.status})`);
  }

  return { saved: Boolean(body.saved), reason: body.reason };
}
