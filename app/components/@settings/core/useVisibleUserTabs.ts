import { useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { DEFAULT_TAB_CONFIG } from './constants';
import type { TabType, UserTabConfig } from './types';
import { profileStore } from '~/lib/stores/profile';
import { resetTabConfiguration, tabConfigurationStore } from '~/lib/stores/settings';

/** Always-available app settings (not only integration tiles from DEFAULT_TAB_CONFIG). */
const CORE_APP_TABS: TabType[] = ['settings', 'notifications', 'features', 'data'];

/** Profile is the Account row. Local Providers stays in Control Panel, not the avatar menu. */
const AVATAR_MENU_EXCLUDED_TABS = new Set<TabType>(['profile', 'local-providers']);

export function useVisibleUserTabs() {
  const tabConfiguration = useStore(tabConfigurationStore);
  const profile = useStore(profileStore);

  return useMemo(() => {
    if (!tabConfiguration?.userTabs || !Array.isArray(tabConfiguration.userTabs)) {
      resetTabConfiguration();
      return [];
    }

    const notificationsDisabled = profile?.preferences?.notifications === false;

    const configured = tabConfiguration.userTabs
      .filter((tab) => {
        if (!tab?.id) {
          return false;
        }

        if (tab.id === 'notifications' && notificationsDisabled) {
          return false;
        }

        if (AVATAR_MENU_EXCLUDED_TABS.has(tab.id)) {
          return false;
        }

        return tab.visible && tab.window === 'user';
      })
      .sort((a, b) => a.order - b.order);

    const seen = new Set(configured.map((tab) => tab.id));
    const coreExtras: UserTabConfig[] = [];

    for (const id of CORE_APP_TABS) {
      if (!seen.has(id)) {
        const fallback = DEFAULT_TAB_CONFIG.find((tab) => tab.id === id);

        coreExtras.push({
          id,
          visible: true,
          window: 'user',
          order: fallback?.order ?? 100,
        });
        seen.add(id);
      }
    }

    return [...configured, ...coreExtras].sort((a, b) => a.order - b.order);
  }, [tabConfiguration, profile?.preferences?.notifications]);
}
