import { APP_NAME } from '~/utils/brand';

/**
 * Toggle wait-state engagement UI on the left build panel.
 * Set to false if it feels noisy.
 */
export const SHOW_BUILD_ENGAGEMENT = true;

/** Shown while reopening an existing chat — not a full generate. */
export const SESSION_RESTORE_MESSAGES = [
  'Waking up the app you already built…',
  'No full rebuild — just reconnecting the live preview.',
  'Picking up right where you left off.',
  'Your last generation is still here. Plugging it back in.',
  'Restoring the canvas, not starting from scratch.',
  'Chat on the right. Preview coming back on the left.',
  'Reattaching the running app to this session…',
  'Almost there — live preview incoming.',
] as const;

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
