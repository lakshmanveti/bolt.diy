import { afterEach, describe, expect, it } from 'vitest';
import {
  clearLiveChatSession,
  recoverLiveChatSession,
  writeLiveChatSession,
} from './live-chat-session';

describe('recoverLiveChatSession', () => {
  afterEach(() => {
    clearLiveChatSession();
  });

  it('does not restore a previous app onto the homepage', () => {
    writeLiveChatSession({
      chatId: '9',
      messages: [{ id: 'm1', role: 'user', content: 'build a todo app' }],
      streaming: false,
    });

    expect(recoverLiveChatSession()).toBeNull();
    expect(recoverLiveChatSession(undefined)).toBeNull();
  });

  it('restores when opening that chat by id', () => {
    writeLiveChatSession({
      chatId: '9',
      messages: [{ id: 'm1', role: 'user', content: 'build a todo app' }],
      streaming: false,
    });

    expect(recoverLiveChatSession('9')?.chatId).toBe('9');
  });
});
