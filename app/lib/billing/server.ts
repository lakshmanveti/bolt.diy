import { createClient, type User } from '@supabase/supabase-js';
import { getBillingPlan, periodEndFromPlan, type BillingPlanId } from '~/lib/billing/plans';
import type { UserSubscription } from '~/lib/billing/subscription';

function getSupabaseUrl(serverEnv?: Record<string, string | undefined>): string | undefined {
  return serverEnv?.VITE_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
}

function getSupabaseAnonKey(serverEnv?: Record<string, string | undefined>): string | undefined {
  return serverEnv?.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
}

function getServiceRoleKey(serverEnv?: Record<string, string | undefined>): string | undefined {
  return serverEnv?.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function getBearerToken(request: Request): string | undefined {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

export async function getRequestUser(
  request: Request,
  serverEnv?: Record<string, string | undefined>,
): Promise<User | null> {
  const token = getBearerToken(request);
  const url = getSupabaseUrl(serverEnv);
  const anon = getSupabaseAnonKey(serverEnv);

  if (!token || !url || !anon) {
    return null;
  }

  const supabase = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await supabase.auth.getUser(token);

  return data.user ?? null;
}

export function createSupabaseAdmin(serverEnv?: Record<string, string | undefined>) {
  const url = getSupabaseUrl(serverEnv);
  const service = getServiceRoleKey(serverEnv);

  if (!url || !service) {
    return null;
  }

  return createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createSupabaseForRequest(
  request: Request,
  serverEnv?: Record<string, string | undefined>,
) {
  const url = getSupabaseUrl(serverEnv);
  const service = getServiceRoleKey(serverEnv);
  const anon = getSupabaseAnonKey(serverEnv);
  const token = getBearerToken(request);

  if (!url) {
    throw new Error('Supabase is not configured');
  }

  if (service) {
    return createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  if (!anon || !token) {
    throw new Error('Set SUPABASE_SERVICE_ROLE_KEY for billing webhooks, or send a user access token.');
  }

  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export async function activateSubscription(options: {
  request: Request;
  userId: string;
  planId: BillingPlanId;
  orderId: string;
  paymentId: string;
  serverEnv?: Record<string, string | undefined>;
}): Promise<UserSubscription> {
  const plan = getBillingPlan(options.planId);

  if (!plan) {
    throw new Error('Unknown billing plan');
  }

  const periodEnd = periodEndFromPlan(plan);
  const supabase =
    createSupabaseAdmin(options.serverEnv) ?? createSupabaseForRequest(options.request, options.serverEnv);
  const row = {
    user_id: options.userId,
    plan: plan.id,
    status: 'active',
    razorpay_order_id: options.orderId,
    razorpay_payment_id: options.paymentId,
    current_period_end: periodEnd?.toISOString() ?? null,
    token_used: 0,
    token_cap: plan.tokenCap,
    amount_paise: plan.amountPaise,
    currency: plan.currency,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from('user_subscription').upsert(row, { onConflict: 'user_id' }).select().single();

  if (error) {
    throw error;
  }

  try {
    await supabase.from('user_payment').upsert(
      {
        user_id: options.userId,
        plan: plan.id,
        amount_paise: plan.amountPaise,
        currency: plan.currency,
        status: 'captured',
        razorpay_order_id: options.orderId,
        razorpay_payment_id: options.paymentId,
      },
      { onConflict: 'razorpay_payment_id' },
    );
  } catch {
    // History table may not exist yet; subscription is still activated.
  }

  return data as UserSubscription;
}
