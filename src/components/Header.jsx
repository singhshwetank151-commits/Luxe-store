import { Search, CircleUserRound, ShoppingBasket } from 'lucide-react';
import { useAuth, useCart, useRouter } from '../context/storeHooks';
import { withBase } from '../lib/basePath';

export function Header() {
  const { route, navigate } = useRouter();
  const { cartCount } = useCart();
  const { isAuthenticated, user } = useAuth();

  const handleLinkClick = (e, target) => {
    e.preventDefault();
    navigate(target);
  };

  return (
    <header className="site-header">
      <button
        type="button"
        className="logo-grid"
        aria-label="Luxe Store Home"
        onClick={() => navigate('/')}
      >
        <span className="logo-dot" />
        <span className="logo-dot" />
        <span className="logo-dot" />
        <span className="logo-dot" />
      </button>

      <nav className="nav-links" aria-label="Main Navigation">
        <a
          href={withBase('/')}
          className={`nav-link ${route.view === 'home' ? 'is-active' : ''}`}
          onClick={(e) => handleLinkClick(e, '/')}
        >
          HOME
        </a>
        <a
          href={withBase('/collection')}
          className={`nav-link ${route.view === 'collection' ? 'is-active' : ''}`}
          onClick={(e) => handleLinkClick(e, '/collection')}
        >
          COLLECTION
        </a>
        <a
          href="#about"
          className="nav-link nav-link-about"
          onClick={(e) => e.preventDefault()}
        >
          ABOUT
        </a>
      </nav>

      <div className="header-actions">
        {user?.isAdmin && (
          <button
            type="button"
            className={`header-auth-btn ${route.view === 'admin' ? 'is-active' : ''}`}
            aria-label="Admin Console"
            onClick={() => navigate('/admin')}
          >
            <span>ADMIN</span>
          </button>
        )}
        <button
          type="button"
          className="icon-btn header-search-btn"
          aria-label="Search"
          onClick={() => navigate('/collection')}
        >
          <Search size={20} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          className={`header-auth-btn ${
            isAuthenticated
              ? route.view === 'profile'
                ? 'is-active'
                : ''
              : route.view === 'signin'
              ? 'is-active'
              : ''
          }`}
          aria-label={isAuthenticated ? `Profile (${user?.fullName || user?.email})` : 'Sign In'}
          onClick={() => navigate(isAuthenticated ? '/profile' : '/signin')}
        >
          <CircleUserRound size={17} strokeWidth={1.7} />
          <span>{isAuthenticated ? 'PROFILE' : 'SIGN IN'}</span>
          {isAuthenticated && <span className="account-active-inline-dot" aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="icon-btn icon-btn-basket"
          aria-label={`Shopping Basket${cartCount > 0 ? `, ${cartCount} items` : ''}`}
          onClick={() => navigate('/cart')}
        >
          <ShoppingBasket size={20} strokeWidth={1.7} />
          {cartCount > 0 ? (
            <span className="basket-count-badge" data-testid="cart-count">
              {cartCount}
            </span>
          ) : (
            <span className="basket-badge" aria-hidden="true" />
          )}
        </button>
      </div>
    </header>
  );
}
