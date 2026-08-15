import type { LoaderFunction } from '@remix-run/cloudflare';
import { getApiKeysFromCookie } from '~/lib/api/cookies';

/** @deprecated Use account preferences — only reports keys saved by the user (cookies). */
export const loader: LoaderFunction = async ({ request }) => {
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider');

  if (!provider) {
    return Response.json({ isSet: false });
  }

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = getApiKeysFromCookie(cookieHeader);
  const isSet = Boolean(apiKeys?.[provider]?.trim());

  return Response.json({ isSet });
};
