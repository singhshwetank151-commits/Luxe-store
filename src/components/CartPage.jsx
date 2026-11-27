import { useRef, useState } from 'react';
import { ArrowLeft, Minus, Plus, Trash2, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useAuth, useCart, useRouter } from '../context/storeHooks';
import {
  MAX_ITEM_QUANTITY,
  savePostLoginRedirect,
  validateCheckoutSubmission,
} from '../lib/security';
import './CartPage.css';

function ScopedCartPage({ initialMode, user, isAuthenticated }) {
  const { items, cartCount, subtotal, updateQuantity, removeFromCart, clearCart } = useCart();
  const { navigate } = useRouter();

  const isCheckout = initialMode === 'checkout';
  const [customerName, setCustomerName] = useState(user?.fullName || '');
  const [customerEmail, setCustomerEmail] = useState(user?.email || '');
  const [customerPhone, setCustomerPhone] = useState(user?.phone || '');
  const [shippingAddress, setShippingAddress] = useState(user?.address || '');
  const [cityPostal, setCityPostal] = useState(
    user?.city ? `${user.city}${user.postalCode ? `, ${user.postalCode}` : ''}` : ''
  );
  const [checkoutError, setCheckoutError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const submitLockRef = useRef(false);

  const handlePlaceOrder = (e) => {
    e.preventDefault();
    if (submitLockRef.current) return;
    setCheckoutError('');

    if (!isAuthenticated) {
      setCheckoutError('Please sign in with Google before placing a timepiece reservation.');
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);

    const validation = validateCheckoutSubmission({
      items,
      customerName,
      customerEmail: user?.email || customerEmail,
      customerPhone,
      shippingAddress,
      cityPostal,
    });

    if (!validation.ok) {
      setCheckoutError(validation.error);
      setIsSubmitting(false);
      submitLockRef.current = false;
      return;
    }

    setOrderPlaced(true);
    clearCart();
    setIsSubmitting(false);
    submitLockRef.current = false;
  };

  return (
    <main className="cp-page">
      <div className="cp-container">
        <button
          type="button"
          className="cp-back-btn"
          onClick={() => navigate(isCheckout && !orderPlaced ? '/cart' : '/collection')}
        >
          <ArrowLeft size={15} />
          <span>{isCheckout && !orderPlaced ? 'BACK TO BASKET' : 'CONTINUE EXPLORING'}</span>
        </button>

        {orderPlaced ? (
          <section className="cp-confirmed" aria-live="polite">
            <CheckCircle2 size={52} strokeWidth={1.4} className="cp-confirmed-icon" />
            <span className="cp-eyebrow">PENDING PAYMENT VERIFICATION</span>
            <h1 className="cp-title">RESERVATION RECORDED</h1>
            <p className="cp-confirmed-copy">
              Thank you{customerName ? `, ${customerName}` : ''}. Your timepiece quote request has
              been recorded for {user?.email || customerEmail || 'your account'}. Fulfillment and
              dispatch remain locked until server-side payment verification completes.
            </p>
            <button type="button" className="cp-primary-btn" onClick={() => navigate('/collection')}>
              RETURN TO COLLECTION
            </button>
          </section>
        ) : (
          <>
            <header className="cp-header">
              <div>
                <span className="cp-eyebrow">
                  {isCheckout ? 'EXPRESS HOROLOGICAL CHECKOUT' : 'CURATED SELECTION'}
                </span>
                <h1 className="cp-title">
                  {isCheckout ? 'CHECKOUT' : `YOUR BASKET (${cartCount})`}
                </h1>
              </div>
            </header>

            {items.length === 0 ? (
              <section className="cp-empty-state">
                <p className="cp-empty-text">Your shopping basket is currently empty.</p>
                <button
                  type="button"
                  className="cp-primary-btn"
                  onClick={() => navigate('/collection')}
                >
                  EXPLORE TIMEPIECES
                </button>
              </section>
            ) : (
              <div className="cp-grid">
                {/* Left Column: Cart Items or Shipping Form */}
                <section className="cp-main-col">
                  {isCheckout ? (
                    <form id="luxe-fullscreen-checkout" className="cp-form" onSubmit={handlePlaceOrder}>
                      <h2 className="cp-section-label">CLIENT & DELIVERY DETAILS</h2>
                      <div className="cp-form-grid">
                        <label>
                          <span>FULL NAME</span>
                          <input
                            type="text"
                            required
                            maxLength={100}
                            dir="auto"
                            autoComplete="name"
                            placeholder="Alexander Vance"
                            value={customerName}
                            onChange={(e) => setCustomerName(e.target.value)}
                          />
                        </label>
                        <label>
                          <span>EMAIL ADDRESS</span>
                          <input
                            type="email"
                            required
                            maxLength={160}
                            dir="auto"
                            autoComplete="email"
                            placeholder="client@luxestore.com"
                            value={customerEmail}
                            onChange={(e) => setCustomerEmail(e.target.value)}
                          />
                        </label>
                        <label>
                          <span>PHONE NUMBER</span>
                          <input
                            type="tel"
                            required
                            maxLength={24}
                            dir="auto"
                            autoComplete="tel"
                            placeholder="+1 (212) 555-0194"
                            value={customerPhone}
                            onChange={(e) => setCustomerPhone(e.target.value)}
                          />
                        </label>
                        <label>
                          <span>CITY & POSTAL CODE</span>
                          <input
                            type="text"
                            required
                            maxLength={120}
                            dir="auto"
                            autoComplete="address-level2"
                            placeholder="New York, NY 10151"
                            value={cityPostal}
                            onChange={(e) => setCityPostal(e.target.value)}
                          />
                        </label>
                        <label className="cp-full-span">
                          <span>STREET ADDRESS</span>
                          <input
                            type="text"
                            required
                            maxLength={200}
                            dir="auto"
                            autoComplete="street-address"
                            placeholder="745 Fifth Avenue, Suite 1400"
                            value={shippingAddress}
                            onChange={(e) => setShippingAddress(e.target.value)}
                          />
                        </label>
                      </div>

                      <div className="cp-checkout-items-preview">
                        <h2 className="cp-section-label">TIMEPIECES IN ORDER ({cartCount})</h2>
                        <ul className="cp-mini-list">
                          {items.map((item) => (
                            <li key={`${item.productId}-${item.variantId}`} className="cp-mini-item">
                              <img src={item.image} alt={item.title} className="cp-mini-img" />
                              <div className="cp-mini-meta">
                                <span>{item.title}</span>
                                <small>
                                  {item.variantLabel} · Qty {item.quantity}
                                </small>
                              </div>
                              <strong>${(item.price * item.quantity).toLocaleString('en-US')}</strong>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </form>
                  ) : (
                    <ul className="cp-item-list">
                      {items.map((item) => (
                        <li key={`${item.productId}-${item.variantId}`} className="cp-item-row">
                          <div
                            className="cp-item-thumb"
                            onClick={() => navigate(`/product/${item.productId}`)}
                          >
                            <img src={item.image} alt={item.title} className="cp-item-img" />
                          </div>

                          <div className="cp-item-details">
                            <button
                              type="button"
                              className="cp-item-title-btn"
                              onClick={() => navigate(`/product/${item.productId}`)}
                            >
                              {item.title}
                            </button>
                            <p className="cp-item-variant">{item.variantLabel}</p>
                            <p className="cp-item-unit">{item.formattedPrice} each</p>
                          </div>

                          <div className="cp-item-qty">
                            <button
                              type="button"
                              aria-label={`Decrease quantity of ${item.title}`}
                              onClick={() => updateQuantity(item.productId, item.variantId, -1)}
                            >
                              <Minus size={14} />
                            </button>
                            <span>{item.quantity}</span>
                            <button
                              type="button"
                              aria-label={`Increase quantity of ${item.title}`}
                              disabled={item.quantity >= MAX_ITEM_QUANTITY}
                              onClick={() => updateQuantity(item.productId, item.variantId, 1)}
                            >
                              <Plus size={14} />
                            </button>
                          </div>

                          <div className="cp-item-right">
                            <strong className="cp-item-total">
                              ${(item.price * item.quantity).toLocaleString('en-US')}
                            </strong>
                            <button
                              type="button"
                              className="cp-remove-btn"
                              aria-label={`Remove ${item.title}`}
                              onClick={() => removeFromCart(item.productId, item.variantId)}
                            >
                              <Trash2 size={15} />
                              <span>Remove</span>
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {/* Right Column: Order Summary */}
                <aside className="cp-summary-card" aria-label="Order Summary">
                  <h2 className="cp-summary-heading">ORDER SUMMARY</h2>

                  <div className="cp-summary-lines">
                    <div className="cp-summary-line">
                      <span>Subtotal ({cartCount} {cartCount === 1 ? 'piece' : 'pieces'})</span>
                      <span>${subtotal.toLocaleString('en-US')}</span>
                    </div>
                    <div className="cp-summary-line">
                      <span>Insured Courier Delivery</span>
                      <span>Complimentary</span>
                    </div>
                  </div>

                  <div className="cp-summary-total">
                    <span>TOTAL</span>
                    <strong>${subtotal.toLocaleString('en-US')}</strong>
                  </div>

                  {checkoutError && (
                    <div className="cp-error-banner" role="alert">
                      <p>{checkoutError}</p>
                      {!isAuthenticated && (
                        <button
                          type="button"
                          className="cp-signin-link"
                          onClick={() => {
                            savePostLoginRedirect('/checkout');
                            navigate('/signin');
                          }}
                        >
                          SIGN IN WITH GOOGLE
                        </button>
                      )}
                    </div>
                  )}

                  {isCheckout ? (
                    <button
                      type="submit"
                      form="luxe-fullscreen-checkout"
                      disabled={isSubmitting}
                      className="cp-primary-btn cp-full-btn"
                    >
                      {isSubmitting ? 'VALIDATING...' : 'PLACE LUXURY ORDER'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="cp-primary-btn cp-full-btn"
                      onClick={() => navigate('/checkout')}
                    >
                      PROCEED TO CHECKOUT
                    </button>
                  )}

                  <div className="cp-assurance">
                    <ShieldCheck size={15} />
                    <span>Swiss Authenticity Certificate & 5-Year International Warranty</span>
                  </div>
                </aside>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export function CartPage({ initialMode = 'cart' }) {
  const { user, isAuthenticated } = useAuth();
  // Keying by user?.id ensures checkout inputs never carry over between switched accounts
  return (
    <ScopedCartPage
      key={`${initialMode}:${user?.id || 'guest'}`}
      initialMode={initialMode}
      user={user}
      isAuthenticated={isAuthenticated}
    />
  );
}
