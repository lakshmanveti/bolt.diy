import { atom } from 'nanostores';
import type { TabType } from '~/components/@settings/core/types';

export type SettingsModalView = TabType | 'integrations';

export const activeSettingsTabStore = atom<SettingsModalView | null>(null);
export const settingsModalReturnStore = atom<SettingsModalView | null>(null);

export function openSettingsTab(tab: SettingsModalView, options?: { from?: SettingsModalView }) {
  settingsModalReturnStore.set(options?.from ?? null);
  activeSettingsTabStore.set(tab);
}

export function closeSettingsTab() {
  activeSettingsTabStore.set(null);
  settingsModalReturnStore.set(null);
}

export function goBackSettingsTab() {
  const back = settingsModalReturnStore.get();
  settingsModalReturnStore.set(null);
  activeSettingsTabStore.set(back);
}
