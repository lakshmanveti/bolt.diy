import { useEffect, useRef } from 'react';
import { useLocation } from '@remix-run/react';
import { useStore } from '@nanostores/react';
import { AuthLoadingScreen } from '~/components/auth/AuthLoadingScreen';
import { isBillingEnabled } from '~/lib/billing/plans';
import {
  isSubscriptionActive,
  isHostedUpgradeCheckout,
  loadUserSubscription,
  SUBSCRIBE_PATH,
  userSubscriptionReadyStore,
  userSubscriptionStore,
} from '~/lib/billing/subscription';
import { authReadyStore, authUserStore, isSupabaseConfigured } from '~/lib/supabase/client';
import { isPublicAuthPath } from '~/lib/supabase/auth-redirect';

export function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const authReady = useStore(authReadyStore);
  const user = useStore(authUserStore);
  const subscriptionReady = useStore(userSubscriptionReadyStore);
  const subscription = useStore(userSubscriptionStore);
  const billingOn = isBillingEnabled();
  const loadedUserIdRef = useRef<string | null>(null);
  const onSubscribePage = location.pathname === SUBSCRIBE_PATH || location.pathname.startsWith(`${SUBSCRIBE_PATH}/`);
  const upgradingToHosted = isHostedUpgradeCheckout(location.pathname, location.search);
  const onLoginPage = isPublicAuthPath(location.pathname);

  useEffect(() => {
    if (!billingOn || !authReady || !user || !isSupabaseConfigured()) {
      return;
    }

    if (loadedUserIdRef.current === user.id) {
      return;
    }

    loadedUserIdRef.current = user.id;
    void loadUserSubscription();
  }, [billingOn, authReady, user?.id]);

  useEffect(() => {
    if (!billingOn || !authReady || !user || !subscriptionReady) {
      return;
    }

    if (onLoginPage) {
      return;
    }

    if (!isSubscriptionActive(subscription) && !onSubscribePage) {
      // Full load so /subscribe is served without COEP (Razorpay cannot open under require-corp).
      window.location.replace(SUBSCRIBE_PATH);
      return;
    }

    if (isSubscriptionActive(subscription) && onSubscribePage) {
      const alreadyHosted = subscription?.plan === 'hosted';

      if (!upgradingToHosted || alreadyHosted) {
        window.location.replace('/');
      }
    }
  }, [billingOn, authReady, user?.id, subscriptionReady, subscription, onSubscribePage, onLoginPage, upgradingToHosted]);

  if (!billingOn || !isSupabaseConfigured()) {
    return <>{children}</>;
  }

  if (!authReady || !user) {
    return <>{children}</>;
  }

  if (onSubscribePage || onLoginPage) {
    return <>{children}</>;
  }

  if (!subscriptionReady) {
    return <AuthLoadingScreen />;
  }

  if (!isSubscriptionActive(subscription)) {
    return <AuthLoadingScreen />;
  }

  return <>{children}</>;
}
