import { describe, expect, it } from 'vitest';
import { createChatId, isChatId } from './chat-id';

describe('createChatId', () => {
  it('returns a UUID v4', () => {
    const id = createChatId();

    expect(isChatId(id)).toBe(true);
  });

  it('does not reuse ids', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createChatId()));

    expect(ids.size).toBe(20);
  });

  it('rejects sequential leftover ids', () => {
    expect(isChatId('1')).toBe(false);
    expect(isChatId('24')).toBe(false);
  });
});
