import { describe, expect, it } from 'vitest';
import { dedupeProgressItems, isDockerCoveredAction, labelForFilePath, labelForShell } from '~/lib/consumer/progressLabels';

describe('progressLabels', () => {
  it('maps common file paths to friendly labels', () => {
    expect(labelForFilePath('src/components/LoginForm.tsx')).toContain('login');
    expect(labelForFilePath('src/pages/Dashboard.tsx')).toContain('dashboard');
  });

  it('maps install/dev shell commands', () => {
    expect(labelForShell('npm install')).toBe('Installing packages');
    expect(labelForShell('pnpm run dev')).toBe('Starting your app');
  });

  it('treats install and start actions as covered by Docker status', () => {
    expect(isDockerCoveredAction({ type: 'start', content: 'npm run dev' })).toBe(true);
    expect(isDockerCoveredAction({ type: 'shell', content: 'npm install' })).toBe(true);
    expect(isDockerCoveredAction({ type: 'shell', content: 'pnpm run dev -- --host' })).toBe(true);
    expect(isDockerCoveredAction({ type: 'shell', content: 'ls src' })).toBe(false);
    expect(isDockerCoveredAction({ type: 'file', content: '' })).toBe(false);
  });

  it('dedupes by label preferring running status', () => {
    const items = dedupeProgressItems([
      { id: '1', label: 'Installing packages', status: 'complete' },
      { id: '2', label: 'Installing packages', status: 'running' },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('running');
  });
});
