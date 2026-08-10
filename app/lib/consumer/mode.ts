import { atom } from 'nanostores';

export type ConsumerUiMode = 'consumer' | 'studio';

/**
 * UI shell mode. Default is consumer so `/` stays end-user friendly.
 * Studio routes set this to `studio` on mount.
 */
export const consumerUiMode = atom<ConsumerUiMode>('consumer');

export function setConsumerUiMode(mode: ConsumerUiMode) {
  consumerUiMode.set(mode);
}

export function isConsumerMode() {
  return consumerUiMode.get() === 'consumer';
}
