/**
 * Globally unique chat ids. Sequential IndexedDB counters ("1", "2") collide
 * across browsers, users, and the shared runtime-daemon session folder.
 */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createChatId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    const value = char === 'x' ? rand : (rand & 0x3) | 0x8;

    return value.toString(16);
  });
}

export function isChatId(value: string | undefined): boolean {
  return Boolean(value && UUID_V4.test(value));
}
