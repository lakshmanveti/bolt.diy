import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getBillingPlan, isBillingEnabled } from '~/lib/billing/plans';
import { createRazorpayOrder, getRazorpayKeyId } from '~/lib/billing/razorpay.server';
import { createSupabaseForRequest, getRequestUser } from '~/lib/billing/server';
import { isSubscriptionRecordActive } from '~/lib/billing/status';

export async function loader(_args: LoaderFunctionArgs) {
  return json({ error: 'Method not allowed' }, { status: 405 });
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  if (!isBillingEnabled()) {
    return json({ error: 'Billing is disabled' }, { status: 400 });
  }

  try {
    const serverEnv = context.cloudflare?.env as Record<string, string | undefined> | undefined;
    const user = await getRequestUser(request, serverEnv);

    if (!user) {
      return json({ error: 'Sign in to subscribe' }, { status: 401 });
    }

    const body = (await request.json()) as { planId?: string };
    const plan = getBillingPlan(body.planId);

    if (!plan) {
      return json({ error: 'Unknown plan' }, { status: 400 });
    }

    const keyId = getRazorpayKeyId(serverEnv);

    if (!keyId) {
      return json({ error: 'Razorpay is not configured' }, { status: 500 });
    }

    const supabase = createSupabaseForRequest(request, serverEnv);
    const { data: existing } = await supabase.from('user_subscription').select('*').eq('user_id', user.id).maybeSingle();

    if (isSubscriptionRecordActive(existing) && existing?.plan === 'hosted' && plan.id === 'hosted') {
      return json({ error: 'You already have BuildLive Hosted' }, { status: 400 });
    }

    const receipt = `bl_${plan.id}_${Date.now()}`.slice(0, 40);
    const order = await createRazorpayOrder({
      amountPaise: plan.amountPaise,
      currency: plan.currency,
      receipt,
      notes: {
        user_id: user.id,
        plan: plan.id,
      },
      serverEnv,
    });

    try {
      if (isSubscriptionRecordActive(existing)) {
        // Keep the current plan active until payment is verified.
        await supabase
          .from('user_subscription')
          .update({
            razorpay_order_id: order.id,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id);
      } else {
        await supabase.from('user_subscription').upsert(
          {
            user_id: user.id,
            plan: plan.id,
            status: 'pending',
            razorpay_order_id: order.id,
            token_cap: plan.tokenCap,
            amount_paise: plan.amountPaise,
            currency: plan.currency,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        );
      }
    } catch {
      // Activation still happens on verify/webhook.
    }

    return json({
      keyId,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      planId: plan.id,
      planName: plan.name,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create Razorpay order';
    return json({ error: message }, { status: 500 });
  }
}
