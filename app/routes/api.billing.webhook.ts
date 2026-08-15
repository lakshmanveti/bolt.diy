import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getBillingPlan, type BillingPlanId } from '~/lib/billing/plans';
import { verifyWebhookSignature } from '~/lib/billing/razorpay.server';
import { activateSubscription } from '~/lib/billing/server';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('RazorpayWebhook');

type RazorpayWebhookPayload = {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        status?: string;
        notes?: Record<string, string>;
      };
    };
    order?: {
      entity?: {
        id?: string;
        notes?: Record<string, string>;
      };
    };
  };
};

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const serverEnv = context.cloudflare?.env as Record<string, string | undefined> | undefined;
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature') || '';
  const valid = await verifyWebhookSignature({ body: rawBody, signature, serverEnv });

  if (!valid) {
    return json({ error: 'Invalid webhook signature' }, { status: 400 });
  }

  const payload = JSON.parse(rawBody) as RazorpayWebhookPayload;
  const event = payload.event || '';

  if (event !== 'order.paid' && event !== 'payment.captured') {
    return json({ ok: true, ignored: event });
  }

  const payment = payload.payload?.payment?.entity;
  const order = payload.payload?.order?.entity;
  const notes = payment?.notes || order?.notes || {};
  const userId = notes.user_id;
  const plan = getBillingPlan(notes.plan);
  const orderId = payment?.order_id || order?.id;
  const paymentId = payment?.id;

  if (!userId || !plan || !orderId || !paymentId) {
    logger.warn('Webhook missing user/plan/order', { event, notes });
    return json({ ok: true, skipped: true });
  }

  try {
    await activateSubscription({
      request,
      userId,
      planId: plan.id as BillingPlanId,
      orderId,
      paymentId,
      serverEnv,
    });
  } catch (error) {
    logger.error('Failed to activate subscription from webhook', error);
    return json({ error: 'Activation failed' }, { status: 500 });
  }

  return json({ ok: true });
}
