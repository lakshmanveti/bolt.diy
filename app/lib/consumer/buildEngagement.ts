import { APP_NAME } from '~/utils/brand';

/**
 * Toggle wait-state engagement UI on the left build panel.
 * Set to false if it feels noisy.
 */
export const SHOW_BUILD_ENGAGEMENT = true;

export const BUILD_WAIT_TIPS = [
  `After this finishes, say what to change — ${APP_NAME} will update the live app.`,
  'Use Ask mode to explore ideas without rebuilding.',
  'Try “make it look more modern” or “add a contact form” next.',
  'Click-to-edit lets you point at something in the preview to change it.',
  'When you’re happy, deploy from the preview toolbar.',
  'First builds often take a few minutes — later changes are usually faster.',
  'You can attach a screenshot or sketch for clearer direction.',
] as const;

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  if (m <= 0) {
    return `${s}s`;
  }

  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

type PromptMessage = {
  role?: string;
  content?: unknown;
  annotations?: unknown;
};

function messageText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter(
      (part): part is { type: string; text: string } =>
        Boolean(part) &&
        typeof part === 'object' &&
        (part as { type?: string }).type === 'text' &&
        typeof (part as { text?: string }).text === 'string',
    )
    .map((part) => part.text)
    .join(' ')
    .trim();
}

/** Template-import prompts are sent as hidden user turns. They are not the app request. */
export function isInternalUserPrompt(message: PromptMessage): boolean {
  if (Array.isArray(message.annotations) && message.annotations.includes('hidden')) {
    return true;
  }

  const text = messageText(message.content);

  return /TEMPLATE INSTRUCTIONS:/i.test(text) || /template import is done/i.test(text);
}

/** The app the user asked for, skipping starter-template scaffolding. */
export function latestVisibleUserPrompt(messages: PromptMessage[] | undefined): string | undefined {
  if (!messages?.length) {
    return undefined;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    if (message.role !== 'user' || isInternalUserPrompt(message)) {
      continue;
    }

    const text = messageText(message.content);

    if (text) {
      return text;
    }
  }

  return undefined;
}

export function summarizeUserPrompt(raw: string, maxLen = 140): string {
  const cleaned = raw
    .replace(/^\[Model:.*?\]\s*/i, '')
    .replace(/^\[Provider:.*?\]\s*/i, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return '';
  }

  if (cleaned.length <= maxLen) {
    return cleaned;
  }

  return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`;
}
