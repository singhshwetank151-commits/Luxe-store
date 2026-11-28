const RESERVED_PATHS = new Set([
  '/',
  '/admin',
  '/administrator',
  '/login',
  '/signin',
  '/signup',
  '/profile',
  '/account',
  '/cart',
  '/checkout',
  '/collection',
  '/product',
]);

export const DEFAULT_ADMIN_ROUTE_PATH = '/vault-58b453f01d35353dae';

export function normalizeAdminRoutePath(rawValue) {
  const raw = String(rawValue || '').trim().toLowerCase();
  if (!raw) return DEFAULT_ADMIN_ROUTE_PATH;

  const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const cleaned = withSlash.replace(/\/+$/, '');

  // Require an opaque 8–64 character lowercase alphanumeric/hyphen segment
  if (!/^\/[a-z0-9][a-z0-9-]{7,63}$/.test(cleaned)) {
    return DEFAULT_ADMIN_ROUTE_PATH;
  }
  if (RESERVED_PATHS.has(cleaned) || cleaned.includes('admin')) {
    return DEFAULT_ADMIN_ROUTE_PATH;
  }
  return cleaned;
}

const configuredEnvPath =
  typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.VITE_ADMIN_PATH
    : '';

export const ADMIN_ROUTE_PATH = normalizeAdminRoutePath(configuredEnvPath);

export function isAdminRoutePath(pathname, configuredPath = ADMIN_ROUTE_PATH) {
  const normalizedInput = String(pathname || '').trim().replace(/\/+$/, '');
  const expected = normalizeAdminRoutePath(configuredPath);
  return normalizedInput === expected;
}
