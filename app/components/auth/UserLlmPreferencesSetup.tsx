import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { ClientOnly } from 'remix-utils/client-only';
import { APIKeyManager } from '~/components/chat/APIKeyManager';
import { ModelSelector } from '~/components/chat/ModelSelector';
import { getEnvDefaultLlmModel, getEnvDefaultLlmProvider } from '~/lib/modules/llm/defaults';
import { fetchModelList, invalidateModelList } from '~/lib/modules/llm/fetch-models';
import { LOCAL_PROVIDERS } from '~/lib/stores/settings';
import type { ModelInfo } from '~/lib/modules/llm/types';
import {
  extractLlmApiKeysFromDocument,
  saveUserPreferences,
  syncPreferencesToCookies,
  userPreferenceDocumentStore,
  userPreferencesReadyStore,
  userPreferencesStore,
  type UserPreferences,
} from '~/lib/supabase/user-preferences';
import { PROVIDER_LIST } from '~/utils/constants';
import { classNames } from '~/utils/classNames';
import type { ProviderInfo } from '~/types/model';
import type { IProviderSetting } from '~/types/model';
import { providersStore } from '~/lib/stores/settings';

type UserLlmPreferencesSetupProps = {
  providerList: ProviderInfo[];
  onSaved: (prefs: UserPreferences) => void;
  variant?: 'setup' | 'settings';
};

export function UserLlmPreferencesSetup({
  providerList,
  onSaved,
  variant = 'setup',
}: UserLlmPreferencesSetupProps) {
  const envDefaultProvider = getEnvDefaultLlmProvider();
  const envDefaultModel = getEnvDefaultLlmModel();

  const setupProviderList = useMemo(
    () =>
      providerList.length > 0
        ? providerList
        : (PROVIDER_LIST.filter((p) => !LOCAL_PROVIDERS.includes(p.name)) as ProviderInfo[]),
    [providerList],
  );

  const initialProvider =
    setupProviderList.find((p) => p.name === envDefaultProvider) ?? setupProviderList[0];

  const [provider, setProvider] = useState<ProviderInfo | undefined>(initialProvider);
  const [model, setModel] = useState(envDefaultModel ?? '');
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [isModelLoading, setIsModelLoading] = useState<string | undefined>('all');
  const [busy, setBusy] = useState(false);
  const userPreferencesReady = useStore(userPreferencesReadyStore);
  const storedPrefs = useStore(userPreferencesStore);

  useEffect(() => {
    if (!userPreferencesReady) {
      return;
    }

    if (storedPrefs?.apiKeys && Object.keys(storedPrefs.apiKeys).length > 0) {
      setApiKeys(storedPrefs.apiKeys);
    }

    if (storedPrefs?.provider) {
      const matched = setupProviderList.find((p) => p.name === storedPrefs.provider);

      if (matched) {
        setProvider((current) => (current?.name === matched.name ? current : matched));
      }
    }

    if (storedPrefs?.model) {
      setModel((current) => (current === storedPrefs.model ? current : storedPrefs.model));
    }
  }, [userPreferencesReady, storedPrefs?.provider, storedPrefs?.model, storedPrefs?.apiKeys, setupProviderList]);

  useEffect(() => {
    if (!provider?.name) {
      return;
    }

    let cancelled = false;
    const providerName = provider.name;

    setIsModelLoading(providerName);
    void fetchModelList(providerName)
      .then((list) => {
        if (cancelled) {
          return;
        }

        setModelList((prev) => [...prev.filter((m) => m.provider !== providerName), ...list]);
        setModel((current) => {
          if (current.trim()) {
            return current;
          }

          if (list.length === 0) {
            return current;
          }

          return list.find((m) => m.name === envDefaultModel)?.name ?? list[0].name;
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setIsModelLoading(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [provider?.name, envDefaultModel]);

  const providerSettings = useStore(providersStore);

  const requiresApiKey = provider?.name ? !LOCAL_PROVIDERS.includes(provider.name) : true;

  const canSave =
    Boolean(provider?.name && model.trim()) &&
    (!requiresApiKey || Boolean(apiKeys[provider?.name ?? '']?.trim()));

  const handleSave = async () => {
    if (!provider?.name || !model.trim()) {
      toast.error('Select a provider and model');
      return;
    }

    if (requiresApiKey && !apiKeys[provider.name]?.trim()) {
      toast.error('Add an API key for the selected provider');
      return;
    }

    setBusy(true);

    try {
      const providerSettingsPayload: Record<string, IProviderSetting> = {};

      for (const [name, entry] of Object.entries(providerSettings)) {
        providerSettingsPayload[name] = entry.settings;
      }

      providerSettingsPayload[provider.name] = {
        ...providerSettings[provider.name]?.settings,
        enabled: true,
      };

      const mergedApiKeys = {
        ...extractLlmApiKeysFromDocument(userPreferenceDocumentStore.get()),
        ...apiKeys,
      };

      const prefs: UserPreferences = {
        provider: provider.name,
        model: model.trim(),
        apiKeys: Object.fromEntries(
          Object.entries(mergedApiKeys).filter(([, value]) => Boolean(value?.trim())),
        ),
        providerSettings: providerSettingsPayload,
      };

      const saved = await saveUserPreferences(prefs);
      syncPreferencesToCookies(saved);
      invalidateModelList(saved.provider);
      invalidateModelList();
      toast.success(variant === 'settings' ? 'Model settings saved' : 'Model preferences saved');
      onSaved(saved);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save preferences');
    } finally {
      setBusy(false);
    }
  };

  if (!provider || setupProviderList.length === 0) {
    return (
      <div className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 text-sm text-bolt-elements-textSecondary">
        No LLM providers available. Enable providers in Settings or set{' '}
        <code className="text-xs">VITE_LLM_ENABLED_PROVIDERS</code> in your environment.
      </div>
    );
  }

  return (
    <div
      className={classNames(
        variant === 'settings' ? 'space-y-3' : 'rounded-lg border border-accent-500/30 bg-bolt-elements-background-depth-2 p-4',
      )}
    >
      {variant === 'setup' && (
        <>
          <h3 className="text-sm font-medium text-bolt-elements-textPrimary">Set up your AI model</h3>
          <p className="mt-1 text-xs text-bolt-elements-textSecondary">
            Choose a provider, model, and API key. Your key is stored in your account and used until you change it.
          </p>
        </>
      )}

      <ClientOnly fallback={<div className="mt-4 h-24 animate-pulse rounded-md bg-bolt-elements-background-depth-3" />}>
        {() => (
          <div className={variant === 'setup' ? 'mt-4 space-y-3' : 'space-y-3'}>
            <ModelSelector
              model={model}
              setModel={setModel}
              provider={provider}
              setProvider={setProvider}
              modelList={modelList}
              providerList={setupProviderList.length > 0 ? setupProviderList : (PROVIDER_LIST as ProviderInfo[])}
              apiKeys={apiKeys}
              modelLoading={isModelLoading}
            />
            {requiresApiKey && (
              <APIKeyManager
                variant="setup"
                provider={provider}
                apiKey={apiKeys[provider.name] || ''}
                setApiKey={(key) => setApiKeys((prev) => ({ ...prev, [provider.name]: key }))}
              />
            )}
          </div>
        )}
      </ClientOnly>

      <button
        type="button"
        disabled={!canSave || busy}
        onClick={() => void handleSave()}
        className={classNames(
          'mt-4 w-full rounded-md px-4 py-2.5 text-sm font-medium',
          'bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50',
        )}
      >
        {busy ? 'Saving…' : variant === 'settings' ? 'Save changes' : 'Save and continue'}
      </button>
    </div>
  );
}
