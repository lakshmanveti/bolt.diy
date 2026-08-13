import { atom } from 'nanostores';

/** Shared drawer open state so consumer chrome can open history without edge-hover. */
export const sidebarOpenStore = atom(false);

export function openSidebar() {
  sidebarOpenStore.set(true);
}

export function closeSidebar() {
  sidebarOpenStore.set(false);
}

export function toggleSidebar() {
  sidebarOpenStore.set(!sidebarOpenStore.get());
}
