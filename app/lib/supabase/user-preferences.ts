import Cookies from 'js-cookie';
import { atom } from 'nanostores';
import type { IProviderSetting } from '~/types/model';
import { LOCAL_PROVIDERS } from '~/lib/stores/settings';
import { isHostedPlanActive } from '~/lib/billing/subscription';
import { getSupabaseClient, requireAuthUser } from '~/lib/supabase/client';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('UserPreferences');

/** Top-level keys grow over time (llm, theme, …) — no fixed DB columns. */
export type UserPreferenceDocument = Record<string, unknown>;

export const LLM_PREFERENCE_KEY = 'llm';

export type LlmUserPreferences = {
  provider: string;
  model: string;
  apiKeys: Record<string, string>;
  providerSettings?: Record<string, IProviderSetting>;
};

/** @deprecated Use LlmUserPreferences — kept for existing call sites. */
export type UserPreferences = LlmUserPreferences;

export type UserPreferenceRow = {
  user_id: string;
  preferences: UserPreferenceDocument;
  updated_at: string;
};

export const userPreferenceDocumentStore = atom<UserPreferenceDocument | null>(null);
/** LLM slice derived from the document (chat gating + cookies). */
export const userPreferencesStore = atom<LlmUserPreferences | null>(null);
export const userPreferencesReadyStore = atom(false);
export const chatLlmConfigReadyStore = atom(false);

let preferenceLoadPromise: Promise<UserPreferenceDocument | null> | null = null;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergePreferenceDocuments(
  base: UserPreferenceDocument,
  patch: UserPreferenceDocument,
): UserPreferenceDocument {
  const result: UserPreferenceDocument = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    const existing = result[key];

    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = mergePreferenceDocuments(existing, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function parseLlmPreferences(doc: UserPreferenceDocument | null | undefined): LlmUserPreferences | null {
  if (!doc || !isPlainObject(doc[LLM_PREFERENCE_KEY])) {
    return null;
  }

  const llm = doc[LLM_PREFERENCE_KEY];
  const provider = typeof llm.provider === 'string' ? llm.provider.trim() : '';
  const model = typeof llm.model === 'string' ? llm.model.trim() : '';

  if (!provider || !model) {
    return null;
  }

  const apiKeys = extractLlmApiKeysFromDocument({ [LLM_PREFERENCE_KEY]: llm });

  let providerSettings: Record<string, IProviderSetting> | undefined;

  if (isPlainObject(llm.providerSettings)) {
    providerSettings = llm.providerSettings as Record<string, IProviderSetting>;
  }

  return { provider, model, apiKeys, providerSettings };
}

function parseApiKeysRecord(raw: unknown): Record<string, string> {
  if (typeof raw === 'string') {
    try {
      return parseApiKeysRecord(JSON.parse(raw));
    } catch {
      return {};
    }
  }

  if (!isPlainObject(raw)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(raw).filter(([, value]) => typeof value === 'string') as [string, string][],
  );
}

function findApiKeyForProvider(apiKeys: Record<string, string>, provider: string): string {
  const direct = apiKeys[provider]?.trim();

  if (direct) {
    return direct;
  }

  const providerLower = provider.toLowerCase();

  for (const [name, key] of Object.entries(apiKeys)) {
    if (name.toLowerCase() === providerLower && key?.trim()) {
      return key.trim();
    }
  }

  return '';
}

/** Collect API keys from all known shapes inside the preference document. */
export function extractLlmApiKeysFromDocument(doc: UserPreferenceDocument | null | undefined): Record<string, string> {
  const merged: Record<string, string> = {};

  if (!doc) {
    return merged;
  }

  if (isPlainObject(doc[LLM_PREFERENCE_KEY])) {
    const llm = doc[LLM_PREFERENCE_KEY] as Record<string, unknown>;
    Object.assign(merged, parseApiKeysRecord(llm.apiKeys ?? llm.api_keys));

    const provider = typeof llm.provider === 'string' ? llm.provider.trim() : '';

    if (typeof llm.apiKey === 'string' && llm.apiKey.trim() && provider) {
      merged[provider] = llm.apiKey.trim();
    }
  }

  Object.assign(merged, parseApiKeysRecord(doc.apiKeys ?? doc.api_keys));

  return merged;
}

/** Resolve API key for the selected provider from account preferences (all document shapes). */
export function resolveStoredProviderApiKey(
  prefs: LlmUserPreferences | null,
  doc?: UserPreferenceDocument | null,
): string {
  const provider = prefs?.provider?.trim();

  if (!provider) {
    return '';
  }

  const mergedKeys: Record<string, string> = {
    ...extractLlmApiKeysFromDocument(doc),
    ...(prefs?.apiKeys ?? {}),
  };

  return findApiKeyForProvider(mergedKeys, provider);
}

/** Merge account preferences, document, and optional cookie keys for display. */
export function resolveEffectiveProviderApiKey(
  prefs: LlmUserPreferences | null,
  doc?: UserPreferenceDocument | null,
  extraKeys?: Record<string, string>,
): string {
  const provider = prefs?.provider?.trim();

  if (!provider) {
    return '';
  }

  const mergedKeys: Record<string, string> = {
    ...extractLlmApiKeysFromDocument(doc),
    ...(prefs?.apiKeys ?? {}),
    ...(extraKeys ?? {}),
  };

  const matched = findApiKeyForProvider(mergedKeys, provider);

  if (matched) {
    return matched;
  }

  const nonEmpty = Object.entries(mergedKeys).filter(([, value]) => value?.trim());

  if (nonEmpty.length === 1) {
    return nonEmpty[0]![1].trim();
  }

  return '';
}

function mergeApiKeyRecords(...sources: Record<string, string>[]): Record<string, string> {
  const merged: Record<string, string> = {};

  for (const source of sources) {
    for (const [name, value] of Object.entries(source)) {
      const trimmed = value?.trim();

      if (trimmed) {
        merged[name] = trimmed;
      }
    }
  }

  return merged;
}

function applyDocumentToStores(doc: UserPreferenceDocument | null) {
  userPreferenceDocumentStore.set(doc);
  const llm = parseLlmPreferences(doc);
  userPreferencesStore.set(llm);
  return llm;
}

export function getPreferenceSection<T extends Record<string, unknown>>(
  doc: UserPreferenceDocument | null | undefined,
  key: string,
): T | null {
  if (!doc || !isPlainObject(doc[key])) {
    return null;
  }

  return doc[key] as T;
}

export function hasProviderApiKey(
  prefs: LlmUserPreferences | null,
  doc?: UserPreferenceDocument | null,
): boolean {
  if (!prefs?.provider) {
    return false;
  }

  if (LOCAL_PROVIDERS.includes(prefs.provider)) {
    return true;
  }

  return Boolean(resolveStoredProviderApiKey(prefs, doc ?? userPreferenceDocumentStore.get()));
}

export function isLlmPreferencesComplete(
  prefs: LlmUserPreferences | null,
  doc?: UserPreferenceDocument | null,
): boolean {
  if (isHostedPlanActive()) {
    return true;
  }

  if (!prefs) {
    return false;
  }

  return Boolean(prefs.provider?.trim() && prefs.model?.trim() && hasProviderApiKey(prefs, doc));
}

export async function evaluateChatLlmConfig(prefs: LlmUserPreferences | null): Promise<boolean> {
  const doc = userPreferenceDocumentStore.get();
  const ready = isLlmPreferencesComplete(prefs, doc);
  chatLlmConfigReadyStore.set(ready);
  return ready;
}

async function finishPreferenceLoad(llm: LlmUserPreferences | null): Promise<void> {
  if (llm) {
    syncLlmPreferencesToCookies(llm);
  } else {
    const user = await requireAuthUser();

    if (user) {
      Cookies.remove('apiKeys');
    }
  }

  await evaluateChatLlmConfig(llm);
  userPreferencesReadyStore.set(true);
}

export async function loadUserPreferenceDocument(options?: {
  force?: boolean;
}): Promise<UserPreferenceDocument | null> {
  if (preferenceLoadPromise && !options?.force) {
    return preferenceLoadPromise;
  }

  preferenceLoadPromise = loadUserPreferenceDocumentInternal().finally(() => {
    preferenceLoadPromise = null;
  });

  return preferenceLoadPromise;
}

async function loadUserPreferenceDocumentInternal(): Promise<UserPreferenceDocument | null> {
  const supabase = getSupabaseClient();
  const user = await requireAuthUser();

  if (!supabase || !user) {
    applyDocumentToStores(null);
    await finishPreferenceLoad(null);
    return null;
  }

  try {
    const { data, error } = await supabase.from('user_preference').select('*').eq('user_id', user.id).maybeSingle();

    if (error) {
      logger.warn('loadUserPreferenceDocument failed', error);
      applyDocumentToStores(null);
      await finishPreferenceLoad(null);
      return null;
    }

    if (!data) {
      applyDocumentToStores(null);
      await finishPreferenceLoad(null);
      return null;
    }

    const row = data as UserPreferenceRow;
    const doc = isPlainObject(row.preferences) ? row.preferences : {};
    applyDocumentToStores(doc);
    await applySavedIntegrations(doc);
    await finishPreferenceLoad(parseLlmPreferences(doc));
    return doc;
  } catch (error) {
    logger.warn('loadUserPreferenceDocument error', error);
    applyDocumentToStores(null);
    await finishPreferenceLoad(null);
    return null;
  }
}

async function applySavedIntegrations(doc: UserPreferenceDocument | null) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const { applyIntegrationsFromDocument } = await import('~/lib/supabase/user-integrations');
    applyIntegrationsFromDocument(doc);
  } catch (error) {
    logger.warn('Failed to apply saved integrations', error);
  }
}

/** Load document and return the LLM slice (convenience for chat). */
export async function loadUserPreferences(): Promise<LlmUserPreferences | null> {
  const doc = await loadUserPreferenceDocument();
  return parseLlmPreferences(doc);
}

/**
 * Deep-merge a patch into the user's preference document (other keys are preserved).
 * Example: patchUserPreferences({ theme: 'dark' }) or patchUserPreferences({ llm: { ... } })
 */
export async function patchUserPreferences(patch: UserPreferenceDocument): Promise<UserPreferenceDocument> {
  const supabase = getSupabaseClient();
  const user = await requireAuthUser();

  if (!supabase || !user) {
    throw new Error('Sign in to save preferences');
  }

  const existing = userPreferenceDocumentStore.get() ?? {};
  const merged = mergePreferenceDocuments(existing, patch);

  const row = {
    user_id: user.id,
    preferences: merged,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from('user_preference').upsert(row, { onConflict: 'user_id' }).select().single();

  if (error) {
    logger.error('patchUserPreferences failed', error);
    throw error;
  }

  const savedRow = data as UserPreferenceRow;
  const savedDoc = isPlainObject(savedRow.preferences) ? savedRow.preferences : merged;
  const llm = applyDocumentToStores(savedDoc);
  await evaluateChatLlmConfig(llm);
  return savedDoc;
}

export async function saveLlmPreferences(prefs: LlmUserPreferences): Promise<LlmUserPreferences> {
  const existingKeys = extractLlmApiKeysFromDocument(userPreferenceDocumentStore.get());
  const mergedApiKeys = mergeApiKeyRecords(existingKeys, prefs.apiKeys);

  const doc = await patchUserPreferences({
    [LLM_PREFERENCE_KEY]: {
      provider: prefs.provider.trim(),
      model: prefs.model.trim(),
      apiKeys: mergedApiKeys,
      providerSettings: prefs.providerSettings ?? null,
    },
  });

  const llm = parseLlmPreferences(doc);

  if (!llm) {
    throw new Error('Failed to save LLM preferences');
  }

  return llm;
}

/** @deprecated Use saveLlmPreferences or patchUserPreferences */
export async function saveUserPreferences(prefs: LlmUserPreferences): Promise<LlmUserPreferences> {
  return saveLlmPreferences(prefs);
}

export function syncLlmPreferencesToCookies(prefs: LlmUserPreferences) {
  Cookies.set('selectedProvider', prefs.provider, { expires: 30 });
  Cookies.set('selectedModel', prefs.model, { expires: 30 });

  // Cookies mirror account preferences only — do not preserve stale keys from older sessions.
  Cookies.set('apiKeys', JSON.stringify(prefs.apiKeys), { expires: 30 });

  if (prefs.providerSettings) {
    Cookies.set('providers', JSON.stringify(prefs.providerSettings), { expires: 30 });
  }
}

/** @deprecated Use syncLlmPreferencesToCookies */
export function syncPreferencesToCookies(prefs: LlmUserPreferences) {
  syncLlmPreferencesToCookies(prefs);
}
