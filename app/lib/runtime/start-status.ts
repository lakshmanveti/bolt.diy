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
      title: packageName ? `Installing ${packageName}…` : 'Installing packages…',
      detail: packagesAdded
        ? `${packagesAdded} packages so far. First install can take several minutes on Windows.`
        : 'Downloading dependencies. First install can take several minutes on Windows.',
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
    return {
      stage,
      title: 'Couldn’t start the preview',
      detail: raw.error || 'The preview didn’t start. Try Retry.',
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
