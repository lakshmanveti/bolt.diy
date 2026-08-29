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

/** Too common to prove two apps are the same product. */
const GENERIC_TOPIC = new Set([
  'app',
  'application',
  'web',
  'website',
  'site',
  'page',
  'ui',
  'tool',
  'system',
  'software',
  'platform',
  'program',
  'project',
  'dashboard',
  'manager',
  'manage',
  'management',
  'tracker',
  'track',
  'tracking',
  'planner',
  'plan',
  'planning',
  'list',
  'lists',
  'log',
  'logs',
  'record',
  'records',
  'data',
  'item',
  'items',
  'form',
  'forms',
  'crud',
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

/** Distinctive token overlap required before a saved snapshot can be reused. */
export const CATALOG_MATCH_THRESHOLD = 4;

export function isGenericTopicToken(token: string): boolean {
  return GENERIC_TOPIC.has(token);
}

export function phraseInMessage(message: string, phrase: string): boolean {
  const needle = phrase.trim().toLowerCase();

  if (needle.length < 4) {
    return false;
  }

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`).replace(/\s+/g, String.raw`\s+`);

  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(message);
}

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

export function distinctiveTokens(text: string): Set<string> {
  return new Set([...contentTokens(text)].filter((token) => !isGenericTopicToken(token)));
}

function catalogTokens(item: TemplateSummary): Set<string> {
  return contentTokens(
    [item.category.replaceAll('_', ' '), item.title, item.description, ...(item.keywords || [])].join(' '),
  );
}

function catalogDistinctiveTokens(item: TemplateSummary): Set<string> {
  return new Set([...catalogTokens(item)].filter((token) => !isGenericTopicToken(token)));
}

export function scoreCatalogItem(message: string, item: TemplateSummary): number {
  const hay = message.toLowerCase();
  const msgDistinct = distinctiveTokens(message);
  const itemDistinct = catalogDistinctiveTokens(item);
  let score = 0;
  let distinctiveHits = 0;

  for (const token of itemDistinct) {
    if (msgDistinct.has(token)) {
      score += 2;
      distinctiveHits += 1;
    }
  }

  const phrase = item.category.replaceAll('_', ' ');

  if (phrase.length >= 4 && phraseInMessage(hay, phrase)) {
    score += 3;
    distinctiveHits += 1;
  }

  if (item.title && phraseInMessage(hay, item.title)) {
    score += 3;
    distinctiveHits += 1;
  }

  for (const keyword of item.keywords || []) {
    if (!keyword || !phraseInMessage(hay, keyword)) {
      continue;
    }

    const distinctiveKeyword = [...distinctiveTokens(keyword)];

    if (distinctiveKeyword.length === 0) {
      continue;
    }

    score += Math.min(3, Math.max(2, distinctiveKeyword.length + 1));
    distinctiveHits += 1;
  }

  if (distinctiveHits === 0) {
    return 0;
  }

  return score;
}

export function matchCatalog(
  message: string,
  catalog: TemplateSummary[],
): { item: TemplateSummary; score: number } | null {
  let best: { item: TemplateSummary; score: number } | null = null;
  let second = 0;

  for (const item of catalog) {
    const score = scoreCatalogItem(message, item);

    if (!best || score > best.score) {
      second = best?.score || 0;
      best = { item, score };
    } else if (score > second) {
      second = score;
    }
  }

  if (!best || best.score < CATALOG_MATCH_THRESHOLD) {
    return null;
  }

  // Ambiguous: two snapshots scored similarly — generate from scratch.
  if (second > 0 && best.score - second < 2) {
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
