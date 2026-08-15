import { useEffect, useState } from 'react';
import { useSearchParams } from '@remix-run/react';
import { useStore } from '@nanostores/react';
import { toast } from 'react-toastify';
import { formatPlanPrice, getBillingPlans, type BillingPlan, type BillingPlanId } from '~/lib/billing/plans';
import { applySubscription } from '~/lib/billing/subscription';
import { authSessionStore, authUserStore } from '~/lib/supabase/client';
import { APP_NAME } from '~/utils/brand';
import { classNames } from '~/utils/classNames';
import { openSupportWhatsApp } from '~/utils/support';

const RAZORPAY_SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
const SCRIPT_TIMEOUT_MS = 20_000;

let hostedAutoCheckoutStarted = false;

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (response: { error?: { description?: string } }) => void) => void;
    };
  }
}

function loadRazorpayScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }

  if (window.Razorpay) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Razorpay checkout timed out. Reload this page and try again.'));
    }, SCRIPT_TIMEOUT_MS);

    const finish = (error?: Error) => {
      window.clearTimeout(timeout);

      if (error) {
        reject(error);
        return;
      }

      if (window.Razorpay) {
        resolve();
        return;
      }

      reject(new Error('Razorpay checkout failed to load'));
    };

    const existing = document.querySelector(`script[src="${RAZORPAY_SCRIPT_SRC}"]`);

    if (existing) {
      existing.addEventListener('load', () => finish());
      existing.addEventListener('error', () => finish(new Error('Failed to load Razorpay')));
      return;
    }

    const script = document.createElement('script');
    script.src = RAZORPAY_SCRIPT_SRC;
    script.async = true;
    script.onload = () => finish();
    script.onerror = () => finish(new Error('Failed to load Razorpay'));
    document.body.appendChild(script);
  });
}

async function authHeaders(): Promise<HeadersInit> {
  const token = authSessionStore.get()?.access_token;

  if (!token) {
    throw new Error('Sign in to subscribe');
  }

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function PlanCard({
  plan,
  selected,
  onSelect,
}: {
  plan: BillingPlan;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={classNames(
        'w-full rounded-xl border p-5 text-left transition-colors',
        selected
          ? 'border-accent-500 bg-accent-500/10'
          : 'border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 hover:border-accent-500/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-bolt-elements-textPrimary">{plan.name}</h3>
          <p className="mt-0.5 text-sm text-bolt-elements-textSecondary">{plan.tagline}</p>
        </div>
        <div className="text-right text-sm font-semibold text-accent-500">{formatPlanPrice(plan)}</div>
      </div>
      <p className="mt-3 text-sm text-bolt-elements-textSecondary">{plan.description}</p>
      <ul className="mt-4 space-y-1.5">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-bolt-elements-textPrimary">
            <span className="i-ph:check-circle mt-0.5 h-4 w-4 shrink-0 text-accent-500" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </button>
  );
}

export function SubscribePage() {
  const user = useStore(authUserStore);
  const [searchParams] = useSearchParams();
  const upgradeToHosted = searchParams.get('plan') === 'hosted';
  const autoCheckout = upgradeToHosted && searchParams.get('checkout') === '1';
  const plans = getBillingPlans();
  const [selected, setSelected] = useState<BillingPlanId>(upgradeToHosted ? 'hosted' : 'platform');
  const [busy, setBusy] = useState(autoCheckout);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadRazorpayScript().catch(() => undefined);
  }, []);

  const startCheckout = async (planId: BillingPlanId) => {
    if (!user) {
      toast.error('Sign in first');
      return;
    }

    setBusy(true);
    setError(null);
    setSelected(planId);

    try {
      await loadRazorpayScript();
      const headers = await authHeaders();
      const response = await fetch('/api/billing/order', {
        method: 'POST',
        headers,
        body: JSON.stringify({ planId }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        keyId?: string;
        orderId?: string;
        amount?: number;
        currency?: string;
        planName?: string;
      };

      if (!response.ok || !payload.keyId || !payload.orderId) {
        throw new Error(payload.error || 'Failed to start checkout');
      }

      if (!window.Razorpay) {
        throw new Error('Razorpay checkout failed to load');
      }

      const checkout = new window.Razorpay({
        key: payload.keyId,
        amount: payload.amount,
        currency: payload.currency,
        name: APP_NAME,
        description: payload.planName,
        order_id: payload.orderId,
        prefill: { email: user.email || '' },
        theme: { color: '#6366f1' },
        modal: {
          ondismiss: () => {
            setBusy(false);
          },
        },
        handler: async (result: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          try {
            const verifyResponse = await fetch('/api/billing/verify', {
              method: 'POST',
              headers,
              body: JSON.stringify(result),
            });
            const verified = (await verifyResponse.json().catch(() => ({}))) as {
              error?: string;
              subscription?: Parameters<typeof applySubscription>[0];
            };

            if (!verifyResponse.ok || !verified.subscription) {
              throw new Error(verified.error || 'Could not confirm payment');
            }

            applySubscription(verified.subscription);
            toast.success('Subscription activated');
            window.location.replace('/');
          } catch (verifyError) {
            const message = verifyError instanceof Error ? verifyError.message : 'Payment confirmation failed';
            setError(message);
            toast.error(message);
            setBusy(false);
          }
        },
      });

      checkout.on('payment.failed', (response) => {
        const message = response.error?.description || 'Payment failed';
        setError(message);
        toast.error(message);
        setBusy(false);
      });

      checkout.open();
    } catch (payError) {
      const message = payError instanceof Error ? payError.message : 'Checkout failed';
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!autoCheckout || !user || hostedAutoCheckoutStarted) {
      return;
    }

    hostedAutoCheckoutStarted = true;
    void startCheckout('hosted');
    // Open checkout once when the signed-in upgrade URL loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCheckout, user?.id]);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <h1 className="text-2xl font-semibold text-bolt-elements-textPrimary">
        {upgradeToHosted ? `Upgrade to ${plans.hosted.name}` : 'Choose your plan'}
      </h1>
      <p className="mt-2 text-sm text-bolt-elements-textSecondary">
        {upgradeToHosted
          ? busy
            ? 'Opening Razorpay checkout…'
            : `Pay the yearly ${APP_NAME} Hosted fee. After payment, the builder will use the hosted model instead of your own API key.`
          : `Pick how you want to use ${APP_NAME}. You can change amounts later in billing constants / env.`}
      </p>

      {upgradeToHosted ? (
        <div className="mt-6">
          <PlanCard plan={plans.hosted} selected onSelect={() => setSelected('hosted')} />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <PlanCard plan={plans.platform} selected={selected === 'platform'} onSelect={() => setSelected('platform')} />
          <PlanCard plan={plans.hosted} selected={selected === 'hosted'} onSelect={() => setSelected('hosted')} />
        </div>
      )}

      {error ? (
        <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>
      ) : null}

      {!autoCheckout || error || !busy ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void startCheckout(selected)}
          className="mt-6 w-full rounded-md bg-accent-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-600 disabled:opacity-50"
        >
          {busy ? 'Opening checkout…' : `Continue with ${plans[selected].name}`}
        </button>
      ) : (
        <p className="mt-6 text-center text-sm text-bolt-elements-textSecondary">Opening checkout…</p>
      )}

      {upgradeToHosted ? (
        <button
          type="button"
          onClick={() => window.location.assign('/')}
          className="mt-3 w-full rounded-md border border-bolt-elements-borderColor px-4 py-2 text-sm text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-2"
        >
          Back to app
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => openSupportWhatsApp(`Hi, I need help with a ${APP_NAME} payment.`)}
        className="mt-3 flex w-full items-center justify-center gap-2 text-sm text-bolt-elements-textSecondary hover:text-accent-500"
      >
        <span className="i-ph:whatsapp-logo h-4 w-4" />
        Payment issue? Chat on WhatsApp
      </button>
    </div>
  );
}
