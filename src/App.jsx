import { Suspense, lazy, useEffect, useState } from 'react';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { RouterProvider } from './context/RouterContext';
import { useRouter } from './context/storeHooks';
import { Header } from './components/Header';
import { Hero } from './components/Hero';

const RunwayLookbook = lazy(() =>
  import('./components/RunwayLookbook').then((m) => ({ default: m.RunwayLookbook }))
);
const ProductDetailPage = lazy(() =>
  import('./components/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage }))
);
const CartPage = lazy(() => import('./components/CartPage').then((m) => ({ default: m.CartPage })));
const CheckoutPage = lazy(() =>
  import('./components/CheckoutPage').then((m) => ({ default: m.CheckoutPage }))
);
const AuthPage = lazy(() => import('./components/AuthPage').then((m) => ({ default: m.AuthPage })));
const AdminPanel = lazy(() =>
  import('./components/AdminPanel').then((m) => ({ default: m.AdminPanel }))
);

function AppRoutes() {
  const { route } = useRouter();
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine === false : false
  );

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <>
      <Header />
      {isOffline && (
        <div className="offline-banner" role="status" aria-live="polite">
          You are offline. Changes will not save until connection returns.
        </div>
      )}
      <Suspense fallback={null}>
        {route.view === 'collection' && (
          <main>
            <RunwayLookbook />
          </main>
        )}
        {route.view === 'product' && <ProductDetailPage productId={route.productId} />}
        {route.view === 'cart' && <CartPage key="cart" initialMode="cart" />}
        {route.view === 'checkout' && <CheckoutPage />}
        {route.view === 'admin' && <AdminPanel />}
        {(route.view === 'signin' || route.view === 'profile' || route.view === 'account') && (
          <AuthPage />
        )}
        {route.view === 'home' && <Hero />}
      </Suspense>
    </>
  );
}

function App() {
  return (
    <RouterProvider>
      <AuthProvider>
        <CartProvider>
          <AppRoutes />
        </CartProvider>
      </AuthProvider>
    </RouterProvider>
  );
}

export default App;
