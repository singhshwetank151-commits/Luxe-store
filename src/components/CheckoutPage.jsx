import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Upload,
  X,
} from 'lucide-react';
import { useAuth, useCart, useRouter } from '../context/storeHooks';
import { trackProductEvent } from '../lib/analytics';
import { formatInr } from '../lib/currency';
import { isSupabaseConfigured, supabase, supabaseUrl } from '../lib/supabase';
import {
  ALLOWED_PROOF_MIME_TYPES,
  buildSafeUpiIntentUrl,
  savePostLoginRedirect,
  validateCheckoutSubmission,
  validateUpiPaymentProof,
  withNetworkGuard,
} from '../lib/security';
import './CheckoutPage.css';

const PAYMENT_WINDOW_SECONDS = 15 * 60;

function generateOrderNumber() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `LS-${y}${m}${d}-${suffix}`;
}

function formatCountdown(totalSeconds) {
  const clamped = Math.max(0, totalSeconds);
  const mins = String(Math.floor(clamped / 60)).padStart(2, '0');
  const secs = String(clamped % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function getFileExtension(mimeType) {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function ScopedCheckoutPage({ user, isAuthenticated }) {
  const { items, cartCount, subtotal, clearCart } = useCart();
  const { navigate } = useRouter();

  const [step, setStep] = useState('details'); // 'details' | 'payment' | 'confirmed'
  const [customerName, setCustomerName] = useState(user?.fullName || '');
  const [customerEmail, setCustomerEmail] = useState(user?.email || '');
  const [customerPhone, setCustomerPhone] = useState(user?.phone || '');
  const [shippingAddress, setShippingAddress] = useState(user?.address || '');
  const [city, setCity] = useState(user?.city || '');
  const [postalCode, setPostalCode] = useState(user?.postalCode || '');
  const [stateName, setStateName] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');

  const [storeSettings, setStoreSettings] = useState({
    store_name: 'Luxe Store',
    upi_id: '',
    upi_display_name: 'Luxe Store',
    upi_qr_image_url: null,
    upi_payment_instructions:
      'Scan the UPI QR code or transfer the exact invoice amount to our verified UPI ID, then submit your 12-digit UTR reference number below.',
  });

  const [activeOrder, setActiveOrder] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(PAYMENT_WINDOW_SECONDS);
  const [copiedField, setCopiedField] = useState('');

  const [utrNumber, setUtrNumber] = useState('');
  const [payerUpiId, setPayerUpiId] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [proofFile, setProofFile] = useState(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState('');

  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [isSubmittingProof, setIsSubmittingProof] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState(null);

  const submitLockRef = useRef(false);
  const proofLockRef = useRef(false);
  const checkoutTrackedRef = useRef(false);
  const fileInputRef = useRef(null);

  // Record high-intent checkout_start event once when customer opens checkout with items
  useEffect(() => {
    if (checkoutTrackedRef.current || items.length === 0) return;
    checkoutTrackedRef.current = true;
    for (const item of items.slice(0, 5)) {
      trackProductEvent(item, 'checkout_start');
    }
  }, [items]);

  // Load live merchant UPI settings from Supabase store_settings
  useEffect(() => {
    let active = true;
    if (!isSupabaseConfigured || !supabase) return undefined;

    (async () => {
      try {
        const { data } = await withNetworkGuard(
          supabase
            .from('store_settings')
            .select(
              'store_name, upi_id, upi_display_name, upi_qr_image_url, upi_payment_instructions'
            )
            .limit(1)
            .maybeSingle(),
          10000
        );
        if (active && data) {
          setStoreSettings((prev) => ({
            ...prev,
            store_name: data.store_name || prev.store_name,
            upi_id: data.upi_id || prev.upi_id,
            upi_display_name: data.upi_display_name || data.store_name || prev.upi_display_name,
            upi_qr_image_url: data.upi_qr_image_url || null,
            upi_payment_instructions:
              data.upi_payment_instructions || prev.upi_payment_instructions,
          }));
        }
      } catch {
        // Keep safe defaults if offline
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // Revoke object URL for uploaded screenshot preview on cleanup
  useEffect(() => {
    return () => {
      if (proofPreviewUrl) {
        URL.revokeObjectURL(proofPreviewUrl);
      }
    };
  }, [proofPreviewUrl]);

  const upiIntentUrl = useMemo(() => {
    if (!activeOrder || !storeSettings.upi_id) return '';
    return buildSafeUpiIntentUrl({
      upiId: storeSettings.upi_id,
      payeeName: storeSettings.upi_display_name || storeSettings.store_name,
      amount: activeOrder.payableAmount,
      orderNumber: activeOrder.orderNumber,
    });
  }, [activeOrder, storeSettings]);

  // Generate local CSP-safe QR code data URL whenever UPI intent changes
  useEffect(() => {
    let active = true;
    if (!upiIntentUrl) {
      setQrDataUrl('');
      return undefined;
    }

    QRCode.toDataURL(upiIntentUrl, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#220306',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });

    return () => {
      active = false;
    };
  }, [upiIntentUrl]);

  // 15-minute live countdown during payment step
  useEffect(() => {
    if (step !== 'payment' || !activeOrder?.expiresAt) return undefined;

    const tick = () => {
      const remaining = Math.floor((activeOrder.expiresAt - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, remaining));
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [step, activeOrder?.expiresAt]);

  const invokeUpiGateway = useCallback(async (payload) => {
    if (!isSupabaseConfigured || !supabase || !supabaseUrl) return null;
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    if (!accessToken) return null;

    const res = await withNetworkGuard(
      fetch(`${supabaseUrl}/functions/v1/gateway-free-upi`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      }),
      12000
    );
    if (!res.ok) return null;
    return res.json().catch(() => null);
  }, []);

  const handleCheckPaymentStatus = useCallback(
    async (silent = false) => {
      if (!activeOrder?.dbOrderId || isCheckingStatus) return;
      if (!silent) {
        setIsCheckingStatus(true);
        setStatusMessage('');
      }
      try {
        const result = await invokeUpiGateway({
          action: 'sync_order_status',
          order_id: activeOrder.dbOrderId,
        });
        if (result?.ok && (result.status === 'Paid' || result.payment_status === 'confirmed')) {
          setConfirmationResult({
            mode: 'confirmed',
            orderNumber: activeOrder.orderNumber,
            amount: activeOrder.payableAmount,
            utrNumber: result.utr || 'Auto-verified via UPI',
            customer: activeOrder.customer,
            items: activeOrder.items,
          });
          clearCart();
          setStep('confirmed');
          return;
        }
        if (!silent) {
          setStatusMessage(
            result?.status === 'Review'
              ? 'Payment proof is under verification by our team.'
              : 'Payment not detected yet. If you already paid, submit your 12-digit UTR below.'
          );
        }
      } catch {
        if (!silent) {
          setStatusMessage('Could not check automated bank status right now. You can submit your UTR below.');
        }
      } finally {
        if (!silent) setIsCheckingStatus(false);
      }
    },
    [activeOrder, clearCart, invokeUpiGateway, isCheckingStatus]
  );

  const isPaymentExpired = secondsLeft <= 0;

  // Poll gateway-free-upi every 12 seconds while awaiting UPI credit
  useEffect(() => {
    if (step !== 'payment' || !activeOrder?.dbOrderId || isPaymentExpired) return undefined;
    const id = window.setInterval(() => {
      handleCheckPaymentStatus(true);
    }, 12000);
    return () => window.clearInterval(id);
  }, [step, activeOrder?.dbOrderId, isPaymentExpired, handleCheckPaymentStatus]);

  const handleCopy = async (field, value) => {
    try {
      await navigator.clipboard.writeText(String(value));
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(''), 1800);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    setErrorMessage('');
    if (!file) {
      setProofFile(null);
      if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
      setProofPreviewUrl('');
      return;
    }

    if (!ALLOWED_PROOF_MIME_TYPES.includes(file.type)) {
      setErrorMessage('Payment screenshot must be a JPEG, PNG, or WebP image.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage('Payment screenshot must be 5 MB or smaller.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    setProofFile(file);
    setProofPreviewUrl(URL.createObjectURL(file));
  };

  const handleClearFile = () => {
    setProofFile(null);
    if (proofPreviewUrl) URL.revokeObjectURL(proofPreviewUrl);
    setProofPreviewUrl('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleContinueToPayment = async (e) => {
    e.preventDefault();
    if (submitLockRef.current) return;
    setErrorMessage('');

    if (!isAuthenticated) {
      setErrorMessage('Sign in with Google before starting a UPI checkout.');
      return;
    }

    const cityPostal = [city.trim(), stateName.trim(), postalCode.trim()].filter(Boolean).join(', ');
    const validation = validateCheckoutSubmission({
      items,
      customerName,
      customerEmail: user?.email || customerEmail,
      customerPhone,
      shippingAddress,
      cityPostal,
    });

    if (!validation.ok) {
      setErrorMessage(validation.error);
      return;
    }

    submitLockRef.current = true;
    setIsCreatingOrder(true);

    try {
      const orderNumber = generateOrderNumber();
      const expiresAt = Date.now() + PAYMENT_WINDOW_SECONDS * 1000;
      const payableAmount = validation.quote.total;
      let dbOrderId = null;

      if (isSupabaseConfigured && supabase && user?.id) {
        try {
          const { data: createdOrder, error: orderErr } = await withNetworkGuard(
            supabase
              .from('orders')
              .insert({
                order_number: orderNumber,
                user_id: user.id,
                customer_snapshot: {
                  full_name: validation.customer.fullName,
                  email: validation.customer.email,
                  phone: validation.customer.phone,
                },
                delivery_address_snapshot: {
                  street: validation.customer.shippingAddress,
                  city: city.trim(),
                  state: stateName.trim(),
                  postal_code: postalCode.trim(),
                  country: 'India',
                  notes: deliveryNotes.trim().slice(0, 200) || null,
                },
                final_amount: payableAmount,
                unique_payable_amount: payableAmount,
                currency: 'INR',
                payment_method: 'upi',
                payment_status: 'pending_payment',
                delivery_status: 'pending_payment',
                payment_expires_at: new Date(expiresAt).toISOString(),
              })
              .select('id, order_number, unique_payable_amount, final_amount, payment_expires_at')
              .single(),
            15000
          );

          if (!orderErr && createdOrder?.id) {
            dbOrderId = createdOrder.id;

            await supabase.from('order_items').insert(
              validation.quote.items.map((item) => ({
                order_id: dbOrderId,
                product_name_snapshot: item.title,
                sku_snapshot: item.variantId,
                quantity: item.quantity,
                unit_price: item.price,
                total_price: item.lineTotal,
              }))
            );

            await supabase.from('payments').insert({
              order_id: dbOrderId,
              amount: payableAmount,
              currency: 'INR',
              method: 'upi',
              status: 'pending',
            });

            // Register with gateway-free-upi bridge for automatic bank credit detection
            await invokeUpiGateway({
              action: 'register_bridge',
              order_id: dbOrderId,
            }).catch(() => null);
          }
        } catch {
          // Proceed with client order reference if direct DB insert is restricted
        }
      }

      setActiveOrder({
        dbOrderId,
        orderNumber,
        payableAmount,
        expiresAt,
        items: validation.quote.items,
        itemCount: validation.quote.itemCount,
        customer: {
          ...validation.customer,
          city: city.trim(),
          state: stateName.trim(),
          postalCode: postalCode.trim(),
          deliveryNotes: deliveryNotes.trim(),
        },
      });
      setSecondsLeft(PAYMENT_WINDOW_SECONDS);
      setStep('payment');
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to initialize UPI checkout. Please try again.'
      );
    } finally {
      setIsCreatingOrder(false);
      submitLockRef.current = false;
    }
  };

  const handleSubmitProof = async (e) => {
    e.preventDefault();
    if (proofLockRef.current || !activeOrder) return;
    setErrorMessage('');

    const validated = validateUpiPaymentProof({
      utrNumber,
      payerUpiId,
      customerNote,
      file: proofFile,
    });

    if (!validated.ok) {
      setErrorMessage(validated.error);
      return;
    }

    proofLockRef.current = true;
    setIsSubmittingProof(true);

    try {
      let proofImageUrl = null;

      if (proofFile && isSupabaseConfigured && supabase && user?.id) {
        const ext = getFileExtension(proofFile.type);
        const objectPath = `${user.id}/${activeOrder.orderNumber}-${Date.now()}.${ext}`;
        const { error: uploadErr } = await withNetworkGuard(
          supabase.storage.from('payment-proofs').upload(objectPath, proofFile, {
            contentType: proofFile.type,
            upsert: false,
          }),
          20000
        );
        if (uploadErr) {
          throw new Error(`Could not upload payment screenshot: ${uploadErr.message}`);
        }
        proofImageUrl = `/payment-proofs/${objectPath}`;
      }

      if (activeOrder.dbOrderId && isSupabaseConfigured && supabase) {
        const { error: verifErr } = await withNetworkGuard(
          supabase.from('payment_verifications').insert({
            order_id: activeOrder.dbOrderId,
            utr_number: validated.data.utrNumber,
            payer_upi_id: validated.data.payerUpiId,
            proof_image_url: proofImageUrl,
            customer_note: validated.data.customerNote,
            verification_status: 'pending',
          }),
          15000
        );
        if (verifErr) {
          throw new Error(`Could not save verification record: ${verifErr.message}`);
        }
      }

      setConfirmationResult({
        mode: 'verification_pending',
        orderNumber: activeOrder.orderNumber,
        amount: activeOrder.payableAmount,
        utrNumber: validated.data.utrNumber,
        payerUpiId: validated.data.payerUpiId,
        hasScreenshot: Boolean(proofFile),
        customer: activeOrder.customer,
        items: activeOrder.items,
      });
      clearCart();
      setStep('confirmed');
      window.scrollTo({ top: 0, behavior: 'auto' });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to submit payment proof. Please try again.'
      );
    } finally {
      setIsSubmittingProof(false);
      proofLockRef.current = false;
    }
  };

  const displayItems = activeOrder?.items || items;
  const displayCount = activeOrder?.itemCount ?? cartCount;
  const displayTotal = activeOrder?.payableAmount ?? subtotal;

  return (
    <main className="chk-page">
      <div className="chk-container">
        <button
          type="button"
          className="chk-back-btn"
          onClick={() => {
            if (step === 'payment') {
              setStep('details');
              setErrorMessage('');
            } else {
              navigate(step === 'confirmed' ? '/collection' : '/cart');
            }
          }}
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
          <span>
            {step === 'payment'
              ? 'Edit delivery details'
              : step === 'confirmed'
              ? 'Back to collection'
              : 'Back to bag'}
          </span>
        </button>

        {/* Empty bag guard before order creation */}
        {step === 'details' && items.length === 0 ? (
          <section className="chk-empty">
            <h1 className="chk-title">Your bag is empty</h1>
            <p className="chk-subtitle">
              Add a mechanical skeleton timepiece from the collection before checking out.
            </p>
            <button
              type="button"
              className="chk-primary-btn"
              onClick={() => navigate('/collection')}
            >
              Explore collection
            </button>
          </section>
        ) : (
          <>
            <header className="chk-header">
              <div>
                <span className="chk-eyebrow">Direct UPI checkout · INR</span>
                <h1 className="chk-title">
                  {step === 'details'
                    ? 'Delivery details'
                    : step === 'payment'
                    ? 'Complete UPI payment'
                    : confirmationResult?.mode === 'confirmed'
                    ? 'Payment confirmed'
                    : 'Payment proof submitted'}
                </h1>
              </div>

              <ol className="chk-stepper" aria-label="Checkout progress">
                <li className={step === 'details' ? 'is-current' : 'is-done'}>
                  <span className="chk-step-num">1</span>
                  <span>Delivery</span>
                </li>
                <li
                  className={
                    step === 'payment' ? 'is-current' : step === 'confirmed' ? 'is-done' : ''
                  }
                >
                  <span className="chk-step-num">2</span>
                  <span>UPI payment</span>
                </li>
                <li className={step === 'confirmed' ? 'is-current' : ''}>
                  <span className="chk-step-num">3</span>
                  <span>Confirmed</span>
                </li>
              </ol>
            </header>

            {errorMessage && (
              <div className="chk-alert chk-alert-error" role="alert">
                <p>{errorMessage}</p>
                {!isAuthenticated && (
                  <button
                    type="button"
                    className="chk-inline-btn"
                    onClick={() => {
                      savePostLoginRedirect('/checkout');
                      navigate('/signin');
                    }}
                  >
                    Sign in with Google
                  </button>
                )}
              </div>
            )}

            {/* STEP 1: DELIVERY DETAILS */}
            {step === 'details' && (
              <div className="chk-grid">
                <form id="luxe-upi-checkout-form" className="chk-card" onSubmit={handleContinueToPayment}>
                  {!isAuthenticated && (
                    <div className="chk-signin-banner">
                      <div>
                        <strong>Sign in required for UPI checkout</strong>
                        <p>Your Google account links your order receipt and payment proof securely.</p>
                      </div>
                      <button
                        type="button"
                        className="chk-secondary-btn"
                        onClick={() => {
                          savePostLoginRedirect('/checkout');
                          navigate('/signin');
                        }}
                      >
                        Sign in with Google
                      </button>
                    </div>
                  )}

                  <h2 className="chk-section-title">Client and shipping address</h2>
                  <div className="chk-form-grid">
                    <label className="chk-field">
                      <span>Full name</span>
                      <input
                        type="text"
                        required
                        maxLength={100}
                        autoComplete="name"
                        placeholder="Aarav Mehta"
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                      />
                    </label>

                    <label className="chk-field">
                      <span>Email address</span>
                      <input
                        type="email"
                        required
                        maxLength={160}
                        autoComplete="email"
                        readOnly={Boolean(user?.email)}
                        placeholder="client@example.com"
                        value={user?.email || customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                      />
                    </label>

                    <label className="chk-field">
                      <span>Mobile number</span>
                      <input
                        type="tel"
                        required
                        maxLength={24}
                        autoComplete="tel"
                        placeholder="+91 98765 43210"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                      />
                    </label>

                    <label className="chk-field">
                      <span>PIN code</span>
                      <input
                        type="text"
                        required
                        maxLength={12}
                        inputMode="numeric"
                        autoComplete="postal-code"
                        placeholder="400001"
                        value={postalCode}
                        onChange={(e) => setPostalCode(e.target.value)}
                      />
                    </label>

                    <label className="chk-field chk-full">
                      <span>Street address and landmark</span>
                      <input
                        type="text"
                        required
                        maxLength={200}
                        autoComplete="street-address"
                        placeholder="Flat 402, Sea View Residency, Linking Road"
                        value={shippingAddress}
                        onChange={(e) => setShippingAddress(e.target.value)}
                      />
                    </label>

                    <label className="chk-field">
                      <span>City</span>
                      <input
                        type="text"
                        required
                        maxLength={80}
                        autoComplete="address-level2"
                        placeholder="Mumbai"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                      />
                    </label>

                    <label className="chk-field">
                      <span>State</span>
                      <input
                        type="text"
                        maxLength={80}
                        autoComplete="address-level1"
                        placeholder="Maharashtra"
                        value={stateName}
                        onChange={(e) => setStateName(e.target.value)}
                      />
                    </label>

                    <label className="chk-field chk-full">
                      <span>Delivery note (optional)</span>
                      <input
                        type="text"
                        maxLength={200}
                        placeholder="Call before delivery or preferred time window"
                        value={deliveryNotes}
                        onChange={(e) => setDeliveryNotes(e.target.value)}
                      />
                    </label>
                  </div>

                  <div className="chk-method-box">
                    <div className="chk-method-head">
                      <Smartphone size={16} strokeWidth={1.5} />
                      <strong>Direct UPI payment (zero gateway fee)</strong>
                    </div>
                    <p>
                      Pay instantly via GPay, PhonePe, Paytm, or BHIM QR code on the next step, then
                      verify automatically or submit your 12-digit UTR reference.
                    </p>
                  </div>
                </form>

                {/* Order Summary Sidebar */}
                <aside className="chk-summary" aria-label="Order summary">
                  <h2 className="chk-section-title">Order summary</h2>
                  <ul className="chk-item-list">
                    {displayItems.map((item) => (
                      <li key={`${item.productId}-${item.variantId}`} className="chk-item">
                        <img src={item.image} alt={item.title} className="chk-item-img" />
                        <div className="chk-item-meta">
                          <strong>{item.title}</strong>
                          <span>
                            {item.variantLabel} · Qty {item.quantity}
                          </span>
                        </div>
                        <span className="chk-item-price">
                          {formatInr(item.price * item.quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="chk-totals">
                    <div className="chk-total-row">
                      <span>
                        Subtotal ({displayCount} {displayCount === 1 ? 'piece' : 'pieces'})
                      </span>
                      <span>{formatInr(displayTotal)}</span>
                    </div>
                    <div className="chk-total-row">
                      <span>Insured courier delivery</span>
                      <span>Complimentary</span>
                    </div>
                    <div className="chk-total-grand">
                      <span>Total payable</span>
                      <strong>{formatInr(displayTotal)}</strong>
                    </div>
                  </div>

                  <button
                    type="submit"
                    form="luxe-upi-checkout-form"
                    disabled={isCreatingOrder}
                    className="chk-primary-btn chk-full-btn"
                  >
                    {isCreatingOrder ? 'Preparing UPI invoice...' : 'Continue to UPI payment'}
                  </button>

                  <div className="chk-assurance">
                    <ShieldCheck size={16} strokeWidth={1.5} />
                    <span>Authenticity certificate and 5-year warranty included</span>
                  </div>
                </aside>
              </div>
            )}

            {/* STEP 2: DIRECT UPI QR + UTR & SCREENSHOT PROOF */}
            {step === 'payment' && activeOrder && (
              <div className="chk-grid">
                <section className="chk-card chk-upi-panel">
                  <div className="chk-upi-top">
                    <div>
                      <span className="chk-eyebrow">Invoice {activeOrder.orderNumber}</span>
                      <div className="chk-payable-amount">
                        {formatInr(activeOrder.payableAmount)}
                      </div>
                    </div>
                    <div className={`chk-timer ${secondsLeft <= 120 ? 'is-low' : ''}`}>
                      <Clock size={16} strokeWidth={1.5} />
                      <span>
                        {secondsLeft > 0 ? `Expires in ${formatCountdown(secondsLeft)}` : 'Session expired'}
                      </span>
                    </div>
                  </div>

                  <p className="chk-upi-copy">{storeSettings.upi_payment_instructions}</p>

                  <div className="chk-qr-wrap">
                    <div className="chk-qr-frame">
                      {storeSettings.upi_qr_image_url ? (
                        <img
                          src={storeSettings.upi_qr_image_url}
                          alt="Merchant UPI QR code"
                          className="chk-qr-img"
                        />
                      ) : qrDataUrl ? (
                        <img
                          src={qrDataUrl}
                          alt={`Scan to pay ${formatInr(activeOrder.payableAmount)} via UPI`}
                          className="chk-qr-img"
                        />
                      ) : (
                        <div className="chk-qr-fallback">
                          Configure your UPI ID in Supabase store settings to display a scannable QR code.
                        </div>
                      )}
                    </div>

                    <div className="chk-upi-details">
                      <div className="chk-copy-row">
                        <div>
                          <small>Merchant UPI ID</small>
                          <strong>{storeSettings.upi_id || 'Not configured'}</strong>
                        </div>
                        {storeSettings.upi_id && (
                          <button
                            type="button"
                            className="chk-copy-btn"
                            onClick={() => handleCopy('upi', storeSettings.upi_id)}
                          >
                            {copiedField === 'upi' ? (
                              <>
                                <Check size={16} strokeWidth={1.5} />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy size={16} strokeWidth={1.5} />
                                <span>Copy</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      <div className="chk-copy-row">
                        <div>
                          <small>Exact amount</small>
                          <strong>{formatInr(activeOrder.payableAmount)}</strong>
                        </div>
                        <button
                          type="button"
                          className="chk-copy-btn"
                          onClick={() => handleCopy('amount', activeOrder.payableAmount.toFixed(2))}
                        >
                          {copiedField === 'amount' ? (
                            <>
                              <Check size={16} strokeWidth={1.5} />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy size={16} strokeWidth={1.5} />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>

                      {upiIntentUrl && (
                        <a href={upiIntentUrl} className="chk-primary-btn chk-full-btn chk-upi-app-link">
                          <Smartphone size={16} strokeWidth={1.5} />
                          <span>Pay with UPI app</span>
                          <ExternalLink size={16} strokeWidth={1.5} />
                        </a>
                      )}

                      {activeOrder.dbOrderId && (
                        <button
                          type="button"
                          className="chk-secondary-btn chk-full-btn"
                          disabled={isCheckingStatus}
                          onClick={() => handleCheckPaymentStatus(false)}
                        >
                          <RefreshCw
                            size={16}
                            strokeWidth={1.5}
                            className={isCheckingStatus ? 'chk-spin' : ''}
                          />
                          <span>
                            {isCheckingStatus ? 'Checking bank status...' : 'Check payment status'}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {statusMessage && (
                    <div className="chk-alert chk-alert-info" role="status">
                      {statusMessage}
                    </div>
                  )}

                  {/* UTR & Payment Screenshot Proof Submission */}
                  <form className="chk-proof-form" onSubmit={handleSubmitProof}>
                    <h2 className="chk-section-title">Submit UPI verification proof</h2>
                    <div className="chk-form-grid">
                      <label className="chk-field">
                        <span>12-digit UTR / UPI reference number</span>
                        <input
                          type="text"
                          required
                          maxLength={24}
                          placeholder="e.g. 432198765432"
                          value={utrNumber}
                          onChange={(e) => setUtrNumber(e.target.value)}
                        />
                      </label>

                      <label className="chk-field">
                        <span>Your UPI ID (optional)</span>
                        <input
                          type="text"
                          maxLength={96}
                          placeholder="yourname@okaxis"
                          value={payerUpiId}
                          onChange={(e) => setPayerUpiId(e.target.value)}
                        />
                      </label>

                      <div className="chk-field chk-full">
                        <span>Payment screenshot (optional, JPEG / PNG / WebP up to 5 MB)</span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="chk-file-input"
                          onChange={handleFileChange}
                        />
                        {proofPreviewUrl ? (
                          <div className="chk-proof-preview">
                            <img src={proofPreviewUrl} alt="Selected payment receipt" />
                            <div className="chk-proof-meta">
                              <strong>{proofFile?.name}</strong>
                              <small>
                                {((proofFile?.size || 0) / 1024).toFixed(0)} KB
                              </small>
                            </div>
                            <button
                              type="button"
                              className="chk-icon-close"
                              aria-label="Remove screenshot"
                              onClick={handleClearFile}
                            >
                              <X size={16} strokeWidth={1.5} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="chk-upload-trigger"
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <Upload size={16} strokeWidth={1.5} />
                            <span>Attach payment screenshot</span>
                          </button>
                        )}
                      </div>

                      <label className="chk-field chk-full">
                        <span>Note for treasury desk (optional)</span>
                        <input
                          type="text"
                          maxLength={240}
                          placeholder="Paid from HDFC GPay account"
                          value={customerNote}
                          onChange={(e) => setCustomerNote(e.target.value)}
                        />
                      </label>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmittingProof}
                      className="chk-primary-btn chk-full-btn"
                    >
                      {isSubmittingProof ? 'Submitting proof...' : 'Submit payment proof'}
                    </button>
                  </form>
                </section>

                {/* Right Column: Locked Order Summary */}
                <aside className="chk-summary" aria-label="Invoice summary">
                  <h2 className="chk-section-title">Invoice summary</h2>
                  <ul className="chk-item-list">
                    {activeOrder.items.map((item) => (
                      <li key={`${item.productId}-${item.variantId}`} className="chk-item">
                        <img src={item.image} alt={item.title} className="chk-item-img" />
                        <div className="chk-item-meta">
                          <strong>{item.title}</strong>
                          <span>
                            {item.variantLabel} · Qty {item.quantity}
                          </span>
                        </div>
                        <span className="chk-item-price">
                          {formatInr(item.price * item.quantity)}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="chk-totals">
                    <div className="chk-total-row">
                      <span>Deliver to</span>
                      <span className="chk-deliver-to">{activeOrder.customer.fullName}</span>
                    </div>
                    <div className="chk-total-row">
                      <span>Address</span>
                      <span className="chk-deliver-to">
                        {activeOrder.customer.city} {activeOrder.customer.postalCode}
                      </span>
                    </div>
                    <div className="chk-total-grand">
                      <span>Total payable</span>
                      <strong>{formatInr(activeOrder.payableAmount)}</strong>
                    </div>
                  </div>
                </aside>
              </div>
            )}

            {/* STEP 3: CONFIRMED / VERIFICATION RECORDED */}
            {step === 'confirmed' && confirmationResult && (
              <section className="chk-confirmed-card" aria-live="polite">
                <CheckCircle2 size={44} strokeWidth={1.5} className="chk-confirmed-icon" />
                <span className="chk-eyebrow">
                  {confirmationResult.mode === 'confirmed'
                    ? 'Verified UPI settlement'
                    : 'Awaiting treasury verification'}
                </span>
                <h2 className="chk-confirmed-title">
                  {confirmationResult.mode === 'confirmed'
                    ? 'Your timepiece order is confirmed'
                    : 'Your UPI payment proof has been recorded'}
                </h2>
                <p className="chk-confirmed-copy">
                  {confirmationResult.mode === 'confirmed'
                    ? 'Payment was matched automatically. Your watch is queued for insured courier dispatch.'
                    : 'Our team is verifying your UTR reference against our bank statement. Dispatch begins immediately after approval.'}
                </p>

                <dl className="chk-receipt-grid">
                  <div>
                    <dt>Order number</dt>
                    <dd>{confirmationResult.orderNumber}</dd>
                  </div>
                  <div>
                    <dt>Amount paid</dt>
                    <dd>{formatInr(confirmationResult.amount)}</dd>
                  </div>
                  <div>
                    <dt>UTR reference</dt>
                    <dd>{confirmationResult.utrNumber}</dd>
                  </div>
                  <div>
                    <dt>Delivery contact</dt>
                    <dd>
                      {confirmationResult.customer.fullName} · {confirmationResult.customer.phone}
                    </dd>
                  </div>
                </dl>

                <ul className="chk-item-list chk-receipt-items">
                  {confirmationResult.items.map((item) => (
                    <li key={`${item.productId}-${item.variantId}`} className="chk-item">
                      <img src={item.image} alt={item.title} className="chk-item-img" />
                      <div className="chk-item-meta">
                        <strong>{item.title}</strong>
                        <span>
                          {item.variantLabel} · Qty {item.quantity}
                        </span>
                      </div>
                      <span className="chk-item-price">
                        {formatInr(item.price * item.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="chk-confirmed-actions">
                  <button
                    type="button"
                    className="chk-primary-btn"
                    onClick={() => navigate('/collection')}
                  >
                    Continue exploring
                  </button>
                  <button
                    type="button"
                    className="chk-secondary-btn"
                    onClick={() => navigate('/profile')}
                  >
                    View profile
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

export function CheckoutPage() {
  const { user, isAuthenticated } = useAuth();
  return (
    <ScopedCheckoutPage
      key={user?.id || 'guest'}
      user={user}
      isAuthenticated={isAuthenticated}
    />
  );
}
