import { useStore } from '@nanostores/react';
import { PRIMARY_INTEGRATION_TABS, TAB_DESCRIPTIONS, TAB_ICONS, TAB_LABELS } from '~/components/@settings/core/constants';
import type { TabType } from '~/components/@settings/core/types';
import { isGitHubConnected } from '~/lib/stores/githubConnection';
import { isGitLabConnected } from '~/lib/stores/gitlabConnection';
import { netlifyConnection } from '~/lib/stores/netlify';
import { vercelConnection } from '~/lib/stores/vercel';
import { openSettingsTab } from '~/lib/stores/settings-modal';
import { classNames } from '~/utils/classNames';
import { Tooltip } from '~/components/ui/Tooltip';

function useIntegrationConnected(tabId: TabType): boolean {
  const github = useStore(isGitHubConnected);
  const gitlab = useStore(isGitLabConnected);
  const netlify = useStore(netlifyConnection);
  const vercel = useStore(vercelConnection);

  switch (tabId) {
    case 'github':
      return github;
    case 'gitlab':
      return gitlab;
    case 'netlify':
      return Boolean(netlify.user);
    case 'vercel':
      return Boolean(vercel.user);
    default:
      return false;
  }
}

function IntegrationCard({ tabId }: { tabId: TabType }) {
  const connected = useIntegrationConnected(tabId);
  const Icon = TAB_ICONS[tabId];

  return (
    <button
      type="button"
      onClick={() => openSettingsTab(tabId, { from: 'integrations' })}
      className={classNames(
        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors',
        'border-bolt-elements-borderColor bg-bolt-elements-background-depth-2',
        'hover:border-accent-500/40 hover:bg-accent-500/10',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-bolt-elements-textPrimary">
            <Tooltip content={TAB_DESCRIPTIONS[tabId]} delayDuration={200}>
              <span className="inline-flex shrink-0">
                <Icon className="h-4 w-4 text-accent-500" />
              </span>
            </Tooltip>
            {TAB_LABELS[tabId]}
          </span>
          <span
            className={classNames(
              'shrink-0 text-[11px] font-medium',
              connected ? 'text-green-500' : 'text-bolt-elements-textTertiary',
            )}
          >
            {connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <p className="mt-0.5 pl-6 text-xs text-bolt-elements-textSecondary">{TAB_DESCRIPTIONS[tabId]}</p>
      </div>
    </button>
  );
}

export default function IntegrationsHub() {
  return (
    <div className="space-y-2">
      {PRIMARY_INTEGRATION_TABS.map((tabId) => (
        <IntegrationCard key={tabId} tabId={tabId} />
      ))}
    </div>
  );
}
