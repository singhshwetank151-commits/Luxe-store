const rawBase =
  typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL
    ? import.meta.env.BASE_URL
    : '/';

export const BASE_PATH = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
export const BASE_PREFIX = BASE_PATH === '/' ? '' : BASE_PATH.slice(0, -1);

export function withBase(path) {
  if (!path) return BASE_PATH;
  if (/^(https?:|data:|mailto:|tel:)/i.test(path)) return path;
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return `${BASE_PATH}${clean}`;
}

export function stripBase(pathname) {
  if (!pathname) return '/';
  if (BASE_PREFIX && (pathname === BASE_PREFIX || pathname.startsWith(`${BASE_PREFIX}/`))) {
    const stripped = pathname.slice(BASE_PREFIX.length);
    return stripped || '/';
  }
  return pathname;
}
