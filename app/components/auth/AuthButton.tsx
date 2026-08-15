import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@remix-run/react';
import { useStore } from '@nanostores/react';
import * as Popover from '@radix-ui/react-popover';
import { toast } from 'react-toastify';
import type { User } from '@supabase/supabase-js';
import {
  authReadyStore,
  authUserStore,
  initSupabaseAuth,
  isSupabaseConfigured,
  sendPasswordRecoveryEmail,
  signOut,
} from '~/lib/supabase/client';
import { Dialog, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { ThemeSwitch } from '~/components/ui/ThemeSwitch';
import { TAB_LABELS, TAB_DESCRIPTIONS, PRIMARY_INTEGRATION_TABS, DEFAULT_TAB_CONFIG } from '~/components/@settings/core/constants';
import type { TabType } from '~/components/@settings/core/types';
import { useVisibleUserTabs } from '~/components/@settings/core/useVisibleUserTabs';
import { openSettingsTab } from '~/lib/stores/settings-modal';
import { openSupportWhatsApp } from '~/utils/support';
import { classNames } from '~/utils/classNames';
import { Tooltip } from '~/components/ui/Tooltip';

export function AuthBootstrap() {
  useEffect(() => {
    void initSupabaseAuth().then(() => {
      void import('~/lib/supabase/user-preferences').then(({ loadUserPreferenceDocument }) => {
        void loadUserPreferenceDocument();
      });
    });
  }, []);

  return null;
}

const INTEGRATION_TAB_SET = new Set<TabType>(PRIMARY_INTEGRATION_TABS);

const menuButtonClass =
  'flex w-full items-center gap-2 rounded-md border border-accent-500/50 bg-bolt-elements-background-depth-2 px-2.5 py-2 text-left text-sm text-bolt-elements-textPrimary hover:bg-accent-500/10';

const TAB_MENU_ICONS: Partial<Record<TabType, string>> = {
  profile: 'i-ph:user-circle',
  settings: 'i-ph:gear-six',
  notifications: 'i-ph:bell',
  features: 'i-ph:star',
  data: 'i-ph:database',
  'cloud-providers': 'i-ph:sliders-horizontal',
  'local-providers': 'i-ph:laptop',
  github: 'i-ph:github-logo',
  gitlab: 'i-ph:gitlab-logo',
  netlify: 'i-ph:cloud-arrow-up',
  vercel: 'i-ph:triangle',
  supabase: 'i-ph:database',
  'event-logs': 'i-ph:list-bullets',
  mcp: 'i-ph:wrench',
  subscription: 'i-ph:receipt',
};

function getInitials(user: User): string {
  const meta = user.user_metadata as { full_name?: string; name?: string; username?: string } | undefined;
  const name = meta?.full_name || meta?.name || meta?.username;

  if (name?.trim()) {
    const parts = name.trim().split(/\s+/).filter(Boolean);

    if (parts.length >= 2) {
      return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
    }

    return parts[0]!.slice(0, 2).toUpperCase();
  }

  const email = user.email || '';
  const local = email.split('@')[0] || 'U';

  if (local.includes('.') || local.includes('_') || local.includes('-')) {
    const parts = local.split(/[._-]/).filter(Boolean);

    if (parts.length >= 2) {
      return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
    }
  }

  return local.slice(0, 2).toUpperCase();
}

function displayName(user: User): string {
  const meta = user.user_metadata as { full_name?: string; name?: string; username?: string } | undefined;
  return meta?.full_name || meta?.name || meta?.username || user.email?.split('@')[0] || 'Account';
}

function menuLabelForTab(tabId: TabType): string {
  return TAB_LABELS[tabId];
}

function MenuGlyph({ icon, tip }: { icon: string; tip: string }) {
  return (
    <Tooltip content={tip} delayDuration={250} side="left">
      <span className={classNames(icon, 'h-4 w-4 shrink-0 text-accent-500')} />
    </Tooltip>
  );
}

function ProfileDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-bolt-elements-textTertiary">{label}</div>
      <div className="mt-0.5 text-sm text-bolt-elements-textPrimary break-all">{value}</div>
    </div>
  );
}

interface AuthButtonProps {
  /** Sidebar footer (default) or compact header placement */
  layout?: 'sidebar' | 'header';
}

export function AuthButton({ layout = 'sidebar' }: AuthButtonProps) {
  const user = useStore(authUserStore);
  const ready = useStore(authReadyStore);
  const visibleTabs = useVisibleUserTabs();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  const initials = useMemo(() => (user ? getInitials(user) : ''), [user]);

  const { modelSettingsTab, tabsBeforeIntegrations, tabsAfterIntegrations } = useMemo(() => {
    const modelSettings = visibleTabs.find((tab) => tab.id === 'cloud-providers');
    const other = visibleTabs.filter((tab) => !INTEGRATION_TAB_SET.has(tab.id) && tab.id !== 'cloud-providers');
    const integrationsSlotOrder = DEFAULT_TAB_CONFIG.find((tab) => tab.id === 'local-providers')?.order ?? 8;
    const before = other.filter((tab) => tab.order < integrationsSlotOrder);
    const after = other.filter((tab) => tab.order >= integrationsSlotOrder);

    return {
      modelSettingsTab: modelSettings,
      tabsBeforeIntegrations: before,
      tabsAfterIntegrations: after,
    };
  }, [visibleTabs]);

  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!ready) {
    return <div className="px-4 py-2 text-xs text-bolt-elements-textTertiary">Auth…</div>;
  }

  if (!user) {
    return null;
  }

  const memberSince = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : '—';

  const lastSignIn = user.last_sign_in_at
    ? new Date(user.last_sign_in_at).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  const handleSignOut = async () => {
    try {
      await signOut();
      toast.success('Signed out');
      navigate('/login', { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sign out failed');
    }
  };

  const openAccount = () => {
    setMenuOpen(false);
    setAccountOpen(true);
  };

  const openTab = (tabId: TabType) => {
    setMenuOpen(false);
    openSettingsTab(tabId);
  };

  const handleSendRecovery = async () => {
    if (!user.email) {
      toast.error('No email address on file');
      return;
    }

    setRecoveryBusy(true);

    try {
      await sendPasswordRecoveryEmail(user.email);
      toast.success(`Password recovery email sent to ${user.email}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send recovery email');
    } finally {
      setRecoveryBusy(false);
    }
  };

  const wrapperClass =
    layout === 'header' ? 'shrink-0' : 'border-t border-bolt-elements-borderColor px-4 py-3';

  return (
    <>
      <div className={wrapperClass}>
        <Popover.Root open={menuOpen} onOpenChange={setMenuOpen}>
          <Tooltip content={user.email || 'Account menu'} delayDuration={200}>
            <span className="inline-flex">
              <Popover.Trigger asChild>
                <button
                  type="button"
                  className={classNames(
                    'inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold',
                    'bg-accent-500 text-white hover:bg-accent-600',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40',
                  )}
                  aria-label="Open account menu"
                >
                  {initials}
                </button>
              </Popover.Trigger>
            </span>
          </Tooltip>

          <Popover.Portal>
            <Popover.Content
              side={layout === 'header' ? 'bottom' : 'top'}
              align={layout === 'header' ? 'end' : 'start'}
              sideOffset={10}
              className={classNames(
                'z-[1100] w-[300px] rounded-lg border border-bolt-elements-borderColor',
                'bg-bolt-elements-background-depth-1 p-3 shadow-xl',
                'animate-in fade-in-0 zoom-in-95',
              )}
            >
              <div className="flex items-center gap-3 border-b border-bolt-elements-borderColor pb-3">
                <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-500 text-sm font-semibold text-white">
                  {initials}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-bolt-elements-textPrimary">{displayName(user)}</div>
                  <div className="truncate text-xs text-bolt-elements-textSecondary">{user.email}</div>
                </div>
              </div>

              <div className="max-h-[90vh] pt-2 space-y-1.5">
                <button type="button" onClick={openAccount} className={menuButtonClass}>
                  <MenuGlyph icon="i-ph:user-circle" tip="Your profile and sign-in details" />
                  <span>Account</span>
                </button>

                {modelSettingsTab && (
                  <button type="button" onClick={() => openTab(modelSettingsTab.id)} className={menuButtonClass}>
                    <MenuGlyph
                      icon={TAB_MENU_ICONS[modelSettingsTab.id] || 'i-ph:sliders-horizontal'}
                      tip={TAB_DESCRIPTIONS[modelSettingsTab.id]}
                    />
                    <span>{menuLabelForTab(modelSettingsTab.id)}</span>
                  </button>
                )}

                <button type="button" onClick={() => openTab('subscription')} className={menuButtonClass}>
                  <MenuGlyph icon="i-ph:receipt" tip={TAB_DESCRIPTIONS.subscription} />
                  <span>Billing</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    openSupportWhatsApp();
                  }}
                  className={menuButtonClass}
                >
                  <MenuGlyph icon="i-ph:whatsapp-logo" tip="Chat with support on WhatsApp" />
                  <span>Support</span>
                </button>

                {tabsBeforeIntegrations.map((tab) => (
                  <button key={tab.id} type="button" onClick={() => openTab(tab.id)} className={menuButtonClass}>
                    <MenuGlyph
                      icon={TAB_MENU_ICONS[tab.id] || 'i-ph:gear-six'}
                      tip={TAB_DESCRIPTIONS[tab.id]}
                    />
                    <span>{menuLabelForTab(tab.id)}</span>
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    openSettingsTab('integrations');
                  }}
                  className={menuButtonClass}
                >
                  <MenuGlyph icon="i-ph:plugs-connected" tip="Connect GitHub, GitLab, Netlify, Vercel, and Supabase" />
                  <span>Integrations</span>
                </button>

                {tabsAfterIntegrations.map((tab) => (
                  <button key={tab.id} type="button" onClick={() => openTab(tab.id)} className={menuButtonClass}>
                    <MenuGlyph
                      icon={TAB_MENU_ICONS[tab.id] || 'i-ph:gear-six'}
                      tip={TAB_DESCRIPTIONS[tab.id]}
                    />
                    <span>{menuLabelForTab(tab.id)}</span>
                  </button>
                ))}

                <button type="button" onClick={() => void handleSignOut()} className={menuButtonClass}>
                  <MenuGlyph icon="i-ph:sign-out" tip="Sign out of your account" />
                  <span>Sign out</span>
                </button>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-bolt-elements-borderColor pt-3">
                <span className="text-xs text-bolt-elements-textSecondary">Theme</span>
                <ThemeSwitch />
              </div>

              <Popover.Arrow className="fill-bolt-elements-background-depth-1" />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      <DialogRoot open={accountOpen} onOpenChange={setAccountOpen}>
        <Dialog className="w-[min(100vw-2rem,420px)]" onClose={() => setAccountOpen(false)}>
          <div className="p-6">
            <DialogTitle>Account</DialogTitle>
            <DialogDescription>Your sign-in details and security options.</DialogDescription>

            <div className="mt-5 flex items-center gap-3">
              <div className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-500 text-base font-semibold text-white">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="truncate text-base font-medium text-bolt-elements-textPrimary">{displayName(user)}</div>
                <div className="truncate text-sm text-bolt-elements-textSecondary">{user.email}</div>
              </div>
            </div>

            <div className="mt-5 space-y-2">
              <ProfileDetail label="Email" value={user.email || '—'} />
              <ProfileDetail
                label="Email verified"
                value={user.email_confirmed_at ? 'Yes' : 'Pending verification'}
              />
              <ProfileDetail label="Member since" value={memberSince} />
              <ProfileDetail label="Last sign in" value={lastSignIn} />
            </div>

            <div className="mt-6 border-t border-bolt-elements-borderColor pt-4">
              <button
                type="button"
                disabled={recoveryBusy || !user.email}
                onClick={() => void handleSendRecovery()}
                className={classNames(menuButtonClass, 'justify-center disabled:opacity-50')}
              >
                <span className="i-ph:envelope-simple h-4 w-4 shrink-0 text-accent-500" />
                <span>{recoveryBusy ? 'Sending…' : 'Send password recovery'}</span>
              </button>
              <p className="mt-2 text-xs text-bolt-elements-textTertiary">
                We&apos;ll email a secure link to reset your password.
              </p>
            </div>
          </div>
        </Dialog>
      </DialogRoot>
    </>
  );
}
