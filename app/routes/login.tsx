import { json, type MetaFunction } from '@remix-run/cloudflare';
import { useNavigate, useSearchParams } from '@remix-run/react';
import { ClientOnly } from 'remix-utils/client-only';
import { LoginForm } from '~/components/auth/LoginForm';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { APP_DESCRIPTION, APP_NAME } from '~/utils/brand';
import { BuildLiveLogo } from '~/components/ui/BuildLiveLogo';

export const meta: MetaFunction = () => {
  return [
    { title: `Sign in — ${APP_NAME}` },
    { name: 'description', content: APP_DESCRIPTION },
  ];
};

export const loader = () => json({});

export default function LoginRoute() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleSuccess = () => {
    const redirectTo = searchParams.get('redirect') || '/';

    if (redirectTo.startsWith('/') && redirectTo !== '/login') {
      navigate(redirectTo, { replace: true });
    } else {
      navigate('/', { replace: true });
    }
  };

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-bolt-elements-background-depth-1 px-6 py-12">
      <BackgroundRays />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="flex justify-center">
            <BuildLiveLogo size="xl" />
          </div>
          <p className="mt-2 text-sm text-bolt-elements-textSecondary">
            Sign in to build apps and sync your chat history across devices.
          </p>
        </div>

        <div className="rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-6 shadow-lg">
          <ClientOnly fallback={<div className="h-48 animate-pulse rounded-md bg-bolt-elements-background-depth-3" />}>
            {() => <LoginForm onSuccess={handleSuccess} />}
          </ClientOnly>
        </div>
      </div>
    </div>
  );
}
