/**
 * WebContainer boot is disabled — BuildLive uses Docker runtime only.
 * Legacy imports still resolve; awaiting this promise rejects.
 */
import type { WebContainer } from '@webcontainer/api';

interface WebContainerContext {
  loaded: boolean;
}

export const webcontainerContext: WebContainerContext = import.meta.hot?.data.webcontainerContext ?? {
  loaded: false,
};

if (import.meta.hot) {
  import.meta.hot.data.webcontainerContext = webcontainerContext;
}

const DISABLED = new Error(
  'WebContainer is disabled in BuildLive. Use the Docker runtime daemon (`pnpm runtime:daemon`).',
);

export let webcontainer: Promise<WebContainer> = Promise.reject(DISABLED);

// Avoid unhandled rejection noise from the module-level promise
webcontainer.catch(() => undefined);

if (import.meta.hot) {
  import.meta.hot.data.webcontainer = webcontainer;
}
