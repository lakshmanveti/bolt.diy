import { atom } from 'nanostores';
import type { TabType } from '~/components/@settings/core/types';

export type SettingsModalView = TabType | 'integrations';
export type SettingsModalIntent = 'add-backend' | null;

export const activeSettingsTabStore = atom<SettingsModalView | null>(null);
export const settingsModalReturnStore = atom<SettingsModalView | null>(null);
export const settingsModalIntentStore = atom<SettingsModalIntent>(null);

/** Chat should send the Add-backend follow-up after the settings modal closes. */
export const addBackendFollowupRequest = atom(false);

export function openSettingsTab(
  tab: SettingsModalView,
  options?: { from?: SettingsModalView; intent?: SettingsModalIntent },
) {
  settingsModalReturnStore.set(options?.from ?? null);
  settingsModalIntentStore.set(options?.intent ?? null);
  activeSettingsTabStore.set(tab);
}

export function closeSettingsTab() {
  activeSettingsTabStore.set(null);
  settingsModalReturnStore.set(null);
  settingsModalIntentStore.set(null);
}

export function goBackSettingsTab() {
  const back = settingsModalReturnStore.get();
  settingsModalReturnStore.set(null);
  activeSettingsTabStore.set(back);
}

export function requestAddBackendFollowup() {
  addBackendFollowupRequest.set(true);
}

export function consumeAddBackendFollowup() {
  addBackendFollowupRequest.set(false);
}
