import { describe, expect, it } from 'vitest';
import { formatStartStatus, isLiveDockerStartStage } from './start-status';
import { parseStartLog } from '../../../runtime-daemon/src/start-status.mjs';

describe('parseStartLog', () => {
  it('extracts the package being fetched', () => {
    const parsed = parseStartLog(`
npm http fetch GET https://registry.npmjs.org/react 200
npm http fetch GET https://registry.npmjs.org/lucide-react 200
`);

    expect(parsed.stage).toBe('install');
    expect(parsed.packageName).toBe('lucide-react');
  });

  it('moves to server after packages are added', () => {
    const parsed = parseStartLog('added 142 packages in 3m');

    expect(parsed.stage).toBe('server');
    expect(parsed.packagesAdded).toBe(142);
  });

  it('detects Vite ready', () => {
    const parsed = parseStartLog('VITE v5.4.2  ready in 432 ms\n  ➜  Local:   http://localhost:5173/');

    expect(parsed.stage).toBe('ready');
    expect(parsed.viteReady).toBe(true);
  });
});

describe('formatStartStatus', () => {
  it('names the current package', () => {
    const status = formatStartStatus({ stage: 'install', packageName: 'react' });

    expect(status.title).toBe('Installing react…');
  });

  it('uses plain language for the workspace boot stage', () => {
    const status = formatStartStatus({ stage: 'container' });

    expect(status.title).toBe('Getting your app ready…');
    expect(status.detail.toLowerCase()).not.toContain('docker');
  });
});

describe('isLiveDockerStartStage', () => {
  it('is true while the daemon is booting, installing, serving, or failed', () => {
    expect(isLiveDockerStartStage('container')).toBe(true);
    expect(isLiveDockerStartStage('install')).toBe(true);
    expect(isLiveDockerStartStage('server')).toBe(true);
    expect(isLiveDockerStartStage('error')).toBe(true);
    expect(isLiveDockerStartStage('idle')).toBe(false);
    expect(isLiveDockerStartStage('ready')).toBe(false);
  });
});
