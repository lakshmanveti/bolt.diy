/**
 * Shared model capability checks (safe for provider modules used on client + server).
 */

export function isReasoningModel(modelName: string): boolean {
  const name = modelName.toLowerCase();

  // gpt-5-chat still supports sampling params; other gpt-5 / o-series do not
  if (name.includes('gpt-5-chat')) {
    return false;
  }

  return (
    /^(o1|o3|o4|gpt-5)/i.test(modelName) || /(^|[/:.])(o1|o3|o4)(-|$)/i.test(name) || /(^|[/:.])gpt-5/i.test(name)
  );
}

/**
 * Models that reject temperature / top_p / top_k (API 400 if sent).
 * - OpenAI reasoning: o1/o3/o4/gpt-5 (except gpt-5-chat)
 * - Anthropic: Opus 4.7+, Opus 5, Sonnet 5 (and Bedrock/OpenRouter id variants)
 */
export function modelRejectsTemperature(modelName: string): boolean {
  if (isReasoningModel(modelName)) {
    return true;
  }

  const name = modelName.toLowerCase();

  if (/opus-4-[78]/.test(name) || /opus-5/.test(name)) {
    return true;
  }

  // claude-sonnet-5 / sonnet-5 — does not match claude-3-5-sonnet
  if (/sonnet-5/.test(name)) {
    return true;
  }

  return false;
}

/**
 * Models that enable adaptive thinking by default and emit `thinking` content blocks.
 * Older @ai-sdk/anthropic cannot parse those blocks — disable thinking until the SDK is upgraded.
 */
export function modelNeedsThinkingDisabled(modelName: string): boolean {
  const name = modelName.toLowerCase();

  // Claude Sonnet 5: adaptive thinking on by default; can be disabled via API
  return /sonnet-5/.test(name);
}
