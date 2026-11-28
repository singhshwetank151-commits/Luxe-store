import { useCallback, useEffect, useMemo, useState } from 'react';
import { stripBase, withBase } from '../lib/basePath';
import { isAdminRoutePath } from '../lib/adminRoute';
import { isSafeRoutePath } from '../lib/security';
import { RouterContext } from './storeHooks';

function normalizeRoute(pathname, hash) {
  const stripped = stripBase(pathname);
  const path = stripped && stripped !== '/' ? stripped : '';
  if (isAdminRoutePath(path)) {
    return { view: 'admin', productId: null };
  }
  if (path.startsWith('/collection') || hash === '#collection') {
    return { view: 'collection', productId: null };
  }
  if (path.startsWith('/cart') || hash === '#cart') {
    return { view: 'cart', productId: null };
  }
  if (path.startsWith('/checkout') || hash === '#checkout') {
    return { view: 'checkout', productId: null };
  }
  if (path.startsWith('/signin') || hash === '#signin') {
    return { view: 'signin', productId: null };
  }
  if (path.startsWith('/profile') || hash === '#profile') {
    return { view: 'profile', productId: null };
  }
  if (path.startsWith('/account') || hash === '#account') {
    return { view: 'account', productId: null };
  }
  if (path.startsWith('/product/')) {
    const id = decodeURIComponent(path.replace('/product/', '').split('/')[0]);
    return { view: 'product', productId: id || null };
  }
  if (hash && hash.startsWith('#product/')) {
    const id = decodeURIComponent(hash.replace('#product/', '').split('/')[0]);
    return { view: 'product', productId: id || null };
  }
  return { view: 'home', productId: null };
}

export function RouterProvider({ children }) {
  const [route, setRoute] = useState(() =>
    normalizeRoute(window.location.pathname, window.location.hash)
  );

  // Silently scrub predictable /admin or #admin probe URLs back to home
  useEffect(() => {
    const stripped = stripBase(window.location.pathname);
    if (
      stripped === '/admin' ||
      stripped.startsWith('/admin/') ||
      window.location.hash === '#admin'
    ) {
      window.history.replaceState({}, '', withBase('/'));
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const stripped = stripBase(window.location.pathname);
      if (stripped === '/admin' || stripped.startsWith('/admin/')) {
        window.history.replaceState({}, '', withBase('/'));
      }
      setRoute(normalizeRoute(window.location.pathname, window.location.hash));
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onPopState);
    };
  }, []);

  const navigate = useCallback((to, options = {}) => {
    const target = isSafeRoutePath(to) ? to.trim() : '/';
    const browserPath = withBase(target);
    if (window.location.pathname !== browserPath) {
      if (options.replace) {
        window.history.replaceState({}, '', browserPath);
      } else {
        window.history.pushState({}, '', browserPath);
      }
    }
    setRoute(normalizeRoute(target, ''));
    if (!options.preserveScroll) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, []);

  const value = useMemo(() => ({ route, navigate }), [route, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}
