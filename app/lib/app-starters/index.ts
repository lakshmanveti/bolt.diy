export { APP_STARTERS, getSeedStarter, mergeCatalog, seedSummaries } from './manifest';
export { classifyAppIntent, classifyAppIntentWithKeywords } from './classify-intent';
export { tryApplyCuratedStarter, type AppliedAppStarter, type StarterAttempt } from './clone';
export {
  clearPendingAppTemplate,
  setPendingAppTemplateFromIntent,
  useSaveAppTemplateOnPreview,
} from './save-template';
export { MIN_STARTER_CONFIDENCE, type AppIntentClassification, type AppStarter, type TemplateSummary } from './types';
