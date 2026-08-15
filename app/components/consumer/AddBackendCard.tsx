import { classNames } from '~/utils/classNames';

interface AddBackendCardProps {
  connected: boolean;
  onPrimary: () => void;
  onDismiss: () => void;
}

export function AddBackendCard({ connected, onPrimary, onDismiss }: Readonly<AddBackendCardProps>) {
  return (
    <div
      className={classNames(
        'mt-4 rounded-xl border p-3.5 shadow-sm',
        'border-accent-500/40 bg-bolt-elements-background-depth-2 hover:border-accent-500/60',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="i-ph:database mt-0.5 h-5 w-5 shrink-0 text-accent-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-bolt-elements-textPrimary">Add a backend to this app</p>
          <p className="mt-1 text-xs leading-relaxed text-bolt-elements-textSecondary">
            Data in this preview is only in the browser. Connect Supabase so forms and lists actually save.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onPrimary}
              className={classNames(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
                'border border-transparent bg-accent-500 text-white',
                'hover:bg-bolt-elements-button-primary-backgroundHover',
              )}
            >
              {connected ? 'Continue' : 'Add backend to this app'}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md bg-transparent px-3 py-1.5 text-sm text-bolt-elements-textSecondary hover:bg-bolt-elements-item-backgroundActive hover:text-bolt-elements-textPrimary"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
