import type { TemplateSummary } from './types';

const STOP = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'to',
  'of',
  'for',
  'my',
  'me',
  'i',
  'we',
  'you',
  'please',
  'want',
  'need',
  'make',
  'create',
  'build',
  'generate',
  'something',
  'simple',
  'basic',
  'new',
  'using',
]);

const SYNONYM: Record<string, string> = {
  application: 'app',
  apps: 'app',
  todo: 'task',
  todos: 'task',
  'to-do': 'task',
  ticketing: 'ticket',
  tickets: 'ticket',
  helpdesk: 'ticket',
  procurement: 'purchase',
  po: 'purchase',
};

export const CATALOG_MATCH_THRESHOLD = 2;

function normalizeToken(raw: string): string {
  const lower = raw.toLowerCase();
  return SYNONYM[lower] || lower;
}

export function contentTokens(text: string): Set<string> {
  const tokens = new Set<string>();

  for (const part of text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')) {
    if (part.length < 2 || STOP.has(part)) {
      continue;
    }

    tokens.add(normalizeToken(part));
  }

  return tokens;
}

function catalogTokens(item: TemplateSummary): Set<string> {
  return contentTokens(
    [item.category.replaceAll('_', ' '), item.title, item.description, ...(item.keywords || [])].join(' '),
  );
}

export function scoreCatalogItem(message: string, item: TemplateSummary): number {
  const hay = message.toLowerCase();
  const msgTokens = contentTokens(message);
  const itemTokens = catalogTokens(item);
  let score = 0;

  for (const token of itemTokens) {
    if (msgTokens.has(token)) {
      score += 1;
    }
  }

  const phrase = item.category.replaceAll('_', ' ');

  if (phrase.length >= 4 && hay.includes(phrase)) {
    score += 2;
  }

  if (item.title && hay.includes(item.title.toLowerCase())) {
    score += 2;
  }

  for (const keyword of item.keywords || []) {
    if (keyword && hay.includes(keyword.toLowerCase())) {
      score += Math.min(3, Math.ceil(keyword.length / 6));
    }
  }

  return score;
}

export function matchCatalog(
  message: string,
  catalog: TemplateSummary[],
): { item: TemplateSummary; score: number } | null {
  let best: { item: TemplateSummary; score: number } | null = null;

  for (const item of catalog) {
    const score = scoreCatalogItem(message, item);

    if (!best || score > best.score) {
      best = { item, score };
    }
  }

  if (!best || best.score < CATALOG_MATCH_THRESHOLD) {
    return null;
  }

  return best;
}

export function snapCategoryToCatalog(
  category: string,
  catalog: TemplateSummary[],
): TemplateSummary | undefined {
  const exact = catalog.find((item) => item.category === category);

  if (exact) {
    return exact;
  }

  return catalog.find(
    (item) =>
      category === item.category ||
      category.startsWith(`${item.category}_`) ||
      item.category.startsWith(`${category}_`),
  );
}

const GENERIC_EXTRA = /^(hello world|app|application|simple|basic|generic)$/i;

export function meaningfulExtras(extras: string[], message: string, title: string, category: string): string[] {
  const hay = message.toLowerCase();
  const generic = new Set(
    [...contentTokens(title), ...contentTokens(category.replaceAll('_', ' ')), ...contentTokens(message)].values(),
  );

  return extras.filter((extra) => {
    const trimmed = extra.trim();

    if (trimmed.length < 5 || GENERIC_EXTRA.test(trimmed)) {
      return false;
    }

    const extraTokens = [...contentTokens(trimmed)];

    if (extraTokens.length === 0 || extraTokens.every((token) => generic.has(token))) {
      return false;
    }

    if (hay.includes(trimmed.toLowerCase()) && extraTokens.length <= 2) {
      return false;
    }

    return true;
  });
}
