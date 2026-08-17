import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { useEffect } from 'react';
import { chatId, description } from '~/lib/persistence';
import { previewHealthStore } from '~/lib/stores/preview-health';
import { workbenchStore } from '~/lib/stores/workbench';
import { createScopedLogger } from '~/utils/logger';
import { saveAppTemplate } from './catalog';
import { collectProjectFiles, hasSavableAppFiles } from './project-files';
import { isValidCategorySlug, slugifyCategory, type AppIntentClassification } from './types';

const logger = createScopedLogger('app-starters.save');

export type PendingAppTemplate = {
  category: string;
  title: string;
  description: string;
  keywords: string[];
};

export const pendingAppTemplateStore = atom<PendingAppTemplate | null>(null);

let saveInFlight = false;

function keywordsFromPrompt(prompt: string, category: string): string[] {
  const cleaned = prompt
    .toLowerCase()
    .replace(/\[model:[\s\S]*?\]\s*/gi, '')
    .replace(/\[provider:[\s\S]*?\]\s*/gi, '')
    .replace(/\b(generate|create|build|make|please|a|an|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const phrases = [cleaned, category.replaceAll('_', ' ')];

  if (cleaned.endsWith(' application')) {
    phrases.push(cleaned.replace(/ application$/, ' app'));
  }

  if (cleaned.endsWith(' app')) {
    phrases.push(cleaned.replace(/ app$/, ' application'));
  }

  return [...new Set(phrases.map((item) => item.trim()).filter((item) => item.length >= 4))].slice(0, 8);
}

export function clearPendingAppTemplate(): void {
  pendingAppTemplateStore.set(null);
}

export function setPendingAppTemplateFromIntent(
  classification: AppIntentClassification | undefined,
  userPrompt: string,
): void {
  const fromTitle = description.get() || '';
  const promptSlice = userPrompt.replace(/\[Model:[\s\S]*?\]\n\n\[Provider:[\s\S]*?\]\n\n/, '').trim().slice(0, 160);
  let category = classification?.category && classification.category !== 'unknown' ? classification.category : '';

  if (!isValidCategorySlug(category)) {
    category = slugifyCategory(classification?.title || fromTitle || promptSlice);
  }

  if (!isValidCategorySlug(category)) {
    logger.warn('Skipping template pending state; no usable category slug');
    pendingAppTemplateStore.set(null);
    return;
  }

  pendingAppTemplateStore.set({
    category,
    title: (classification?.title || fromTitle || promptSlice || category).slice(0, 80),
    description: promptSlice || classification?.title || category,
    keywords: [
      ...new Set([
        ...(classification?.keywords || []),
        ...keywordsFromPrompt(promptSlice || userPrompt, category),
      ]),
    ].slice(0, 12),
  });
}

export async function flushPendingAppTemplate(): Promise<void> {
  const pending = pendingAppTemplateStore.get();

  if (!pending || saveInFlight) {
    return;
  }

  if (previewHealthStore.get().status !== 'healthy') {
    return;
  }

  const files = collectProjectFiles();

  if (!hasSavableAppFiles(files)) {
    return;
  }

  saveInFlight = true;

  try {
    const title = pending.title || description.get() || pending.category;
    const result = await saveAppTemplate({
      category: pending.category,
      title,
      description: pending.description || title,
      keywords: pending.keywords,
      files,
      startCommand: 'npm install && npm run dev',
      sourceChatId: chatId.get(),
    });

    pendingAppTemplateStore.set(null);

    if (result.saved) {
      logger.info(`Saved global app template "${pending.category}"`);
    } else {
      logger.info(`Did not save template "${pending.category}": ${result.reason || 'skipped'}`);
    }
  } catch (error) {
    logger.warn('Failed to save app template after preview', error);
    pendingAppTemplateStore.set(null);
  } finally {
    saveInFlight = false;
  }
}

export function useSaveAppTemplateOnPreview(options: { isLoading: boolean; fakeLoading: boolean }) {
  const health = useStore(previewHealthStore);
  const pending = useStore(pendingAppTemplateStore);
  const files = useStore(workbenchStore.files);

  useEffect(() => {
    if (!pending || options.isLoading || options.fakeLoading) {
      return;
    }

    if (health.status !== 'healthy') {
      return;
    }

    void flushPendingAppTemplate();
  }, [pending, health.status, options.isLoading, options.fakeLoading, files]);
}
