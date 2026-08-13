import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { ClientOnly } from 'remix-utils/client-only';
import { APIKeyManager } from '~/components/chat/APIKeyManager';
import { ModelSelector } from '~/components/chat/ModelSelector';
import { getEnvDefaultLlmModel, getEnvDefaultLlmProvider } from '~/lib/modules/llm/defaults';
import { LOCAL_PROVIDERS } from '~/lib/stores/settings';
import type { ModelInfo } from '~/lib/modules/llm/types';
import {
  saveUserPreferences,
  syncPreferencesToCookies,
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
};

export function UserLlmPreferencesSetup({ providerList, onSaved }: UserLlmPreferencesSetupProps) {
  const envDefaultProvider = getEnvDefaultLlmProvider();
  const envDefaultModel = getEnvDefaultLlmModel();

  const setupProviderList =
    providerList.length > 0
      ? providerList
      : (PROVIDER_LIST.filter((p) => !LOCAL_PROVIDERS.includes(p.name)) as ProviderInfo[]);

  const initialProvider =
    setupProviderList.find((p) => p.name === envDefaultProvider) ?? setupProviderList[0];

  const [provider, setProvider] = useState<ProviderInfo | undefined>(initialProvider);
  const [model, setModel] = useState(envDefaultModel ?? '');
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [modelList, setModelList] = useState<ModelInfo[]>([]);
  const [isModelLoading, setIsModelLoading] = useState<string | undefined>('all');
  const [busy, setBusy] = useState(false);
  const [envKeySet, setEnvKeySet] = useState(false);

  const providerSettings = useStore(providersStore);

  useEffect(() => {
    if (!provider?.name) {
      return;
    }

    setIsModelLoading(provider.name);
    fetch(`/api/models/${encodeURIComponent(provider.name)}`)
      .then((r) => r.json())
      .then((payload) => {
        const list = (payload as { modelList: ModelInfo[] }).modelList ?? [];
        setModelList((prev) => [...prev.filter((m) => m.provider !== provider.name), ...list]);

        if (!model && list.length > 0) {
          const preferred = list.find((m) => m.name === envDefaultModel)?.name ?? list[0].name;
          setModel(preferred);
        }
      })
      .catch(() => undefined)
      .finally(() => setIsModelLoading(undefined));
  }, [provider?.name, envDefaultModel, model]);

  useEffect(() => {
    if (!provider?.name) {
      return;
    }

    fetch(`/api/check-env-key?provider=${encodeURIComponent(provider.name)}`)
      .then((r) => r.json())
      .then((data) => setEnvKeySet(Boolean((data as { isSet?: boolean }).isSet)))
      .catch(() => setEnvKeySet(false));
  }, [provider?.name]);

  const canSave =
    Boolean(provider?.name && model.trim()) &&
    (Boolean(apiKeys[provider?.name ?? '']?.trim()) || envKeySet);

  const handleSave = async () => {
    if (!provider?.name || !model.trim()) {
      toast.error('Select a provider and model');
      return;
    }

    if (!apiKeys[provider.name]?.trim() && !envKeySet) {
      toast.error('Add an API key for the selected provider (or set it in your server environment)');
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

      const prefs: UserPreferences = {
        provider: provider.name,
        model: model.trim(),
        apiKeys,
        providerSettings: providerSettingsPayload,
      };

      const saved = await saveUserPreferences(prefs);
      syncPreferencesToCookies(saved);
      toast.success('Model preferences saved');
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
    <div className="rounded-lg border border-accent-500/30 bg-bolt-elements-background-depth-2 p-4">
      <h3 className="text-sm font-medium text-bolt-elements-textPrimary">Set up your AI model</h3>
      <p className="mt-1 text-xs text-bolt-elements-textSecondary">
        Choose a provider, model, and API key before you start building. Preferences are saved to your account.
      </p>

      <ClientOnly fallback={<div className="mt-4 h-24 animate-pulse rounded-md bg-bolt-elements-background-depth-3" />}>
        {() => (
          <div className="mt-4 space-y-3">
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
            {!LOCAL_PROVIDERS.includes(provider.name) && (
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
        {busy
          ? 'Saving…'
          : envKeySet && !apiKeys[provider.name]?.trim()
            ? 'Save and continue (use server API key)'
            : 'Save and continue'}
      </button>
    </div>
  );
}
