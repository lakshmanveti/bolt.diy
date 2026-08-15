import { useEffect } from 'react';
import { useStore } from '@nanostores/react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { classNames } from '~/utils/classNames';
import { DialogTitle } from '~/components/ui/Dialog';
import { TAB_DESCRIPTIONS, TAB_LABELS } from './constants';
import type { TabType } from './types';
import { getSettingsTabComponent } from './getSettingsTabComponent';
import IntegrationsHub from '~/components/@settings/tabs/integrations/IntegrationsHub';
import {
  activeSettingsTabStore,
  closeSettingsTab,
  goBackSettingsTab,
  settingsModalReturnStore,
  type SettingsModalView,
} from '~/lib/stores/settings-modal';
import { useFeatures } from '~/lib/hooks/useFeatures';
import { useNotifications } from '~/lib/hooks/useNotifications';
import { useConnectionStatus } from '~/lib/hooks/useConnectionStatus';
import { Tooltip } from '~/components/ui/Tooltip';

function isSettingsTab(view: SettingsModalView): view is TabType {
  return view !== 'integrations';
}

export function SettingsTabModal() {
  const activeTab = useStore(activeSettingsTabStore);
  const returnTo = useStore(settingsModalReturnStore);
  const open = activeTab !== null;
  const { acknowledgeAllFeatures } = useFeatures();
  const { markAllAsRead } = useNotifications();
  const { acknowledgeIssue } = useConnectionStatus();

  useEffect(() => {
    if (!activeTab || !isSettingsTab(activeTab)) {
      return;
    }

    switch (activeTab) {
      case 'features':
        acknowledgeAllFeatures();
        break;
      case 'notifications':
        markAllAsRead();
        break;
      case 'github':
      case 'gitlab':
      case 'supabase':
      case 'vercel':
      case 'netlify':
        acknowledgeIssue();
        break;
      default:
        break;
    }
  }, [activeTab, acknowledgeAllFeatures, markAllAsRead, acknowledgeIssue]);

  if (!activeTab) {
    return null;
  }

  const isHub = activeTab === 'integrations';
  const title = isHub ? 'Integrations' : TAB_LABELS[activeTab];
  const description = isHub
    ? 'Connect GitHub, GitLab, Netlify, Vercel, and Supabase'
    : TAB_DESCRIPTIONS[activeTab];

  return (
    <RadixDialog.Root open={open} onOpenChange={(next) => !next && closeSettingsTab()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[1200] bg-black/70 backdrop-blur-sm" />
        <RadixDialog.Content
          aria-describedby={description ? 'settings-tab-description' : undefined}
          className={classNames(
            'fixed top-1/2 left-1/2 z-[1201] w-[min(100vw-2rem,720px)] max-h-[min(90vh,860px)]',
            '-translate-x-1/2 -translate-y-1/2',
            'flex flex-col overflow-hidden rounded-xl border border-bolt-elements-borderColor',
            'bg-bolt-elements-background-depth-1 shadow-2xl',
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-bolt-elements-borderColor px-5 py-4">
            <div className="min-w-0">
              {returnTo ? (
                <Tooltip content="Back to all integrations" delayDuration={200}>
                  <button
                    type="button"
                    onClick={goBackSettingsTab}
                    className="mb-1 inline-flex items-center gap-1 text-xs text-accent-500 hover:underline"
                  >
                    <span className="i-ph:arrow-left h-3.5 w-3.5" />
                    All integrations
                  </button>
                </Tooltip>
              ) : null}
              <DialogTitle className="text-lg font-semibold text-bolt-elements-textPrimary">{title}</DialogTitle>
              {description && (
                <p id="settings-tab-description" className="mt-1 text-sm text-bolt-elements-textSecondary">
                  {description}
                </p>
              )}
            </div>
            <Tooltip content="Close" delayDuration={200}>
              <button
                type="button"
                onClick={closeSettingsTab}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-accent-500/50 bg-bolt-elements-background-depth-2 text-accent-500 hover:bg-accent-500/10"
                aria-label="Close"
              >
                <span className="i-ph:x h-4 w-4" />
              </button>
            </Tooltip>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 modern-scrollbar">
            {isHub ? <IntegrationsHub /> : getSettingsTabComponent(activeTab)}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
