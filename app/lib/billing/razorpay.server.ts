import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('Razorpay');

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  receipt?: string;
  status?: string;
  notes?: Record<string, string>;
};

function getEnv(name: string, serverEnv?: Record<string, string | undefined>): string | undefined {
  const fromImportMeta =
    typeof import.meta !== 'undefined' ? (import.meta.env as Record<string, string | undefined>)?.[name] : undefined;
  const value = serverEnv?.[name] || fromImportMeta || process.env[name];
  const trimmed = String(value ?? '').trim();

  return trimmed || undefined;
}

export function getRazorpaySecret(serverEnv?: Record<string, string | undefined>): string | undefined {
  return getEnv('RAZORPAY_KEY_SECRET', serverEnv) || getEnv('VITE_RAZORPAY_KEY_SECRET', serverEnv);
}

export function getRazorpayWebhookSecret(serverEnv?: Record<string, string | undefined>): string | undefined {
  return getEnv('RAZORPAY_WEBHOOK_SECRET', serverEnv);
}

export function getRazorpayKeyId(serverEnv?: Record<string, string | undefined>): string | undefined {
  return getEnv('VITE_RAZORPAY_KEY_ID', serverEnv) || getEnv('RAZORPAY_KEY_ID', serverEnv);
}

function basicAuth(serverEnv?: Record<string, string | undefined>): string {
  const keyId = getRazorpayKeyId(serverEnv);
  const secret = getRazorpaySecret(serverEnv);

  if (!keyId || !secret) {
    throw new Error('Razorpay is not configured. Set VITE_RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  }

  const credentials = `${keyId}:${secret}`;

  if (typeof btoa === 'function') {
    return btoa(credentials);
  }

  return Buffer.from(credentials).toString('base64');
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyPaymentSignature(options: {
  orderId: string;
  paymentId: string;
  signature: string;
  serverEnv?: Record<string, string | undefined>;
}): Promise<boolean> {
  const secret = getRazorpaySecret(options.serverEnv);

  if (!secret) {
    return false;
  }

  const expected = await hmacSha256Hex(secret, `${options.orderId}|${options.paymentId}`);
  return expected === options.signature;
}

export async function verifyWebhookSignature(options: {
  body: string;
  signature: string;
  serverEnv?: Record<string, string | undefined>;
}): Promise<boolean> {
  const secret = getRazorpayWebhookSecret(options.serverEnv);

  if (!secret) {
    logger.warn('RAZORPAY_WEBHOOK_SECRET is not set');
    return false;
  }

  const expected = await hmacSha256Hex(secret, options.body);
  return expected === options.signature;
}

export async function createRazorpayOrder(options: {
  amountPaise: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
  serverEnv?: Record<string, string | undefined>;
}): Promise<RazorpayOrder> {
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth(options.serverEnv)}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: options.amountPaise,
      currency: options.currency,
      receipt: options.receipt,
      notes: options.notes,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json()) as RazorpayOrder & { error?: { description?: string } };

  if (!response.ok) {
    throw new Error(payload.error?.description || 'Failed to create Razorpay order');
  }

  return payload;
}

export async function fetchRazorpayPayment(
  paymentId: string,
  serverEnv?: Record<string, string | undefined>,
): Promise<{ id: string; order_id: string; status: string; notes?: Record<string, string> }> {
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      Authorization: `Basic ${basicAuth(serverEnv)}`,
    },
  });

  const payload = (await response.json()) as {
    id: string;
    order_id: string;
    status: string;
    notes?: Record<string, string>;
    error?: { description?: string };
  };

  if (!response.ok) {
    throw new Error(payload.error?.description || 'Failed to fetch Razorpay payment');
  }

  return payload;
}
