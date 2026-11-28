import { useRef, useState } from 'react';
import { X, Plus, Minus, Trash2, CheckCircle2, ArrowLeft } from 'lucide-react';
import { useAuth, useCart } from '../context/storeHooks';
import { MAX_ITEM_QUANTITY, validateCheckoutSubmission } from '../lib/security';
import './CartDrawer.css';

function ScopedCartDrawer({ user, isAuthenticated }) {
  const {
    items,
    cartCount,
    subtotal,
    isCartOpen,
    drawerView,
    setDrawerView,
    closeCart,
    updateQuantity,
    removeFromCart,
    clearCart,
  } = useCart();

  const [customerName, setCustomerName] = useState(user?.fullName || '');
  const [customerEmail, setCustomerEmail] = useState(user?.email || '');
  const [shippingAddress, setShippingAddress] = useState(user?.address || '');
  const [checkoutError, setCheckoutError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [orderPlaced, setOrderPlaced] = useState(false);
  const submitLockRef = useRef(false);

  if (!isCartOpen) return null;

  const handleClose = () => {
    setOrderPlaced(false);
    setCheckoutError('');
    closeCart();
  };

  const handlePlaceOrder = (e) => {
    e.preventDefault();
    if (submitLockRef.current) return;
    setCheckoutError('');

    if (!isAuthenticated) {
      setCheckoutError('Please sign in with Google before submitting a reservation.');
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);

    const validation = validateCheckoutSubmission({
      items,
      customerName: customerName || user?.fullName,
      customerEmail: user?.email || customerEmail,
      customerPhone: user?.phone || '',
      shippingAddress: shippingAddress || user?.address,
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
    <div className="cart-backdrop" role="presentation" onClick={handleClose}>
      <aside
        className="cart-drawer"
        aria-label={drawerView === 'checkout' ? 'Checkout' : 'Shopping Basket'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cart-header">
          <h2 className="cart-heading">
            {orderPlaced
              ? 'RESERVATION RECORDED'
              : drawerView === 'checkout'
              ? 'CHECKOUT'
              : `YOUR BASKET (${cartCount})`}
          </h2>
          <button type="button" className="cart-close" aria-label="Close basket" onClick={handleClose}>
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>

        {orderPlaced ? (
          <div className="cart-body cart-confirmed">
            <CheckCircle2 size={42} strokeWidth={1.5} className="cart-confirmed-icon" />
            <h3 className="cart-confirmed-title">Pending payment verification</h3>
            <p className="cart-confirmed-copy">
              Your Luxe Store reservation for {user?.email || customerEmail || 'your account'} has
              been recorded. Fulfillment begins only once payment is verified server-side.
            </p>
            <button type="button" className="cart-checkout-btn" onClick={handleClose}>
              RETURN TO COLLECTION
            </button>
          </div>
        ) : drawerView === 'checkout' ? (
          <>
            <div className="cart-body">
              <button
                type="button"
                className="cart-back-link"
                onClick={() => setDrawerView('cart')}
              >
                <ArrowLeft size={14} />
                <span>BACK TO BASKET ({cartCount})</span>
              </button>

              {items.length === 0 ? (
                <p className="cart-empty">Your curated selection is currently empty.</p>
              ) : (
                <>
                  <ul className="cart-summary-list">
                    {items.map((item) => (
                      <li key={`${item.productId}-${item.variantId}`} className="cart-summary-row">
                        <span>
                          {item.title} × {item.quantity}
                        </span>
                        <strong>${(item.price * item.quantity).toLocaleString('en-US')}</strong>
                      </li>
                    ))}
                  </ul>

                  <form id="luxe-checkout-form" className="cart-checkout-form" onSubmit={handlePlaceOrder}>
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
                      <span>SHIPPING ADDRESS</span>
                      <input
                        type="text"
                        required
                        maxLength={200}
                        dir="auto"
                        autoComplete="street-address"
                        placeholder="5th Avenue, New York, NY"
                        value={shippingAddress}
                        onChange={(e) => setShippingAddress(e.target.value)}
                      />
                    </label>
                  </form>
                  {checkoutError && (
                    <p style={{ color: '#ffd6d6', fontSize: '12px', marginTop: '12px' }} role="alert">
                      {checkoutError}
                    </p>
                  )}
                </>
              )}
            </div>

            {items.length > 0 && (
              <div className="cart-footer">
                <div className="cart-subtotal-row">
                  <span>TOTAL</span>
                  <strong>${subtotal.toLocaleString('en-US')}</strong>
                </div>
                <button
                  type="submit"
                  form="luxe-checkout-form"
                  disabled={isSubmitting}
                  className="cart-checkout-btn"
                >
                  {isSubmitting ? 'VALIDATING...' : 'PLACE LUXURY ORDER'}
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="cart-body">
              {items.length === 0 ? (
                <p className="cart-empty">Your curated selection is currently empty.</p>
              ) : (
                <ul className="cart-items">
                  {items.map((item) => (
                    <li key={`${item.productId}-${item.variantId}`} className="cart-item">
                      <img src={item.image} alt={item.title} className="cart-item-img" />
                      <div className="cart-item-info">
                        <h3 className="cart-item-title">{item.title}</h3>
                        <p className="cart-item-variant">{item.variantLabel}</p>
                        <p className="cart-item-price">{item.formattedPrice}</p>
                        <div className="cart-item-controls">
                          <button
                            type="button"
                            aria-label="Decrease quantity"
                            onClick={() => updateQuantity(item.productId, item.variantId, -1)}
                          >
                            <Minus size={13} />
                          </button>
                          <span>{item.quantity}</span>
                          <button
                            type="button"
                            aria-label="Increase quantity"
                            disabled={item.quantity >= MAX_ITEM_QUANTITY}
                            onClick={() => updateQuantity(item.productId, item.variantId, 1)}
                          >
                            <Plus size={13} />
                          </button>
                          <button
                            type="button"
                            className="cart-remove-btn"
                            aria-label={`Remove ${item.title}`}
                            onClick={() => removeFromCart(item.productId, item.variantId)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="cart-footer">
              <div className="cart-subtotal-row">
                <span>SUBTOTAL</span>
                <strong>${subtotal.toLocaleString('en-US')}</strong>
              </div>
              {items.length > 0 ? (
                <button
                  type="button"
                  className="cart-checkout-btn"
                  onClick={() => setDrawerView('checkout')}
                >
                  PROCEED TO CHECKOUT
                </button>
              ) : (
                <button type="button" className="cart-checkout-btn" onClick={handleClose}>
                  CONTINUE EXPLORING
                </button>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

export function CartDrawer() {
  const { user, isAuthenticated } = useAuth();
  return <ScopedCartDrawer key={user?.id || 'guest'} user={user} isAuthenticated={isAuthenticated} />;
}
