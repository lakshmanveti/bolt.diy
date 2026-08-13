/**
 * Optional env-driven LLM hints (no hardcoded provider/model names in code).
 * Set in .env / .env.local:
 *   VITE_DEFAULT_LLM_PROVIDER=Anthropic
 *   VITE_DEFAULT_LLM_MODEL=claude-sonnet-5
 *   VITE_LLM_ENABLED_PROVIDERS=Anthropic,OpenAI
 *   VITE_LLM_BLOCKED_PROVIDERS=AmazonBedrock,LMStudio,Ollama,OpenAILike
 */

function readEnv(name: string): string | undefined {
  const value = import.meta.env[name];

  if (value === undefined || value === null) {
    return undefined;
  }

  const trimmed = String(value).trim();

  if (!trimmed || trimmed.includes('your_') || trimmed.includes('_here')) {
    return undefined;
  }

  return trimmed;
}

export function getEnvDefaultLlmProvider(): string | undefined {
  return readEnv('VITE_DEFAULT_LLM_PROVIDER');
}

export function getEnvDefaultLlmModel(): string | undefined {
  return readEnv('VITE_DEFAULT_LLM_MODEL');
}

export function getEnvEnabledLlmProviders(): string[] {
  const raw = readEnv('VITE_LLM_ENABLED_PROVIDERS');

  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function getEnvBlockedLlmProviders(): string[] {
  const raw = readEnv('VITE_LLM_BLOCKED_PROVIDERS');

  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isBlockedLlmProvider(name: string | undefined): boolean {
  if (!name) {
    return true;
  }

  return getEnvBlockedLlmProviders().includes(name);
}
