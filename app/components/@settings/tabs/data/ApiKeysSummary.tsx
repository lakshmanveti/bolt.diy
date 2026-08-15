import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { getApiKeysFromCookies } from '~/components/chat/APIKeyManager';
import { Button } from '~/components/ui/Button';
import {
  extractLlmApiKeysFromDocument,
  resolveStoredProviderApiKey,
  saveLlmPreferences,
  syncLlmPreferencesToCookies,
  userPreferenceDocumentStore,
  userPreferencesReadyStore,
  userPreferencesStore,
} from '~/lib/supabase/user-preferences';
import { classNames } from '~/utils/classNames';

function maskSecret(value: string, visibleStart = 4, visibleEnd = 4): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return '—';
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
      <div className="mt-0.5 text-sm text-bolt-elements-textPrimary break-all">{value}</div>
    </div>
  );
}

export function ApiKeysSummary() {
  const prefs = useStore(userPreferencesStore);
  const preferenceDoc = useStore(userPreferenceDocumentStore);
  const preferencesReady = useStore(userPreferencesReadyStore);
  const [loading, setLoading] = useState(!preferencesReady);
  const [migrationDone, setMigrationDone] = useState(false);

  useEffect(() => {
    setLoading(!preferencesReady);
  }, [preferencesReady]);

  useEffect(() => {
    if (!preferencesReady || migrationDone) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const latestPrefs = userPreferencesStore.get();
        const latestDoc = userPreferenceDocumentStore.get();
        const cookieKeys = getApiKeysFromCookies();

        if (!latestPrefs?.provider?.trim() || !latestPrefs.model?.trim()) {
          return;
        }

        const dbKeys = extractLlmApiKeysFromDocument(latestDoc);
        const hasDbKey = Boolean(resolveStoredProviderApiKey(latestPrefs, latestDoc));
        const hasCookieKey = Boolean(cookieKeys[latestPrefs.provider]?.trim());

        if (!hasDbKey && hasCookieKey) {
          const saved = await saveLlmPreferences({
            ...latestPrefs,
            apiKeys: { ...dbKeys, ...cookieKeys },
          });
          syncLlmPreferencesToCookies(saved);
        }
      } catch {
        // Display falls back to whatever is already in stores/cookies.
      } finally {
        if (!cancelled) {
          setMigrationDone(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [preferencesReady, migrationDone]);

  const provider = prefs?.provider?.trim() || '—';
  const model = prefs?.model?.trim() || '—';

  const apiKey = useMemo(
    () => resolveStoredProviderApiKey(prefs, preferenceDoc),
    [prefs, preferenceDoc],
  );

  const handleCopy = useCallback(async () => {
    if (!apiKey) {
      toast.info('No API key saved in your account');
      return;
    }

    try {
      await navigator.clipboard.writeText(apiKey);
      toast.success('API key copied to clipboard');
    } catch {
      toast.error('Failed to copy API key');
    }
  }, [apiKey]);

  return (
    <div className="space-y-3">
      <SummaryRow label="Provider" value={provider} />
      <SummaryRow label="Model" value={model} />

      <div className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2.5">
        <div className="text-[11px] font-medium uppercase tracking-wide text-bolt-elements-textTertiary">API Key</div>
        <div className="mt-1 flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all text-sm text-bolt-elements-textPrimary font-mono">
            {loading ? 'Loading…' : maskSecret(apiKey)}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || !apiKey}
            onClick={() => void handleCopy()}
            className={classNames('shrink-0', (loading || !apiKey) && 'cursor-not-allowed opacity-50')}
            title={apiKey ? 'Copy API key from your account' : 'No API key saved in your account'}
          >
            <span className="i-ph:copy mr-1.5 h-4 w-4" />
            Copy
          </Button>
        </div>
        {!loading && !apiKey && provider !== '—' && (
          <p className="mt-2 text-xs text-bolt-elements-textTertiary">
            No API key saved in your account for this provider. Add one during setup or in Model Settings.
          </p>
        )}
      </div>
    </div>
  );
}
