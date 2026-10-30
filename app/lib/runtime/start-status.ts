export type DockerStartStage = 'idle' | 'container' | 'install' | 'server' | 'ready' | 'error';

export type DockerStartStatus = {
  stage: DockerStartStage;
  title: string;
  detail: string;
  packageName?: string;
  packagesAdded?: number;
  startedAt?: number;
};

export const IDLE_START_STATUS: DockerStartStatus = {
  stage: 'idle',
  title: '',
  detail: '',
};

export function isLiveDockerStartStage(stage: DockerStartStage | string | undefined): boolean {
  return stage === 'container' || stage === 'install' || stage === 'server' || stage === 'error';
}

export function formatStartStatus(raw: {
  stage?: string;
  packageName?: string | null;
  packagesAdded?: number | null;
  error?: string | null;
  startedAt?: number;
}): DockerStartStatus {
  const stage = (raw.stage || 'idle') as DockerStartStage;
  const packageName = raw.packageName || undefined;
  const packagesAdded = typeof raw.packagesAdded === 'number' ? raw.packagesAdded : undefined;
  const startedAt = raw.startedAt;

  if (stage === 'container') {
    return {
      stage,
      title: 'Getting your app ready…',
      detail: 'Preparing a workspace for this app.',
      startedAt,
    };
  }

  if (stage === 'install') {
    return {
      stage,
      title: 'Installing dependencies…',
      detail: 'Downloading dependencies. First install can take several minutes on Windows.',
      packageName,
      packagesAdded,
      startedAt,
    };
  }

  if (stage === 'server') {
    return {
      stage,
      title: 'Starting the app…',
      detail: packagesAdded
        ? `Installed ${packagesAdded} packages. Waiting for the dev server.`
        : 'Packages are in. Waiting for the preview server.',
      packagesAdded,
      startedAt,
    };
  }

  if (stage === 'error') {
    const rawError = raw.error || '';
    const missingVite = /vite:\s*not found|not found: vite/i.test(rawError);

    return {
      stage,
      title: 'Couldn’t start the preview',
      detail: missingVite
        ? 'Packages did not finish installing. Click Retry to install them and start the preview.'
        : rawError || 'The preview didn’t start. Try Retry.',
      startedAt,
    };
  }

  if (stage === 'ready') {
    return {
      stage,
      title: 'Preview is ready',
      detail: '',
      startedAt,
    };
  }

  return { ...IDLE_START_STATUS, startedAt };
}
