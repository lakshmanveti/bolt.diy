export type BillingRecord = {
  plan: string;
  status: string;
  current_period_end?: string | null;
  token_used?: number | null;
  token_cap?: number | null;
};

export function isSubscriptionRecordActive(row: BillingRecord | null | undefined): boolean {
  if (!row || row.status !== 'active') {
    return false;
  }

  if (row.plan === 'platform') {
    return true;
  }

  if (!row.current_period_end) {
    return true;
  }

  return new Date(row.current_period_end).getTime() > Date.now();
}

export function hostedTokensExceeded(row: BillingRecord | null | undefined): boolean {
  if (!row || row.plan !== 'hosted' || row.token_cap == null) {
    return false;
  }

  return (row.token_used || 0) >= row.token_cap;
}
