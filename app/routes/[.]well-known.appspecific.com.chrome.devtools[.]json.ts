import type { LoaderFunctionArgs } from '@remix-run/cloudflare';

/**
 * Chrome DevTools probes this URL automatically.
 * Return an empty 204 so Remix does not log "No route matches".
 */
export async function loader(_args: LoaderFunctionArgs) {
  return new Response(null, { status: 204 });
}
