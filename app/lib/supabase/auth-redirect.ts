const LOGIN_PATH = '/login';

export function isPublicAuthPath(pathname: string): boolean {
  return pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`);
}

export function getLoginRedirectUrl(currentPath?: string): string {
  const path =
    currentPath ??
    (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/');

  if (isPublicAuthPath(path)) {
    return LOGIN_PATH;
  }

  return `${LOGIN_PATH}?redirect=${encodeURIComponent(path)}`;
}

/** Hard redirect — used when the session is invalidated (expiry, sign-out). */
export function redirectToLogin(currentPath?: string) {
  if (typeof window === 'undefined') {
    return;
  }

  window.location.href = getLoginRedirectUrl(currentPath);
}
