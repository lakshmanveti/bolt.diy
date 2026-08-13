import { classNames } from '~/utils/classNames';
import { APP_LOGO_SRC, APP_NAME } from '~/utils/brand';

const SIZE_CLASS = {
  xs: 'h-5',
  sm: 'h-6',
  md: 'h-8',
  lg: 'h-10',
  xl: 'h-12',
  hero: 'h-14 sm:h-16',
} as const;

export type BuildLiveLogoSize = keyof typeof SIZE_CLASS;

interface BuildLiveLogoProps {
  size?: BuildLiveLogoSize;
  className?: string;
}

export function BuildLiveLogo({ size = 'md', className }: BuildLiveLogoProps) {
  return (
    <img
      src={APP_LOGO_SRC}
      alt={APP_NAME}
      className={classNames('w-auto object-contain', SIZE_CLASS[size], className)}
      draggable={false}
    />
  );
}
