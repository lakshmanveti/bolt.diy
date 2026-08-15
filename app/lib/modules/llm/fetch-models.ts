import type { ModelInfo } from '~/lib/modules/llm/types';

const cache = new Map<string, ModelInfo[]>();
const inflight = new Map<string, Promise<ModelInfo[]>>();

function cacheKey(provider?: string) {
  return provider?.trim() || '*';
}

function modelsUrl(provider?: string) {
  return provider?.trim() ? `/api/models/${encodeURIComponent(provider.trim())}` : '/api/models';
}

export function invalidateModelList(provider?: string) {
  if (provider?.trim()) {
    cache.delete(provider.trim());
    cache.delete('*');
    return;
  }

  cache.clear();
}

export async function fetchModelList(provider?: string): Promise<ModelInfo[]> {
  const key = cacheKey(provider);
  const cached = cache.get(key);

  if (cached) {
    return cached;
  }

  if (inflight.has(key)) {
    return inflight.get(key)!;
  }

  const request = fetch(modelsUrl(provider))
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load models (${response.status})`);
      }

      const payload = (await response.json()) as { modelList?: ModelInfo[] };
      const list = payload.modelList ?? [];
      cache.set(key, list);

      return list;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, request);

  return request;
}
