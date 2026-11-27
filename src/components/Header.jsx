import { useEffect, useState } from 'react';
import {
  Search,
  CircleUserRound,
  ShoppingBasket,
  Home,
  LayoutGrid,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth, useCart, useRouter } from '../context/storeHooks';
import { withBase } from '../lib/basePath';

export function Header() {
  const { route, navigate } = useRouter();
  const { cartCount } = useCart();
  const { isAuthenticated, user } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
      }
    };
    const handleResize = () => {
      if (window.innerWidth > 767) {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }, [mobileMenuOpen]);

  const handleLinkClick = (e, target) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    navigate(target);
  };

  const handleLogoClick = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
      setMobileMenuOpen((prev) => !prev);
    } else {
      navigate('/');
    }
  };

  const handleMobileNavigate = (target) => {
    setMobileMenuOpen(false);
    navigate(target);
  };

  return (
    <>
      <header className={`site-header ${mobileMenuOpen ? 'is-menu-open' : ''}`}>
        <button
          type="button"
          className={`logo-grid ${mobileMenuOpen ? 'is-open' : ''}`}
          aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Luxe Store Menu & Home'}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-left-header"
          onClick={handleLogoClick}
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
              className={`header-auth-btn header-desktop-only ${route.view === 'admin' ? 'is-active' : ''}`}
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
            className={`header-auth-btn header-desktop-only ${
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
            onClick={() => handleMobileNavigate('/cart')}
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

      {/* Phone-only left-side header panel connected to the 4-dot button (hidden on PC) */}
      <div
        className={`mobile-nav-backdrop ${mobileMenuOpen ? 'is-open' : ''}`}
        aria-hidden={!mobileMenuOpen}
        onClick={() => setMobileMenuOpen(false)}
      />
      <aside
        id="mobile-left-header"
        className={`mobile-nav-drawer ${mobileMenuOpen ? 'is-open' : ''}`}
        aria-label="Mobile Navigation"
        aria-hidden={!mobileMenuOpen}
      >
        <div className="mobile-nav-top">
          <span className="mobile-nav-brand">Luxe Store</span>
          <button
            type="button"
            className="mobile-nav-close"
            aria-label="Close navigation menu"
            onClick={() => setMobileMenuOpen(false)}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <nav className="mobile-nav-list" aria-label="Mobile Menu Links">
          <button
            type="button"
            className={`mobile-nav-item ${route.view === 'home' ? 'is-active' : ''}`}
            onClick={() => handleMobileNavigate('/')}
          >
            <Home size={17} strokeWidth={1.7} />
            <span>HOME</span>
          </button>

          <button
            type="button"
            className={`mobile-nav-item ${
              route.view === 'collection' || route.view === 'product' ? 'is-active' : ''
            }`}
            onClick={() => handleMobileNavigate('/collection')}
          >
            <LayoutGrid size={17} strokeWidth={1.7} />
            <span>COLLECTION</span>
          </button>

          <button
            type="button"
            className={`mobile-nav-item ${
              route.view === 'cart' || route.view === 'checkout' ? 'is-active' : ''
            }`}
            onClick={() => handleMobileNavigate('/cart')}
          >
            <ShoppingBasket size={17} strokeWidth={1.7} />
            <span>SHOPPING BAG</span>
            {cartCount > 0 && <span className="mobile-nav-badge">{cartCount}</span>}
          </button>

          <button
            type="button"
            className={`mobile-nav-item ${
              route.view === 'signin' || route.view === 'profile' || route.view === 'account'
                ? 'is-active'
                : ''
            }`}
            onClick={() => handleMobileNavigate(isAuthenticated ? '/profile' : '/signin')}
          >
            <CircleUserRound size={17} strokeWidth={1.7} />
            <span>{isAuthenticated ? 'PROFILE' : 'SIGN IN'}</span>
            {isAuthenticated && <span className="account-active-inline-dot" aria-hidden="true" />}
          </button>

          {user?.isAdmin && (
            <button
              type="button"
              className={`mobile-nav-item ${route.view === 'admin' ? 'is-active' : ''}`}
              onClick={() => handleMobileNavigate('/admin')}
            >
              <ShieldCheck size={17} strokeWidth={1.7} />
              <span>ADMIN</span>
            </button>
          )}
        </nav>

        <div className="mobile-nav-foot">
          <span>MECHANICAL SKELETON ATELIER</span>
        </div>
      </aside>
    </>
  );
}
