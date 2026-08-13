import { useEffect } from 'react';
import { useLocation, useNavigate } from '@remix-run/react';
import { useStore } from '@nanostores/react';
import { AuthLoadingScreen } from '~/components/auth/AuthLoadingScreen';
import { authReadyStore, authUserStore, isSupabaseConfigured } from '~/lib/supabase/client';
import { isPublicAuthPath } from '~/lib/supabase/auth-redirect';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const ready = useStore(authReadyStore);
  const user = useStore(authUserStore);
  const authRequired = isSupabaseConfigured();
  const onLoginPage = isPublicAuthPath(location.pathname);

  useEffect(() => {
    if (!authRequired || !ready) {
      return;
    }

    const { pathname, search } = location;

    if (onLoginPage) {
      if (user) {
        const params = new URLSearchParams(search);
        const redirectTo = params.get('redirect') || '/';

        if (redirectTo.startsWith('/') && !isPublicAuthPath(redirectTo)) {
          navigate(redirectTo, { replace: true });
        } else {
          navigate('/', { replace: true });
        }
      }

      return;
    }

    if (!user) {
      const redirect = encodeURIComponent(pathname + search);
      navigate(`/login?redirect=${redirect}`, { replace: true });
    }
  }, [authRequired, ready, user, location, navigate, onLoginPage]);

  if (!authRequired) {
    return <>{children}</>;
  }

  if (!ready) {
    return <AuthLoadingScreen />;
  }

  if (!user && !onLoginPage) {
    return <AuthLoadingScreen />;
  }

  return <>{children}</>;
}
