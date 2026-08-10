import { modelNeedsThinkingDisabled, modelRejectsTemperature } from './model-capabilities';

/**
 * Compat fetch for newer Anthropic models used with older @ai-sdk/anthropic:
 * - AI SDK v4 defaults temperature to 0; Sonnet 5 / Opus 4.7+ reject sampling params
 * - Sonnet 5 enables adaptive thinking by default and streams `thinking` blocks the SDK can't parse
 */
export function createSamplingParamStrippingFetch(modelId: string, baseFetch: typeof fetch = fetch): typeof fetch {
  const stripSampling = modelRejectsTemperature(modelId);
  const disableThinking = modelNeedsThinkingDisabled(modelId);

  if (!stripSampling && !disableThinking) {
    return baseFetch;
  }

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        const parsed = JSON.parse(init.body) as Record<string, unknown>;

        if (parsed && typeof parsed === 'object') {
          if (stripSampling) {
            delete parsed.temperature;
            delete parsed.top_p;
            delete parsed.top_k;
          }

          if (disableThinking) {
            parsed.thinking = { type: 'disabled' };
          }

          init = { ...init, body: JSON.stringify(parsed) };
        }
      } catch {
        // Non-JSON body — leave unchanged
      }
    }

    return baseFetch(input, init);
  };
}
