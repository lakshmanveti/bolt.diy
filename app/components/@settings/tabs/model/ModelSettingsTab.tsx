import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { UserLlmPreferencesSetup } from '~/components/auth/UserLlmPreferencesSetup';
import { resolveStoredProviderApiKey, userPreferenceDocumentStore, userPreferencesStore } from '~/lib/supabase/user-preferences';
import { PROVIDER_LIST } from '~/utils/constants';
import { LOCAL_PROVIDERS } from '~/lib/stores/settings';
import type { ProviderInfo } from '~/types/model';
import { classNames } from '~/utils/classNames';

function maskSecret(value: string, visibleStart = 4, visibleEnd = 4): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return 'Not set';
  }

  if (trimmed.length <= visibleStart + visibleEnd) {
    return `${trimmed.slice(0, 1)}${'•'.repeat(Math.max(0, trimmed.length - 2))}${trimmed.slice(-1)}`;
  }

  const hiddenLength = Math.min(12, trimmed.length - visibleStart - visibleEnd);

  return `${trimmed.slice(0, visibleStart)}${'•'.repeat(hiddenLength)}${trimmed.slice(-visibleEnd)}`;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-bolt-elements-textTertiary">{label}</div>
      <div className="mt-0.5 break-all font-mono text-sm text-bolt-elements-textPrimary">{value}</div>
    </div>
  );
}

const cloudProviders = PROVIDER_LIST.filter((provider) => !LOCAL_PROVIDERS.includes(provider.name)) as ProviderInfo[];

export default function ModelSettingsTab() {
  const prefs = useStore(userPreferencesStore);
  const preferenceDoc = useStore(userPreferenceDocumentStore);
  const apiKey = resolveStoredProviderApiKey(prefs, preferenceDoc);
  const hasConfig = Boolean(prefs?.provider?.trim() && prefs?.model?.trim());
  const [editing, setEditing] = useState(!hasConfig);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-medium text-bolt-elements-textPrimary">Current configuration</h4>
          <button
            type="button"
            onClick={() => setEditing((open) => !open)}
            className={classNames(
              'inline-flex h-8 w-8 items-center justify-center rounded-md border',
              'border-accent-500/50 bg-bolt-elements-background-depth-2 text-accent-500',
              'hover:bg-accent-500/10',
            )}
            aria-label={editing ? 'Cancel editing' : 'Edit model settings'}
            title={editing ? 'Cancel' : 'Edit'}
          >
            <span className={editing ? 'i-ph:x h-4 w-4' : 'i-ph:pencil-simple h-4 w-4'} />
          </button>
        </div>
        <SummaryRow label="Provider" value={prefs?.provider?.trim() || '—'} />
        <SummaryRow label="Model" value={prefs?.model?.trim() || '—'} />
        <SummaryRow label="API key" value={maskSecret(apiKey)} />
      </div>

      {editing && (
        <div>
          <h4 className="mb-2 text-sm font-medium text-bolt-elements-textPrimary">Change and save</h4>
          <UserLlmPreferencesSetup
            variant="settings"
            providerList={cloudProviders}
            onSaved={() => setEditing(false)}
          />
        </div>
      )}
    </div>
  );
}
