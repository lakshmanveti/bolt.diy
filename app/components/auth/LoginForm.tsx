import { useState, type FormEvent } from 'react';
import { toast } from 'react-toastify';
import { classNames } from '~/utils/classNames';
import { claimDeviceChats, signInWithEmail, signUpWithEmail } from '~/lib/supabase/client';

export type LoginFormProps = {
  onSuccess?: () => void;
};

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);

    try {
      if (mode === 'signin') {
        await signInWithEmail(email.trim(), password);
        toast.success('Signed in');
      } else {
        const result = await signUpWithEmail(email.trim(), password);

        if (result.session) {
          toast.success('Account created');
        } else {
          toast.info('Check your email to confirm signup (or disable email confirm in Supabase Auth settings).');
        }
      }

      try {
        const claimed = await claimDeviceChats();

        if (claimed > 0) {
          toast.success(`Linked ${claimed} local chat(s) to your account`);
        }
      } catch {
        // non-fatal
      }

      setPassword('');
      onSuccess?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="w-full max-w-md">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-bolt-elements-textSecondary">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="px-3 py-2 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-bolt-elements-textSecondary">Password</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="px-3 py-2 rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 text-bolt-elements-textPrimary"
          />
        </label>
      </div>

      <button
        type="button"
        className="mt-3 text-xs text-accent-500 bg-transparent border-0 p-0 cursor-pointer hover:underline hover:bg-transparent"
        onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
      >
        {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
      </button>

      <button
        type="submit"
        disabled={busy}
        className={classNames(
          'mt-6 w-full inline-flex items-center justify-center px-4 py-2.5 rounded-md text-sm font-medium',
          'bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50',
        )}
      >
        {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
      </button>
    </form>
  );
}
