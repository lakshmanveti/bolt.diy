import type { LoaderFunction } from '@remix-run/cloudflare';
import { getApiKeysFromCookie } from '~/lib/api/cookies';

/** Returns API keys saved in the user's session cookies (from account preferences). */
export const loader: LoaderFunction = async ({ request }) => {
  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);

  return Response.json(apiKeys);
};
