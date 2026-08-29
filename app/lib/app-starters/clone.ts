import type { ProviderInfo } from '~/types/model';
import { getDockerRuntime } from '~/lib/runtime';
import { chatId } from '~/lib/persistence';
import { createChatId } from '~/lib/persistence/chat-id';
import { APP_NAME } from '~/utils/brand';
import { createScopedLogger } from '~/utils/logger';
import { fetchCatalogSummaries, fetchTemplateByCategory } from './catalog';
import { classifyAppIntent } from './classify-intent';
import { CATALOG_MATCH_THRESHOLD, matchCatalog, meaningfulExtras, scoreCatalogItem, snapCategoryToCatalog } from './match-catalog';
import { MIN_STARTER_CONFIDENCE, type AppIntentClassification, type AppStarter } from './types';

const logger = createScopedLogger('app-starters.clone');

export type AppliedAppStarter = {
  starter: AppStarter;
  extras: string[];
  assistantMessage: string;
  deltaUserMessage?: string;
};

export type StarterAttempt = {
  classification: AppIntentClassification;
  applied: AppliedAppStarter | null;
};

async function ensureChatIdForClone(): Promise<string> {
  const existing = chatId.get();

  if (existing) {
    return existing;
  }

  const nextId = createChatId();
  chatId.set(nextId);

  return nextId;
}

export function buildStarterArtifactMessage(starter: AppStarter): string {
  const fileActions = Object.entries(starter.files)
    .map(
      ([filePath, content]) => `<boltAction type="file" filePath="${filePath}">
${content}
</boltAction>`,
    )
    .join('\n');
  const ready =
    starter.readyMessage || `Here's a ${starter.title.toLowerCase()}. Tell me what to change.`;

  return `${APP_NAME} is setting up a generic ${starter.title.toLowerCase()} you can customize.
${ready}
<boltArtifact id="imported-files" title="${starter.title}" type="bundled">
${fileActions}
<boltAction type="start">${starter.startCommand}</boltAction>
</boltArtifact>
`;
}

export function buildStarterDeltaMessage(starter: AppStarter, extras: string[], originalRequest: string): string {
  return `The generic ${starter.title.toLowerCase()} files already exist in the project. Do NOT rebuild the app from scratch.
Apply ONLY these extras to the existing files:
${extras.map((extra) => `- ${extra}`).join('\n')}

Original request:
${originalRequest}

Edit only the files that need to change. Keep the current Vite + React + Tailwind setup and local state unless an extra requires otherwise.
`;
}

export async function cloneAppStarter(starter: AppStarter): Promise<void> {
  const sessionKey = await ensureChatIdForClone();
  const runtime = getDockerRuntime();

  await runtime.ensureSession?.(sessionKey);

  for (const [filePath, content] of Object.entries(starter.files)) {
    await runtime.writeFile(filePath, content);
  }

  await runtime.start?.(starter.startCommand);
}

async function resolveClassification(options: {
  message: string;
  model: string;
  provider: ProviderInfo;
  catalog: Awaited<ReturnType<typeof fetchCatalogSummaries>>;
}): Promise<AppIntentClassification> {
  const local = matchCatalog(options.message, options.catalog);

  if (local) {
    logger.info(`Catalog match "${local.item.category}" (score ${local.score})`);

    return {
      category: local.item.category,
      title: local.item.title,
      confidence: Math.min(0.95, 0.7 + local.score / 20),
      extras: [],
      keywords: local.item.keywords,
    };
  }

  const classified = await classifyAppIntent(options);
  const snapped = snapCategoryToCatalog(classified.category, options.catalog);

  if (snapped && snapped.category !== classified.category) {
    logger.info(`Snapped classifier "${classified.category}" → catalog "${snapped.category}"`);

    return {
      ...classified,
      category: snapped.category,
      title: snapped.title,
      keywords: snapped.keywords.length ? snapped.keywords : classified.keywords,
    };
  }

  return classified;
}

export async function tryApplyCuratedStarter(options: {
  message: string;
  model: string;
  provider: ProviderInfo;
}): Promise<StarterAttempt> {
  const catalog = await fetchCatalogSummaries();
  const classification = await resolveClassification({ ...options, catalog });

  if (classification.category === 'unknown' || classification.confidence < MIN_STARTER_CONFIDENCE) {
    logger.info('No reusable template', classification);
    return { classification, applied: null };
  }

  const catalogItem = catalog.find((item) => item.category === classification.category);

  if (catalogItem && scoreCatalogItem(options.message, catalogItem) < CATALOG_MATCH_THRESHOLD) {
    logger.info(
      `Refusing template "${classification.category}" — prompt topics do not overlap the snapshot`,
      classification,
    );
    return { classification: { ...classification, category: 'unknown', confidence: 0 }, applied: null };
  }

  const starter = await fetchTemplateByCategory(classification.category);

  if (!starter || Object.keys(starter.files).length === 0) {
    logger.info(`Template "${classification.category}" has no files to clone`);
    return { classification, applied: null };
  }

  try {
    await cloneAppStarter(starter);
  } catch (error) {
    logger.warn('Failed to clone template; falling back to full generate', error);
    return { classification, applied: null };
  }

  const extras = meaningfulExtras(
    classification.extras,
    options.message,
    starter.title,
    starter.category,
  );

  logger.info(`Reusing template "${starter.category}" extras=${extras.length}`);

  return {
    classification: { ...classification, extras },
    applied: {
      starter,
      extras,
      assistantMessage: buildStarterArtifactMessage(starter),
      deltaUserMessage: extras.length > 0 ? buildStarterDeltaMessage(starter, extras, options.message) : undefined,
    },
  };
}
