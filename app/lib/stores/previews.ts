import type { WebContainer } from '@webcontainer/api';
import { atom } from 'nanostores';

// Extend Window interface to include our custom property
declare global {
  interface Window {
    _tabId?: string;
  }
}

export interface PreviewInfo {
  port: number;
  ready: boolean;
  baseUrl: string;
}

// Create a broadcast channel for preview updates
const PREVIEW_CHANNEL = 'preview-updates';

export class PreviewsStore {
  #availablePreviews = new Map<number, PreviewInfo>();
  #webcontainer: Promise<WebContainer>;
  #broadcastChannel?: BroadcastChannel;
  #lastUpdate = new Map<string, number>();
  #watchedFiles = new Set<string>();
  #refreshTimeouts = new Map<string, NodeJS.Timeout>();
  #REFRESH_DELAY = 300;
  #storageChannel?: BroadcastChannel;
  #previewVerifyGeneration = 0;

  previews = atom<PreviewInfo[]>([]);

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;
    this.#broadcastChannel = this.#maybeCreateChannel(PREVIEW_CHANNEL);
    this.#storageChannel = this.#maybeCreateChannel('storage-sync-channel');

    if (this.#broadcastChannel) {
      // Listen for preview updates from other tabs
      this.#broadcastChannel.onmessage = (event) => {
        const { type, previewId } = event.data;

        if (type === 'file-change') {
          const timestamp = event.data.timestamp;
          const lastUpdate = this.#lastUpdate.get(previewId) || 0;

          if (timestamp > lastUpdate) {
            this.#lastUpdate.set(previewId, timestamp);
            this.refreshPreview(previewId);
          }
        }
      };
    }

    if (this.#storageChannel) {
      // Listen for storage sync messages
      this.#storageChannel.onmessage = (event) => {
        const { storage, source } = event.data;

        if (storage && source !== this._getTabId()) {
          this._syncStorage(storage);
        }
      };
    }

    // Override localStorage setItem to catch all changes
    if (typeof window !== 'undefined') {
      const originalSetItem = localStorage.setItem;

      localStorage.setItem = (...args) => {
        originalSetItem.apply(localStorage, args);
        this._broadcastStorageSync();
      };
    }

    this.#init();
  }

  #maybeCreateChannel(name: string): BroadcastChannel | undefined {
    if (typeof globalThis === 'undefined') {
      return undefined;
    }

    const globalBroadcastChannel = (
      globalThis as typeof globalThis & {
        BroadcastChannel?: typeof BroadcastChannel;
      }
    ).BroadcastChannel;

    if (typeof globalBroadcastChannel !== 'function') {
      return undefined;
    }

    try {
      return new globalBroadcastChannel(name);
    } catch (error) {
      console.warn('[Preview] BroadcastChannel unavailable:', error);
      return undefined;
    }
  }

  // Generate a unique ID for this tab
  private _getTabId(): string {
    if (typeof window !== 'undefined') {
      if (!window._tabId) {
        window._tabId = Math.random().toString(36).substring(2, 15);
      }

      return window._tabId;
    }

    return '';
  }

  // Sync storage data between tabs
  private _syncStorage(storage: Record<string, string>) {
    if (typeof window !== 'undefined') {
      Object.entries(storage).forEach(([key, value]) => {
        try {
          const originalSetItem = Object.getPrototypeOf(localStorage).setItem;
          originalSetItem.call(localStorage, key, value);
        } catch (error) {
          console.error('[Preview] Error syncing storage:', error);
        }
      });

      // Force a refresh after syncing storage
      const previews = this.previews.get();
      previews.forEach((preview) => {
        const previewId = this.getPreviewId(preview.baseUrl);

        if (previewId) {
          this.refreshPreview(previewId);
        }
      });

      // Reload the page content
      if (typeof window !== 'undefined' && window.location) {
        const iframe = document.querySelector('iframe');

        if (iframe) {
          iframe.src = iframe.src;
        }
      }
    }
  }

  // Broadcast storage state to other tabs
  private _broadcastStorageSync() {
    if (typeof window !== 'undefined') {
      const storage: Record<string, string> = {};

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);

        if (key) {
          storage[key] = localStorage.getItem(key) || '';
        }
      }

      this.#storageChannel?.postMessage({
        type: 'storage-sync',
        storage,
        source: this._getTabId(),
        timestamp: Date.now(),
      });
    }
  }

  async #init() {
    // Docker-only previews — WebContainer port listeners removed
    void this.#initDockerPreviews();
  }

  #markPreviewUnreachable(baseUrl: string) {
    const next = this.previews.get().map((p) => (p.baseUrl === baseUrl ? { ...p, ready: false } : p));
    this.previews.set(next);
  }

  async #verifyAndRecoverPreview(
    runtime: Awaited<ReturnType<typeof import('~/lib/runtime').getDockerRuntime>>,
    preview: { port: number; ready: boolean; baseUrl: string },
  ) {
    if (!preview.ready || !preview.baseUrl) {
      return;
    }

    const { previewHealthStore, MAX_PREVIEW_AUTO_RETRIES } = await import('~/lib/stores/preview-health');
    const { dockerPreviewBusy, verifyPreviewReachable } = await import('~/lib/runtime');
    const { streamingState } = await import('~/lib/stores/streaming');

    if (streamingState.get()) {
      return;
    }

    const generation = ++this.#previewVerifyGeneration;
    let retries = 0;
    let currentUrl = preview.baseUrl;

    previewHealthStore.set({ status: 'checking', autoRetryCount: 0 });

    while (retries <= MAX_PREVIEW_AUTO_RETRIES) {
      if (generation !== this.#previewVerifyGeneration || streamingState.get()) {
        return;
      }

      while (dockerPreviewBusy.get()) {
        if (streamingState.get()) {
          return;
        }

        previewHealthStore.set({
          status: 'recovering',
          autoRetryCount: retries,
          message: 'Updating preview…',
        });
        await new Promise((r) => setTimeout(r, 300));

        if (generation !== this.#previewVerifyGeneration || streamingState.get()) {
          return;
        }
      }

      const reachable = await verifyPreviewReachable(currentUrl);

      if (reachable) {
        previewHealthStore.set({ status: 'healthy', autoRetryCount: retries });
        return;
      }

      if (retries >= MAX_PREVIEW_AUTO_RETRIES) {
        this.#markPreviewUnreachable(currentUrl);
        previewHealthStore.set({
          status: 'unreachable',
          autoRetryCount: retries,
          message: 'Preview URL did not respond. Try restarting the preview.',
        });
        return;
      }

      previewHealthStore.set({
        status: 'recovering',
        autoRetryCount: retries,
        message: 'Preview not responding — auto-retrying…',
      });

      retries += 1;
      const recovered = await runtime.recoverPreview();

      if (generation !== this.#previewVerifyGeneration) {
        return;
      }

      if (!recovered?.ready || !recovered.baseUrl) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }

      currentUrl = recovered.baseUrl;
    }
  }

  async retryPreviewRecovery(): Promise<boolean> {
    const { getDockerRuntime } = await import('~/lib/runtime');
    const { previewHealthStore } = await import('~/lib/stores/preview-health');
    const runtime = getDockerRuntime();

    previewHealthStore.set({ status: 'recovering', autoRetryCount: 0, message: 'Restarting preview…' });

    const recovered = await runtime.recoverPreview();

    if (!recovered?.ready || !recovered.baseUrl) {
      previewHealthStore.set({
        status: 'unreachable',
        autoRetryCount: 0,
        message: 'Could not restart preview. Try Retry.',
      });
      return false;
    }

    await this.#verifyAndRecoverPreview(runtime, recovered);
    return previewHealthStore.get().status === 'healthy';
  }

  async #initDockerPreviews() {
    try {
      const { getDockerRuntime } = await import('~/lib/runtime');
      const runtime = getDockerRuntime();

      runtime.onPreview((preview) => {
        const port = preview.port;
        const isLocalhost =
          preview.baseUrl.includes('127.0.0.1') || preview.baseUrl.includes('localhost');

        /*
         * Docker maps random host ports per container. Keep only the latest
         * localhost preview so the iframe does not stick on a dead old port.
         */
        if (preview.ready && isLocalhost) {
          for (const [existingPort, info] of this.#availablePreviews) {
            if (
              existingPort !== port &&
              (info.baseUrl.includes('127.0.0.1') || info.baseUrl.includes('localhost'))
            ) {
              this.#availablePreviews.delete(existingPort);
            }
          }
        }

        const nextPreviews = this.previews
          .get()
          .filter(
            (p) =>
              p.port === port ||
              !(p.baseUrl.includes('127.0.0.1') || p.baseUrl.includes('localhost')),
          )
          .filter((p) => p.port !== port);

        const previewInfo: PreviewInfo = {
          port,
          ready: preview.ready,
          baseUrl: preview.baseUrl,
        };
        const previous = this.#availablePreviews.get(port);

        if (previous?.baseUrl === previewInfo.baseUrl && previous.ready === previewInfo.ready) {
          return;
        }

        this.#availablePreviews.set(port, previewInfo);
        nextPreviews.push(previewInfo);
        this.previews.set(nextPreviews);

        if (preview.ready) {
          console.log('[Preview] Docker preview ready:', preview.baseUrl);
          void this.#verifyAndRecoverPreview(runtime, preview);
        }
      });
    } catch (error) {
      console.warn('[Preview] Docker preview listener unavailable:', error);
    }
  }

  // Helper to extract preview ID from URL (WebContainer or Docker localhost)
  getPreviewId(url: string): string | null {
    const wcMatch = url.match(/^https?:\/\/([^.]+)\.local-credentialless\.webcontainer-api\.io/);

    if (wcMatch) {
      return wcMatch[1];
    }

    try {
      const parsed = new URL(url);

      if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') {
        return `local-${parsed.port || '80'}`;
      }
    } catch {
      // ignore
    }

    return null;
  }

  // Broadcast state change to all tabs
  broadcastStateChange(previewId: string) {
    const timestamp = Date.now();
    this.#lastUpdate.set(previewId, timestamp);

    this.#broadcastChannel?.postMessage({
      type: 'state-change',
      previewId,
      timestamp,
    });
  }

  // Broadcast file change to all tabs
  broadcastFileChange(previewId: string) {
    const timestamp = Date.now();
    this.#lastUpdate.set(previewId, timestamp);

    this.#broadcastChannel?.postMessage({
      type: 'file-change',
      previewId,
      timestamp,
    });
  }

  // Broadcast update to all tabs
  broadcastUpdate(url: string) {
    const previewId = this.getPreviewId(url);

    if (previewId) {
      const timestamp = Date.now();
      this.#lastUpdate.set(previewId, timestamp);

      this.#broadcastChannel?.postMessage({
        type: 'file-change',
        previewId,
        timestamp,
      });
    }
  }

  // Method to refresh a specific preview
  refreshPreview(previewId: string) {
    // Clear any pending refresh for this preview
    const existingTimeout = this.#refreshTimeouts.get(previewId);

    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Set a new timeout for this refresh
    const timeout = setTimeout(() => {
      const previews = this.previews.get();
      const preview = previews.find((p) => this.getPreviewId(p.baseUrl) === previewId);

      if (preview) {
        const isDockerLocal =
          preview.baseUrl.includes('127.0.0.1') || preview.baseUrl.includes('localhost');

        if (isDockerLocal) {
          // URL stays stable; iframe reload is driven by dockerPreviewReloadToken
          this.#refreshTimeouts.delete(previewId);
          return;
        }

        preview.ready = false;
        this.previews.set([...previews]);

        requestAnimationFrame(() => {
          preview.ready = true;
          this.previews.set([...previews]);
        });
      }

      this.#refreshTimeouts.delete(previewId);
    }, this.#REFRESH_DELAY);

    this.#refreshTimeouts.set(previewId, timeout);
  }

  refreshAllPreviews() {
    const previews = this.previews.get();

    for (const preview of previews) {
      const previewId = this.getPreviewId(preview.baseUrl);

      if (previewId) {
        this.broadcastFileChange(previewId);
        this.refreshPreview(previewId);
      }
    }
  }
}

// Create a singleton instance
let previewsStore: PreviewsStore | null = null;

export function usePreviewStore() {
  if (!previewsStore) {
    /*
     * Initialize with a Promise that resolves to WebContainer
     * This should match how you're initializing WebContainer elsewhere
     */
    previewsStore = new PreviewsStore(Promise.resolve({} as WebContainer));
  }

  return previewsStore;
}

export async function retryPreviewRecovery(): Promise<boolean> {
  return usePreviewStore().retryPreviewRecovery();
}
