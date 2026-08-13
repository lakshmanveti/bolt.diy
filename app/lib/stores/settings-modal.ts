import { atom } from 'nanostores';
import type { TabType } from '~/components/@settings/core/types';

export const activeSettingsTabStore = atom<TabType | null>(null);

export function openSettingsTab(tab: TabType) {
  activeSettingsTabStore.set(tab);
}

export function closeSettingsTab() {
  activeSettingsTabStore.set(null);
}
