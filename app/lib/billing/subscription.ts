import { atom } from 'nanostores';
import { getSupabaseClient, requireAuthUser } from '~/lib/supabase/client';
import { getBillingPlan, type BillingPlanId } from '~/lib/billing/plans';
import { isSubscriptionRecordActive } from '~/lib/billing/status';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('Billing');

export type SubscriptionStatus = 'inactive' | 'pending' | 'active' | 'expired' | 'canceled';

export type UserSubscription = {
  user_id: string;
  plan: BillingPlanId;
  status: SubscriptionStatus;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  razorpay_subscription_id: string | null;
  current_period_end: string | null;
  token_used: number;
  token_cap: number | null;
  amount_paise: number | null;
  currency: string;
  created_at: string;
  updated_at: string;
};

export const userSubscriptionStore = atom<UserSubscription | null>(null);
export const userSubscriptionReadyStore = atom(false);

let subscriptionLoadPromise: Promise<UserSubscription | null> | null = null;

export function isSubscriptionActive(row: UserSubscription | null | undefined): boolean {
  return isSubscriptionRecordActive(row);
}

export function isHostedPlanActive(): boolean {
  const row = userSubscriptionStore.get();
  return isSubscriptionActive(row) && row?.plan === 'hosted';
}

export function isPlatformPlanActive(): boolean {
  const row = userSubscriptionStore.get();
  return isSubscriptionActive(row) && row?.plan === 'platform';
}

export function hostedTokensRemaining(row: UserSubscription | null | undefined): number | null {
  if (!row || row.plan !== 'hosted' || row.token_cap == null) {
    return null;
  }

  return Math.max(0, row.token_cap - (row.token_used || 0));
}

export async function loadUserSubscription(): Promise<UserSubscription | null> {
  if (userSubscriptionReadyStore.get() && !subscriptionLoadPromise) {
    return userSubscriptionStore.get();
  }

  if (subscriptionLoadPromise) {
    return subscriptionLoadPromise;
  }

  subscriptionLoadPromise = loadUserSubscriptionInternal().finally(() => {
    subscriptionLoadPromise = null;
  });

  return subscriptionLoadPromise;
}

async function loadUserSubscriptionInternal(): Promise<UserSubscription | null> {
  const supabase = getSupabaseClient();
  const user = await requireAuthUser();

  if (!supabase || !user) {
    userSubscriptionStore.set(null);
    userSubscriptionReadyStore.set(true);
    return null;
  }

  try {
    const { data, error } = await supabase.from('user_subscription').select('*').eq('user_id', user.id).maybeSingle();

    if (error) {
      logger.warn('loadUserSubscription failed', error);
      userSubscriptionStore.set(null);
      userSubscriptionReadyStore.set(true);
      return null;
    }

    const row = (data as UserSubscription | null) ?? null;
    userSubscriptionStore.set(row);
    userSubscriptionReadyStore.set(true);
    return row;
  } catch (error) {
    logger.warn('loadUserSubscription error', error);
    userSubscriptionStore.set(null);
    userSubscriptionReadyStore.set(true);
    return null;
  }
}

export function applySubscription(row: UserSubscription) {
  userSubscriptionStore.set(row);
  userSubscriptionReadyStore.set(true);
  void loadUserPayments();
}

export type UserPayment = {
  id: string;
  user_id: string;
  plan: BillingPlanId;
  amount_paise: number;
  currency: string;
  status: string;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  created_at: string;
};

export const userPaymentsStore = atom<UserPayment[]>([]);
export const userPaymentsReadyStore = atom(false);

let paymentsLoadPromise: Promise<UserPayment[]> | null = null;

function paymentFromSubscription(row: UserSubscription | null | undefined): UserPayment | null {
  if (!row || (!row.razorpay_payment_id && !row.razorpay_order_id)) {
    return null;
  }

  return {
    id: row.razorpay_payment_id || row.razorpay_order_id || row.user_id,
    user_id: row.user_id,
    plan: row.plan,
    amount_paise: row.amount_paise ?? 0,
    currency: row.currency,
    status: row.status === 'active' ? 'captured' : row.status,
    razorpay_order_id: row.razorpay_order_id,
    razorpay_payment_id: row.razorpay_payment_id,
    created_at: row.updated_at || row.created_at,
  };
}

export async function loadUserPayments(): Promise<UserPayment[]> {
  if (paymentsLoadPromise) {
    return paymentsLoadPromise;
  }

  paymentsLoadPromise = loadUserPaymentsInternal().finally(() => {
    paymentsLoadPromise = null;
  });

  return paymentsLoadPromise;
}

async function loadUserPaymentsInternal(): Promise<UserPayment[]> {
  const supabase = getSupabaseClient();
  const user = await requireAuthUser();

  if (!supabase || !user) {
    userPaymentsStore.set([]);
    userPaymentsReadyStore.set(true);
    return [];
  }

  try {
    const { data, error } = await supabase
      .from('user_payment')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      logger.warn('loadUserPayments failed', error);
      const fallback = paymentFromSubscription(userSubscriptionStore.get());
      const rows = fallback ? [fallback] : [];
      userPaymentsStore.set(rows);
      userPaymentsReadyStore.set(true);
      return rows;
    }

    let rows = (data as UserPayment[] | null) ?? [];

    if (rows.length === 0) {
      const fallback = paymentFromSubscription(userSubscriptionStore.get());

      if (fallback) {
        const { error: insertError } = await supabase.from('user_payment').upsert(
          {
            user_id: fallback.user_id,
            plan: fallback.plan,
            amount_paise: fallback.amount_paise,
            currency: fallback.currency,
            status: 'captured',
            razorpay_order_id: fallback.razorpay_order_id,
            razorpay_payment_id: fallback.razorpay_payment_id,
          },
          { onConflict: 'razorpay_payment_id' },
        );

        if (!insertError) {
          const { data: again } = await supabase
            .from('user_payment')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
          rows = (again as UserPayment[] | null) ?? [fallback];
        } else {
          rows = [fallback];
        }
      }
    }

    userPaymentsStore.set(rows);
    userPaymentsReadyStore.set(true);
    return rows;
  } catch (error) {
    logger.warn('loadUserPayments error', error);
    userPaymentsStore.set([]);
    userPaymentsReadyStore.set(true);
    return [];
  }
}

export function getPlanLabel(row: UserSubscription | null): string {
  if (!row) {
    return 'No plan';
  }

  return getBillingPlan(row.plan)?.name ?? row.plan;
}

export const SUBSCRIBE_PATH = '/subscribe';

/** Full-page checkout URL. Razorpay cannot open under the main app's COEP header. */
export function hostedUpgradeSubscribeUrl(): string {
  return `${SUBSCRIBE_PATH}?plan=hosted&checkout=1`;
}

export function isHostedUpgradeCheckout(pathname: string, search: string): boolean {
  const onSubscribe = pathname === SUBSCRIBE_PATH || pathname.startsWith(`${SUBSCRIBE_PATH}/`);

  if (!onSubscribe) {
    return false;
  }

  return new URLSearchParams(search).get('plan') === 'hosted';
}
