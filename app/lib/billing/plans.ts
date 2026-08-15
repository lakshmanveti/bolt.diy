/**
 * Billing catalog. Change amounts / caps here or override with env vars.
 *
 * Env (optional):
 *   VITE_BILLING_ENABLED=true|false
 *   VITE_RAZORPAY_KEY_ID=rzp_test_...
 *   RAZORPAY_KEY_SECRET=...   (do not prefix with VITE_ — that exposes the secret to the browser)
 *   RAZORPAY_WEBHOOK_SECRET=...
 *   VITE_BILLING_CURRENCY=INR
 *   VITE_BILLING_PLATFORM_AMOUNT_PAISE=99900
 *   VITE_BILLING_HOSTED_AMOUNT_PAISE=499900
 *   VITE_BILLING_HOSTED_TOKEN_CAP=2000000
 *   VITE_BILLING_HOSTED_PERIOD_MONTHS=12
 */
export const BILLING_PLAN_IDS = ['platform', 'hosted'] as const;

export type BillingPlanId = (typeof BILLING_PLAN_IDS)[number];

export type BillingInterval = 'one_time' | 'yearly';

export type BillingPlan = {
  id: BillingPlanId;
  name: string;
  tagline: string;
  description: string;
  amountPaise: number;
  currency: string;
  interval: BillingInterval;
  tokenCap: number | null;
  periodMonths: number | null;
  features: string[];
};

function readEnv(name: string): string | undefined {
  const vite =
    typeof import.meta !== 'undefined' ? (import.meta.env as Record<string, string | undefined>)?.[name] : undefined;
  const fromProcess = typeof process !== 'undefined' ? process.env?.[name] : undefined;
  const value = String(vite ?? fromProcess ?? '').trim();

  if (!value || value.includes('your_') || value.includes('_here')) {
    return undefined;
  }

  return value;
}

function readInt(name: string, fallback: number): number {
  const raw = readEnv(name);

  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Default: on when a Razorpay key is present. Set VITE_BILLING_ENABLED=false to skip the paywall. */
export function isBillingEnabled(): boolean {
  const flag = readEnv('VITE_BILLING_ENABLED')?.toLowerCase();

  if (flag === 'false' || flag === '0' || flag === 'off') {
    return false;
  }

  if (flag === 'true' || flag === '1' || flag === 'on') {
    return true;
  }

  return Boolean(readEnv('VITE_RAZORPAY_KEY_ID'));
}

export function getRazorpayKeyId(): string | undefined {
  return readEnv('VITE_RAZORPAY_KEY_ID');
}

export const BILLING_CURRENCY = readEnv('VITE_BILLING_CURRENCY') || 'INR';

/** Placeholders — override with VITE_BILLING_* env vars. */
export const BILLING_DEFAULTS = {
  platformAmountPaise: 99_900, // ₹999
  hostedAmountPaise: 499_900, // ₹4,999
  hostedTokenCap: 2_000_000,
  hostedPeriodMonths: 12,
} as const;

export function getBillingPlans(): Record<BillingPlanId, BillingPlan> {
  const currency = BILLING_CURRENCY;

  return {
    platform: {
      id: 'platform',
      name: 'Platform',
      tagline: 'Bring your own API key',
      description:
        'One-time platform fee. You use your own model key from Model Settings. No BuildLive token cap.',
      amountPaise: readInt('VITE_BILLING_PLATFORM_AMOUNT_PAISE', BILLING_DEFAULTS.platformAmountPaise),
      currency,
      interval: 'one_time',
      tokenCap: null,
      periodMonths: null,
      features: [
        'Use your own Anthropic / OpenAI key',
        'No BuildLive token limit',
        'Access to the full builder',
        'One-time platform royalty',
      ],
    },
    hosted: {
      id: 'hosted',
      name: 'BuildLive Hosted',
      tagline: 'We provide the model',
      description:
        'Yearly access using BuildLive’s internal model and key. Includes a yearly token cap.',
      amountPaise: readInt('VITE_BILLING_HOSTED_AMOUNT_PAISE', BILLING_DEFAULTS.hostedAmountPaise),
      currency,
      interval: 'yearly',
      tokenCap: readInt('VITE_BILLING_HOSTED_TOKEN_CAP', BILLING_DEFAULTS.hostedTokenCap),
      periodMonths: readInt('VITE_BILLING_HOSTED_PERIOD_MONTHS', BILLING_DEFAULTS.hostedPeriodMonths),
      features: [
        'No API key required',
        'BuildLive-hosted model access',
        `${readInt('VITE_BILLING_HOSTED_TOKEN_CAP', BILLING_DEFAULTS.hostedTokenCap).toLocaleString()} tokens / year`,
        'Billed once per year',
      ],
    },
  };
}

export function getBillingPlan(id: string | null | undefined): BillingPlan | null {
  if (!id || !BILLING_PLAN_IDS.includes(id as BillingPlanId)) {
    return null;
  }

  return getBillingPlans()[id as BillingPlanId];
}

export function formatPlanPrice(plan: BillingPlan): string {
  const amount = plan.amountPaise / 100;
  const formatted = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: plan.currency,
    maximumFractionDigits: 0,
  }).format(amount);

  if (plan.interval === 'yearly') {
    return `${formatted} / year`;
  }

  return `${formatted} one-time`;
}

export function formatAmountPaise(amountPaise: number, currency = BILLING_CURRENCY): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amountPaise / 100);
}

export function periodEndFromPlan(plan: BillingPlan, from = new Date()): Date | null {
  if (!plan.periodMonths) {
    return null;
  }

  const end = new Date(from);
  end.setMonth(end.getMonth() + plan.periodMonths);

  return end;
}
