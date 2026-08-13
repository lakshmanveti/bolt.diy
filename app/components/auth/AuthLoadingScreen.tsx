/** SSR-safe loading shell — safe to use in ClientOnly fallbacks. */
import { BuildLiveLogo } from '~/components/ui/BuildLiveLogo';

export function AuthLoadingScreen() {
  return (
    <div className="flex h-full min-h-screen w-full items-center justify-center bg-bolt-elements-background-depth-1">
      <div className="flex flex-col items-center gap-4 text-center">
        <BuildLiveLogo size="lg" />
        <span className="i-svg-spinners:90-ring-with-bg text-2xl text-accent-500" />
        <p className="text-sm text-bolt-elements-textSecondary">Checking your session…</p>
      </div>
    </div>
  );
}
