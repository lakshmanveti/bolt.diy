import type { ProviderInfo } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';
import { seedSummaries } from './manifest';
import { UNKNOWN_INTENT, isValidCategorySlug, slugifyCategory, type AppIntentClassification, type TemplateSummary } from './types';

const logger = createScopedLogger('app-starters.classify');

const CLASSIFY_TIMEOUT_MS = 4000;

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.min(1, Math.max(0, n));
}

function parseStringArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start === -1 || end <= start) {
    return text.trim();
  }

  return text.slice(start, end + 1);
}

function normalizeCategory(value: string | undefined, catalog: TemplateSummary[]): string {
  const raw = (value || '').trim();

  if (!raw || raw.toLowerCase() === 'unknown') {
    return 'unknown';
  }

  const slug = slugifyCategory(raw);
  const existing = catalog.find((item) => item.category === slug);

  if (existing) {
    return existing.category;
  }

  return isValidCategorySlug(slug) ? slug : 'unknown';
}

function parseClassificationJson(text: string, catalog: TemplateSummary[]): AppIntentClassification | null {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as {
      category?: string;
      title?: string;
      confidence?: unknown;
      extras?: unknown;
      keywords?: unknown;
    };
    const category = normalizeCategory(parsed.category, catalog);
    const title =
      typeof parsed.title === 'string' && parsed.title.trim()
        ? parsed.title.trim().slice(0, 80)
        : catalog.find((item) => item.category === category)?.title || '';

    return {
      category,
      title,
      confidence: clampConfidence(parsed.confidence),
      extras: parseStringArray(parsed.extras, 8),
      keywords: parseStringArray(parsed.keywords, 12),
    };
  } catch {
    return null;
  }
}

function classifySystemPrompt(catalog: TemplateSummary[]): string {
  const catalogBlock =
    catalog.length > 0
      ? catalog
          .map(
            (item) =>
              `- ${item.category}: ${item.title} — ${item.description || 'generic app'} (keywords: ${item.keywords.join(', ') || 'none'})`,
          )
          .join('\n')
      : '(empty — invent a new snake_case category slug)';

  return `You classify what kind of app a user wants to build so we can reuse a generic template.

Return JSON only (no markdown):
{"category":"snake_case_slug","title":"Short title","confidence":0.0,"extras":["..."],"keywords":["..."]}

Existing template categories:
${catalogBlock}

Rules:
- Match INTENT, not exact wording. "Todo app for my team" and "task manager application" are the same category.
- If the request is the same kind of product as an existing category, use that category slug even if extras differ (theme, industry, extra fields).
- If it is a different kind of product (e.g. procurement vs todo vs CRM), use a NEW snake_case slug (purchase_order, crm, inventory, ...).
- Use "unknown" only when you cannot tell what they want.
- extras: requirements NOT in a generic app of that category. Empty array if the request is generic.
- keywords: 3–8 short phrases people might type for this kind of app.
- Do not invent extras.
- confidence is 0 to 1.
`;
}

export function classifyAppIntentWithKeywords(
  message: string,
  catalog: TemplateSummary[] = seedSummaries(),
): AppIntentClassification {
  const haystack = message.toLowerCase();
  let best: { item: TemplateSummary; hits: number; longest: number } | undefined;

  for (const item of catalog) {
    let hits = 0;
    let longest = 0;

    for (const keyword of item.keywords) {
      if (keyword && haystack.includes(keyword.toLowerCase())) {
        hits += 1;
        longest = Math.max(longest, keyword.length);
      }
    }

    if (hits === 0) {
      continue;
    }

    if (!best || hits > best.hits || (hits === best.hits && longest > best.longest)) {
      best = { item, hits, longest };
    }
  }

  if (!best) {
    return UNKNOWN_INTENT;
  }

  return {
    category: best.item.category,
    title: best.item.title,
    confidence: best.longest >= 10 || best.hits >= 2 ? 0.78 : 0.68,
    extras: [],
    keywords: best.item.keywords,
  };
}

async function classifyAppIntentWithLlm(options: {
  message: string;
  model: string;
  provider: ProviderInfo;
  catalog: TemplateSummary[];
}): Promise<AppIntentClassification> {
  const response = await fetch('/api/llmcall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: options.message,
      model: options.model,
      provider: options.provider,
      system: classifySystemPrompt(options.catalog),
    }),
    signal: AbortSignal.timeout(CLASSIFY_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Classify llmcall failed (${response.status})`);
  }

  const respJson = (await response.json()) as { text?: string };
  const parsed = parseClassificationJson(respJson.text || '', options.catalog);

  if (!parsed) {
    throw new Error('Classify llmcall returned unparseable JSON');
  }

  return parsed;
}

export async function classifyAppIntent(options: {
  message: string;
  model: string;
  provider: ProviderInfo;
  catalog?: TemplateSummary[];
}): Promise<AppIntentClassification> {
  const catalog = options.catalog ?? seedSummaries();

  try {
    return await classifyAppIntentWithLlm({ ...options, catalog });
  } catch (error) {
    logger.warn('Intent LLM classify failed, using keyword fallback', error);
    return classifyAppIntentWithKeywords(options.message, catalog);
  }
}
