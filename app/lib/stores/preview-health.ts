import { atom } from 'nanostores';

export type PreviewHealthStatus = 'unknown' | 'checking' | 'healthy' | 'recovering' | 'unreachable';

export type PreviewHealthState = {
  status: PreviewHealthStatus;
  message?: string;
  autoRetryCount: number;
};

export const previewHealthStore = atom<PreviewHealthState>({
  status: 'unknown',
  autoRetryCount: 0,
});

export const MAX_PREVIEW_AUTO_RETRIES = 2;
