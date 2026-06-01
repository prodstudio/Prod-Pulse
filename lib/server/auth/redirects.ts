const DEFAULT_POST_LOGIN_PATH = "/dashboard";

const PROTECTED_PATH_PREFIXES = [
  "/dashboard",
  "/apps",
  "/monitors",
  "/incidents",
  "/alerts",
  "/heartbeats",
  "/status-pages",
] as const;

export function sanitizeRedirectTarget(
  value: string | null | undefined,
  fallback = DEFAULT_POST_LOGIN_PATH,
) {
  if (!value) {
    return fallback;
  }

  if (!value.startsWith("/")) {
    return fallback;
  }

  if (value.startsWith("//")) {
    return fallback;
  }

  if (value.startsWith("/login") || value.startsWith("/api/")) {
    return fallback;
  }

  return value;
}

export function getDefaultPostLoginPath() {
  return DEFAULT_POST_LOGIN_PATH;
}

export function isProtectedAppPath(pathname: string) {
  return PROTECTED_PATH_PREFIXES.some((prefix) => {
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
  });
}

export function buildLoginRedirectPath(pathname: string, search = "") {
  const next = sanitizeRedirectTarget(`${pathname}${search}`);
  const params = new URLSearchParams({ next });

  return `/login?${params.toString()}`;
}
