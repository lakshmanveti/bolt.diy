import Cookies from 'js-cookie';
import { atom } from 'nanostores';
import type { IProviderSetting } from '~/types/model';
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

  const apiKeysRaw = llm.apiKeys;

  const apiKeys: Record<string, string> = isPlainObject(apiKeysRaw)
    ? Object.fromEntries(
        Object.entries(apiKeysRaw).filter(([, v]) => typeof v === 'string') as [string, string][],
      )
    : {};

  let providerSettings: Record<string, IProviderSetting> | undefined;

  if (isPlainObject(llm.providerSettings)) {
    providerSettings = llm.providerSettings as Record<string, IProviderSetting>;
  }

  return { provider, model, apiKeys, providerSettings };
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

export async function checkProviderEnvApiKey(providerName: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/check-env-key?provider=${encodeURIComponent(providerName)}`);

    if (!response.ok) {
      return false;
    }

    const data = (await response.json()) as { isSet?: boolean };
    return Boolean(data.isSet);
  } catch {
    return false;
  }
}

export function hasProviderApiKey(prefs: LlmUserPreferences | null, envKeySet = false): boolean {
  if (!prefs?.provider) {
    return false;
  }

  const key = prefs.apiKeys[prefs.provider]?.trim();
  return Boolean(key) || envKeySet;
}

export function isLlmPreferencesComplete(prefs: LlmUserPreferences | null, envKeySet = false): boolean {
  if (!prefs) {
    return false;
  }

  return Boolean(prefs.provider?.trim() && prefs.model?.trim() && hasProviderApiKey(prefs, envKeySet));
}

export async function evaluateChatLlmConfig(prefs: LlmUserPreferences | null): Promise<boolean> {
  // Stored API key is enough — avoid async env check so UI does not flash setup while waiting.
  if (isLlmPreferencesComplete(prefs)) {
    chatLlmConfigReadyStore.set(true);
    return true;
  }

  if (!prefs?.provider?.trim() || !prefs?.model?.trim()) {
    chatLlmConfigReadyStore.set(false);
    return false;
  }

  const envKeySet = await checkProviderEnvApiKey(prefs.provider);
  const ready = isLlmPreferencesComplete(prefs, envKeySet);
  chatLlmConfigReadyStore.set(ready);
  return ready;
}

async function finishPreferenceLoad(llm: LlmUserPreferences | null): Promise<void> {
  await evaluateChatLlmConfig(llm);
  userPreferencesReadyStore.set(true);
}

export async function loadUserPreferenceDocument(): Promise<UserPreferenceDocument | null> {
  userPreferencesReadyStore.set(false);

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
    await finishPreferenceLoad(parseLlmPreferences(doc));
    return doc;
  } catch (error) {
    logger.warn('loadUserPreferenceDocument error', error);
    applyDocumentToStores(null);
    await finishPreferenceLoad(null);
    return null;
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
  const doc = await patchUserPreferences({
    [LLM_PREFERENCE_KEY]: {
      provider: prefs.provider.trim(),
      model: prefs.model.trim(),
      apiKeys: prefs.apiKeys,
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
  Cookies.set('apiKeys', JSON.stringify(prefs.apiKeys), { expires: 30 });

  if (prefs.providerSettings) {
    Cookies.set('providers', JSON.stringify(prefs.providerSettings), { expires: 30 });
  }
}

/** @deprecated Use syncLlmPreferencesToCookies */
export function syncPreferencesToCookies(prefs: LlmUserPreferences) {
  syncLlmPreferencesToCookies(prefs);
}
