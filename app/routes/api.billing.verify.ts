import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getBillingPlan } from '~/lib/billing/plans';
import { fetchRazorpayPayment, verifyPaymentSignature } from '~/lib/billing/razorpay.server';
import { activateSubscription, getRequestUser } from '~/lib/billing/server';

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const serverEnv = context.cloudflare?.env as Record<string, string | undefined> | undefined;
    const user = await getRequestUser(request, serverEnv);

    if (!user) {
      return json({ error: 'Sign in to verify payment' }, { status: 401 });
    }

    const body = (await request.json()) as {
      razorpay_order_id?: string;
      razorpay_payment_id?: string;
      razorpay_signature?: string;
    };

    if (!body.razorpay_order_id || !body.razorpay_payment_id || !body.razorpay_signature) {
      return json({ error: 'Missing payment details' }, { status: 400 });
    }

    const valid = await verifyPaymentSignature({
      orderId: body.razorpay_order_id,
      paymentId: body.razorpay_payment_id,
      signature: body.razorpay_signature,
      serverEnv,
    });

    if (!valid) {
      return json({ error: 'Invalid payment signature' }, { status: 400 });
    }

    const payment = await fetchRazorpayPayment(body.razorpay_payment_id, serverEnv);
    const planId = payment.notes?.plan;
    const plan = getBillingPlan(planId);

    if (!plan || payment.notes?.user_id !== user.id) {
      return json({ error: 'Payment does not match this account' }, { status: 400 });
    }

    if (payment.status !== 'captured' && payment.status !== 'authorized') {
      return json({ error: `Payment not complete (${payment.status})` }, { status: 400 });
    }

    const subscription = await activateSubscription({
      request,
      userId: user.id,
      planId: plan.id,
      orderId: body.razorpay_order_id,
      paymentId: body.razorpay_payment_id,
      serverEnv,
    });

    return json({ subscription });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to verify payment';
    return json({ error: message }, { status: 500 });
  }
}
