export const MIN_STARTER_CONFIDENCE = 0.6;

export type TemplateSummary = {
  category: string;
  title: string;
  description: string;
  keywords: string[];
};

export type AppStarter = TemplateSummary & {
  files: Record<string, string>;
  startCommand: string;
  readyMessage?: string;
};

export type AppIntentClassification = {
  category: string;
  title: string;
  confidence: number;
  extras: string[];
  keywords: string[];
};

export const UNKNOWN_INTENT: AppIntentClassification = {
  category: 'unknown',
  title: '',
  confidence: 0,
  extras: [],
  keywords: [],
};

export function slugifyCategory(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);

  return slug.length >= 2 ? slug : 'unknown';
}

export function isValidCategorySlug(value: string): boolean {
  return /^[a-z][a-z0-9_]{1,62}$/.test(value) && value !== 'unknown';
}
