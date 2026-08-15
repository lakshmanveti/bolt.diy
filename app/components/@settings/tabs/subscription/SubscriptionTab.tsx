import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { formatAmountPaise, formatPlanPrice, getBillingPlan, getBillingPlans } from '~/lib/billing/plans';
import {
  hostedTokensRemaining,
  hostedUpgradeSubscribeUrl,
  isSubscriptionActive,
  loadUserPayments,
  userPaymentsReadyStore,
  userPaymentsStore,
  userSubscriptionStore,
} from '~/lib/billing/subscription';
import { closeSettingsTab } from '~/lib/stores/settings-modal';
import { APP_NAME } from '~/utils/brand';
import { classNames } from '~/utils/classNames';
import { openSupportWhatsApp } from '~/utils/support';

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-bolt-elements-textTertiary">{label}</div>
      <div className="mt-0.5 text-sm text-bolt-elements-textPrimary">{value}</div>
    </div>
  );
}

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatDate(value: string | null): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SubscriptionTab() {
  const subscription = useStore(userSubscriptionStore);
  const payments = useStore(userPaymentsStore);
  const paymentsReady = useStore(userPaymentsReadyStore);
  const plans = getBillingPlans();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const active = isSubscriptionActive(subscription);
  const currentPlan = subscription ? plans[subscription.plan] : null;
  const canUpgrade = active && subscription?.plan === 'platform';
  const tokensLeft = hostedTokensRemaining(subscription);

  useEffect(() => {
    void loadUserPayments();
  }, []);

  const startHostedCheckout = () => {
    closeSettingsTab();
    window.location.assign(hostedUpgradeSubscribeUrl());
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-bolt-elements-textPrimary">Current plan</h4>
        <SummaryRow label="Plan" value={currentPlan?.name || 'None'} />
        <SummaryRow label="Status" value={subscription ? formatStatus(subscription.status) : 'Inactive'} />
        <SummaryRow label="Price" value={currentPlan ? formatPlanPrice(currentPlan) : '—'} />
        {subscription?.plan === 'hosted' ? (
          <>
            <SummaryRow label="Renews" value={formatDate(subscription.current_period_end)} />
            <SummaryRow
              label="Tokens remaining"
              value={
                tokensLeft == null || subscription.token_cap == null
                  ? '—'
                  : `${tokensLeft.toLocaleString()} / ${subscription.token_cap.toLocaleString()}`
              }
            />
          </>
        ) : (
          <SummaryRow label="Model access" value="Your own API key (Model Settings)" />
        )}
      </div>

      {canUpgrade && !showUpgrade && (
        <button
          type="button"
          onClick={() => setShowUpgrade(true)}
          className="w-full rounded-md bg-accent-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-600"
        >
          Upgrade
        </button>
      )}

      {canUpgrade && showUpgrade && (
        <div className="space-y-4 rounded-xl border border-accent-500/40 bg-accent-500/5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-bolt-elements-textPrimary">{plans.hosted.name}</h4>
              <p className="mt-0.5 text-sm text-bolt-elements-textSecondary">{plans.hosted.tagline}</p>
            </div>
            <div className="text-sm font-semibold text-accent-500">{formatPlanPrice(plans.hosted)}</div>
          </div>
          <p className="text-sm text-bolt-elements-textSecondary">{plans.hosted.description}</p>
          <ul className="space-y-1.5">
            {plans.hosted.features.map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-sm text-bolt-elements-textPrimary">
                <span className="i-ph:check-circle mt-0.5 h-4 w-4 shrink-0 text-accent-500" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={startHostedCheckout}
              className="flex-1 rounded-md bg-accent-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-600"
            >
              Continue to checkout
            </button>
            <button
              type="button"
              onClick={() => setShowUpgrade(false)}
              className={classNames(
                'rounded-md border border-bolt-elements-borderColor px-4 py-2.5 text-sm',
                'text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2',
              )}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {active && subscription?.plan === 'hosted' && (
        <p className="text-sm text-bolt-elements-textSecondary">You are on the highest plan.</p>
      )}

      <div className="space-y-2">
        <h4 className="text-sm font-medium text-bolt-elements-textPrimary">Payment history</h4>
        {!paymentsReady ? (
          <p className="text-sm text-bolt-elements-textSecondary">Loading payments…</p>
        ) : payments.length === 0 ? (
          <p className="rounded-md border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 px-3 py-2.5 text-sm text-bolt-elements-textSecondary">
            No payments yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-bolt-elements-borderColor">
            {payments.map((payment, index) => {
              const planName = getBillingPlan(payment.plan)?.name || payment.plan;

              return (
                <div
                  key={payment.id || payment.razorpay_payment_id || `${payment.created_at}-${index}`}
                  className={classNames(
                    'flex items-start justify-between gap-3 px-3 py-2.5',
                    index > 0 ? 'border-t border-bolt-elements-borderColor' : '',
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-bolt-elements-textPrimary">{planName}</div>
                    <div className="mt-0.5 text-xs text-bolt-elements-textSecondary">
                      {formatDateTime(payment.created_at)}
                      {payment.razorpay_payment_id ? ` · ${payment.razorpay_payment_id}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold text-bolt-elements-textPrimary">
                      {formatAmountPaise(payment.amount_paise, payment.currency)}
                    </div>
                    <div className="mt-0.5 text-xs text-bolt-elements-textSecondary">
                      {formatStatus(payment.status)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() =>
          openSupportWhatsApp(
            `Hi, I have a billing question about ${APP_NAME}${subscription?.plan ? ` (${subscription.plan} plan)` : ''}.`,
          )
        }
        className="flex w-full items-center justify-center gap-2 rounded-md border border-accent-500/50 bg-bolt-elements-background-depth-2 px-4 py-2.5 text-sm font-medium text-bolt-elements-textPrimary hover:bg-accent-500/10"
      >
        <span className="i-ph:whatsapp-logo h-4 w-4 text-accent-500" />
        Chat on WhatsApp
      </button>
    </div>
  );
}
