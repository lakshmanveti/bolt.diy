import { describe, expect, it } from 'vitest';
import {
  isReasoningModel,
  modelNeedsThinkingDisabled,
  modelRejectsTemperature,
} from '~/lib/modules/llm/model-capabilities';

describe('modelRejectsTemperature', () => {
  it('rejects Anthropic Opus 4.7/4.8 and Sonnet 5 ids', () => {
    expect(modelRejectsTemperature('claude-opus-4-7')).toBe(true);
    expect(modelRejectsTemperature('claude-opus-4-8-20260416')).toBe(true);
    expect(modelRejectsTemperature('us.anthropic.claude-opus-4-7')).toBe(true);
    expect(modelRejectsTemperature('claude-sonnet-5')).toBe(true);
  });

  it('still allows temperature on older Claude models', () => {
    expect(modelRejectsTemperature('claude-3-5-sonnet-20241022')).toBe(false);
    expect(modelRejectsTemperature('claude-opus-4-20250514')).toBe(false);
    expect(modelRejectsTemperature('claude-sonnet-4-20250514')).toBe(false);
  });

  it('rejects OpenAI reasoning models but not gpt-5-chat', () => {
    expect(modelRejectsTemperature('o3-mini')).toBe(true);
    expect(modelRejectsTemperature('gpt-5')).toBe(true);
    expect(modelRejectsTemperature('gpt-5-chat-latest')).toBe(false);
    expect(isReasoningModel('gpt-5-chat-latest')).toBe(false);
  });
});

describe('modelNeedsThinkingDisabled', () => {
  it('disables thinking for Sonnet 5 only', () => {
    expect(modelNeedsThinkingDisabled('claude-sonnet-5')).toBe(true);
    expect(modelNeedsThinkingDisabled('claude-3-5-sonnet-20241022')).toBe(false);
    expect(modelNeedsThinkingDisabled('claude-opus-4-20250514')).toBe(false);
  });
});
