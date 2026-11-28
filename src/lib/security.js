import { getDefaultVariant, getProductById } from '../data/catalog.js';

export const MAX_ITEM_QUANTITY = 10;
export const MAX_CART_DISTINCT_ITEMS = 25;

export const ALLOWED_FINISH_OPTIONS = Object.freeze([
  '18K Yellow Gold',
  '18K Rose Gold',
  'Brushed Stainless Steel',
  'Obsidian Titanium PVD',
  'Crimson Ceramic Edition',
]);

export const ALLOWED_ORDER_STATUSES = Object.freeze([
  'pending_payment',
  'payment_verification',
  'confirmed',
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'cancelled',
  'refunded',
]);

export function validateInventoryAdjustment({ quantity, threshold, notes }) {
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 0 || qty > 100000) {
    return { ok: false, error: 'Stock quantity must be a whole number between 0 and 100,000.' };
  }
  const thresh = threshold === '' || threshold === null || threshold === undefined ? null : Number(threshold);
  if (thresh !== null && (!Number.isInteger(thresh) || thresh < 0 || thresh > 10000)) {
    return { ok: false, error: 'Low-stock threshold must be between 0 and 10,000.' };
  }
  return {
    ok: true,
    quantity: qty,
    threshold: thresh,
    notes: sanitizePlainText(notes || 'Manual inventory adjustment by administrator', 200),
  };
}

export function validateOrderLifecycleUpdate({ status, trackingNumber, courierPartner, trackingUrl, note }) {
  if (!ALLOWED_ORDER_STATUSES.includes(status)) {
    return { ok: false, error: 'Invalid delivery status selected.' };
  }
  const cleanUrl = String(trackingUrl || '').trim();
  if (cleanUrl && !/^https:\/\/[^\s<>]+$/i.test(cleanUrl)) {
    return { ok: false, error: 'Tracking URL must start with https://.' };
  }
  return {
    ok: true,
    status,
    trackingNumber: sanitizePlainText(trackingNumber, 80) || null,
    courierPartner: sanitizePlainText(courierPartner, 80) || null,
    trackingUrl: cleanUrl.slice(0, 240) || null,
    note: sanitizePlainText(note, 240) || null,
  };
}

function stripControlAndAngleBrackets(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 60 || code === 62) {
      out += ' ';
    } else {
      out += str[i];
    }
  }
  return out;
}

function containsControlChar(str) {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function stripControlCharsOnly(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    out += code <= 0x1f || code === 0x7f ? ' ' : str[i];
  }
  return out;
}

/**
 * Normalize user-facing text while preserving emojis, Unicode/Arabic, and escaping `<`/`>` at render time.
 */
export function normalizeUserText(value, maxLength = 240) {
  return stripControlCharsOnly(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Fail fast when offline and abort stalled network promises after timeoutMs.
 */
export async function withNetworkGuard(operation, timeoutMs = 15000) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('You appear to be offline. Please check your connection and try again.');
  }

  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      reject(new Error('Request timed out on slow connection. Please try again.'));
    }, timeoutMs);
  });

  try {
    const promise = typeof operation === 'function' ? operation() : operation;
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timerId);
  }
}

/**
 * Strip control chars and angle brackets from plain-text inputs/URL error strings.
 */
export function sanitizePlainText(value, maxLength = 240) {
  return stripControlAndAngleBrackets(String(value ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Validate internal navigation routes to prevent open redirects (`//evil.com`, `javascript:`).
 */
export function isSafeRoutePath(path) {
  if (typeof path !== 'string') return false;
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) return false;
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return false;
  if (containsControlChar(trimmed)) return false;
  return true;
}

const POST_LOGIN_REDIRECT_KEY = 'luxe_store_post_login_redirect';

export function savePostLoginRedirect(path) {
  if (typeof window === 'undefined' || !isSafeRoutePath(path)) return;
  try {
    window.sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, path.trim());
  } catch {
    // Ignore restricted storage environments
  }
}

export function consumePostLoginRedirect() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
    window.sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
    return isSafeRoutePath(raw) ? raw.trim() : null;
  } catch {
    return null;
  }
}

export function sanitizeAuthUrlError(rawError) {
  const cleaned = sanitizePlainText(rawError, 180);
  if (!cleaned) return '';
  return cleaned;
}

/**
 * Prototype-pollution-safe JSON parser (strips `__proto__`, `constructor`, `prototype`).
 */
export function safeJsonParse(raw) {
  if (typeof raw !== 'string' || raw.length > 65536) return null;
  try {
    return JSON.parse(raw, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      return value;
    });
  } catch {
    return null;
  }
}

/**
 * Linear-time email validation immune to ReDoS.
 */
export function isValidEmail(email) {
  if (typeof email !== 'string' || email.length < 5 || email.length > 160) return false;
  if (/\s/.test(email)) return false;
  const atIdx = email.indexOf('@');
  if (atIdx <= 0 || atIdx !== email.lastIndexOf('@')) return false;
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);
  if (!local || !domain || local.length > 64 || domain.length > 95) return false;
  const dotIdx = domain.indexOf('.');
  if (dotIdx <= 0 || dotIdx >= domain.length - 1 || domain.endsWith('.')) return false;
  return true;
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * Re-hydrate persisted cart items strictly from authoritative catalog metadata.
 * Discards manipulated prices, titles, images, non-integer quantities, and unknown SKUs.
 */
export function sanitizeCartItems(rawItems, lookupProduct = getProductById) {
  if (!Array.isArray(rawItems)) return [];

  const deduped = new Map();

  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') continue;
    if (deduped.size >= MAX_CART_DISTINCT_ITEMS) break;

    const product = lookupProduct(entry.productId);
    if (!product) continue;

    const variant =
      (entry.variantId &&
        product.variants?.find((v) => v.id === entry.variantId && v.available !== false)) ||
      getDefaultVariant(product);
    if (!variant || variant.available === false) continue;

    const rawQty = Number(entry.quantity);
    if (!Number.isInteger(rawQty) || rawQty < 1) continue;

    const key = `${product.id}::${variant.id}`;
    const existing = deduped.get(key);
    const nextQty = Math.min(MAX_ITEM_QUANTITY, (existing?.quantity || 0) + rawQty);

    deduped.set(key, {
      productId: product.id,
      variantId: variant.id,
      variantLabel: variant.label,
      title: product.title,
      price: product.price,
      formattedPrice: product.formattedPrice,
      image: product.image,
      quantity: nextQty,
    });
  }

  return Array.from(deduped.values());
}

/**
 * Calculate authoritative cart totals strictly from catalog prices and validated integer quantities.
 */
export function calculateAuthoritativeCartTotals(rawItems, lookupProduct = getProductById) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return { ok: false, error: 'Your shopping basket is empty.', items: [], subtotal: 0, shipping: 0, total: 0, itemCount: 0 };
  }

  if (rawItems.length > MAX_CART_DISTINCT_ITEMS) {
    return {
      ok: false,
      error: `Basket cannot exceed ${MAX_CART_DISTINCT_ITEMS} distinct items.`,
      items: [],
      subtotal: 0,
      shipping: 0,
      total: 0,
      itemCount: 0,
    };
  }

  const normalizedItems = [];
  let subtotal = 0;
  let itemCount = 0;

  for (const entry of rawItems) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'Invalid cart item payload.' };
    }

    const product = lookupProduct(entry.productId);
    if (!product) {
      return { ok: false, error: 'One or more products in your basket are invalid or unavailable.' };
    }

    const variant = product.variants?.find((v) => v.id === entry.variantId && v.available !== false);
    if (!variant) {
      return { ok: false, error: `Selected variant for ${product.title} is unavailable.` };
    }

    const qty = Number(entry.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_ITEM_QUANTITY) {
      return {
        ok: false,
        error: `Quantity for ${product.title} must be an integer between 1 and ${MAX_ITEM_QUANTITY}.`,
      };
    }

    // Reject client-side price tampering if caller passed a mismatched price
    if (entry.price !== undefined && Number(entry.price) !== product.price) {
      return {
        ok: false,
        error: `Price mismatch detected for ${product.title}. Please refresh your basket.`,
      };
    }

    const lineTotal = Math.round(product.price * qty * 100) / 100;
    subtotal = Math.round((subtotal + lineTotal) * 100) / 100;
    itemCount += qty;

    normalizedItems.push({
      productId: product.id,
      variantId: variant.id,
      variantLabel: variant.label,
      title: product.title,
      price: product.price,
      formattedPrice: product.formattedPrice,
      image: product.image,
      quantity: qty,
      lineTotal,
    });
  }

  const shipping = 0; // Complimentary insured courier
  const total = subtotal + shipping;

  return {
    ok: true,
    items: normalizedItems,
    subtotal,
    shipping,
    total,
    itemCount,
  };
}

export function validateCheckoutSubmission(
  { items, customerName, customerEmail, customerPhone, shippingAddress, cityPostal },
  lookupProduct = getProductById
) {
  const quote = calculateAuthoritativeCartTotals(items, lookupProduct);
  if (!quote.ok) {
    return { ok: false, error: quote.error };
  }

  const cleanName = normalizeUserText(customerName, 100);
  const cleanEmail = normalizeEmail(customerEmail);
  const cleanPhone = normalizeUserText(customerPhone, 24);
  const cleanAddress = normalizeUserText(shippingAddress, 200);
  const cleanCityPostal = normalizeUserText(cityPostal, 120);

  if (cleanName.length < 2) {
    return { ok: false, error: 'Please enter a valid full name (at least 2 characters).' };
  }
  if (!isValidEmail(cleanEmail)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  const phoneDigits = normalizePhoneDigits(cleanPhone);
  if (cleanPhone && (phoneDigits.length < 7 || phoneDigits.length > 15)) {
    return { ok: false, error: 'Please enter a valid phone number (7–15 digits).' };
  }
  if (cleanAddress.length < 5) {
    return { ok: false, error: 'Please enter a complete street delivery address.' };
  }
  if (cityPostal !== undefined && cleanCityPostal.length < 2) {
    return { ok: false, error: 'Please enter your city and postal code.' };
  }

  return {
    ok: true,
    quote,
    customer: {
      fullName: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      shippingAddress: cleanAddress,
      cityPostal: cleanCityPostal,
    },
  };
}

export function validateProfileInput(profileData, authenticatedEmail) {
  const fullName = normalizeUserText(profileData?.fullName, 100);
  const verifiedEmail = normalizeEmail(authenticatedEmail || profileData?.email);
  const phone = normalizeUserText(profileData?.phone, 24);
  const address = normalizeUserText(profileData?.address, 200);
  const city = normalizeUserText(profileData?.city, 80);
  const postalCode = normalizeUserText(profileData?.postalCode, 24);
  const country = normalizeUserText(profileData?.country, 80);
  const requestedFinish = normalizeUserText(profileData?.preferredFinish, 60);
  const preferredFinish = ALLOWED_FINISH_OPTIONS.includes(requestedFinish)
    ? requestedFinish
    : ALLOWED_FINISH_OPTIONS[0];

  if (fullName.length < 2) {
    return { ok: false, error: 'Please enter your full name.' };
  }
  if (!isValidEmail(verifiedEmail)) {
    return { ok: false, error: 'A verified Google account email is required.' };
  }
  const phoneDigits = normalizePhoneDigits(phone);
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    return { ok: false, error: 'Please enter a valid phone number (7–15 digits).' };
  }
  if (address.length < 4 || city.length < 2 || postalCode.length < 3 || country.length < 2) {
    return { ok: false, error: 'Please complete your delivery address details.' };
  }

  return {
    ok: true,
    data: {
      fullName,
      email: verifiedEmail,
      phone,
      address,
      city,
      postalCode,
      country,
      preferredFinish,
    },
  };
}

export const ALLOWED_PROOF_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const MAX_PROOF_FILE_BYTES = 5 * 1024 * 1024;

export function validateUpiPaymentProof({ utrNumber, payerUpiId, customerNote, file }) {
  const cleanUtr = String(utrNumber || '').replace(/\s+/g, '').trim().toUpperCase();
  if (!/^[A-Z0-9]{8,24}$/.test(cleanUtr)) {
    return {
      ok: false,
      error: 'Enter a valid 12-digit UTR / UPI reference number (8–24 alphanumeric characters).',
    };
  }

  const cleanVpa = String(payerUpiId || '').trim().toLowerCase();
  if (cleanVpa && !/^[a-z0-9._-]{2,64}@[a-z0-9.-]{2,32}$/.test(cleanVpa)) {
    return {
      ok: false,
      error: 'Enter a valid UPI ID (for example name@okaxis) or leave it blank.',
    };
  }

  if (file) {
    if (!ALLOWED_PROOF_MIME_TYPES.includes(file.type)) {
      return {
        ok: false,
        error: 'Payment proof screenshot must be a JPEG, PNG, or WebP image.',
      };
    }
    if (typeof file.size === 'number' && file.size > MAX_PROOF_FILE_BYTES) {
      return {
        ok: false,
        error: 'Payment proof image must be 5 MB or smaller.',
      };
    }
  }

  return {
    ok: true,
    data: {
      utrNumber: cleanUtr,
      payerUpiId: cleanVpa || null,
      customerNote: sanitizePlainText(customerNote || '', 240) || null,
    },
  };
}

export function buildSafeUpiIntentUrl({ upiId, payeeName, amount, orderNumber }) {
  const cleanPa = String(upiId || '').trim();
  const cleanPn = sanitizePlainText(payeeName || 'Luxe Store', 60) || 'Luxe Store';
  const numAmount = Number(amount);
  const cleanTn = sanitizePlainText(orderNumber || 'Luxe Store Order', 50) || 'Luxe Store Order';

  if (!/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z0-9.-]{2,32}$/.test(cleanPa)) return '';
  if (!Number.isFinite(numAmount) || numAmount <= 0) return '';

  const params = new URLSearchParams({
    pa: cleanPa,
    pn: cleanPn,
    am: numAmount.toFixed(2),
    cu: 'INR',
    tn: cleanTn,
  });
  return `upi://pay?${params.toString()}`;
}

export function isSafeAssetImageUrl(rawUrl) {
  const clean = String(rawUrl || '').trim();
  if (!clean) return true;
  if (clean.startsWith('/') && !clean.startsWith('//')) return !containsControlChar(clean);
  return /^https:\/\/[^\s<>]+$/i.test(clean);
}

export function slugifyProductName(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export const MAX_PRODUCT_IMAGES = 8;

export function validateProductInput({
  name,
  brand,
  sku,
  sellingPrice,
  originalPrice,
  stockQuantity,
  lowStockThreshold,
  shortDescription,
  fullDescription,
  mainImageUrl,
  imageUrls,
  status,
  specsText,
}) {
  const cleanName = sanitizePlainText(name, 120);
  const cleanBrand = sanitizePlainText(brand || 'Luxe Store', 60) || 'Luxe Store';
  const cleanSku = String(sku || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 40);
  const price = Number(sellingPrice);
  const hasOriginal =
    originalPrice !== '' && originalPrice !== null && originalPrice !== undefined;
  const origPrice = hasOriginal ? Number(originalPrice) : null;
  const qty =
    stockQuantity === '' || stockQuantity === null || stockQuantity === undefined
      ? 0
      : Number(stockQuantity);
  const threshold =
    lowStockThreshold === '' || lowStockThreshold === null || lowStockThreshold === undefined
      ? 3
      : Number(lowStockThreshold);
  const rawImageCandidates = Array.isArray(imageUrls)
    ? imageUrls
    : mainImageUrl
    ? [mainImageUrl]
    : [];
  const cleanedImages = [];
  const seenImages = new Set();
  for (const rawUrl of rawImageCandidates) {
    const trimmed = String(rawUrl || '').trim().slice(0, 500);
    if (!trimmed) continue;
    if (!isSafeAssetImageUrl(trimmed)) {
      return { ok: false, error: 'Every image URL must be an https:// URL or relative site path.' };
    }
    if (!seenImages.has(trimmed)) {
      seenImages.add(trimmed);
      cleanedImages.push(trimmed);
    }
  }
  if (cleanedImages.length > MAX_PRODUCT_IMAGES) {
    return { ok: false, error: `A product can have at most ${MAX_PRODUCT_IMAGES} photos.` };
  }
  const cleanImageUrl = cleanedImages[0] || '';
  const cleanStatus = status === 'inactive' ? 'inactive' : 'active';

  if (cleanName.length < 2) {
    return { ok: false, error: 'Product name must be at least 2 characters.' };
  }
  if (cleanSku.length < 2) {
    return { ok: false, error: 'SKU must contain at least 2 alphanumeric characters.' };
  }
  if (!Number.isFinite(price) || price <= 0 || price > 100000000) {
    return { ok: false, error: 'Selling price must be a valid ₹ INR amount greater than 0.' };
  }
  if (origPrice !== null && (!Number.isFinite(origPrice) || origPrice <= 0 || origPrice > 100000000)) {
    return { ok: false, error: 'Original MRP must be a valid positive number or left blank.' };
  }
  if (!Number.isInteger(qty) || qty < 0 || qty > 100000) {
    return { ok: false, error: 'Stock quantity must be a whole number between 0 and 100,000.' };
  }
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 10000) {
    return { ok: false, error: 'Low-stock threshold must be between 0 and 10,000.' };
  }

  const specs = String(specsText || '')
    .split(/\r?\n|,/)
    .map((line) => sanitizePlainText(line, 120))
    .filter(Boolean)
    .slice(0, 12);

  return {
    ok: true,
    data: {
      name: cleanName,
      brand: cleanBrand,
      sku: cleanSku,
      sellingPrice: Math.round(price * 100) / 100,
      originalPrice: origPrice !== null ? Math.round(origPrice * 100) / 100 : null,
      stockQuantity: qty,
      lowStockThreshold: threshold,
      shortDescription: sanitizePlainText(shortDescription || '', 260),
      fullDescription: sanitizePlainText(fullDescription || '', 2000),
      mainImageUrl: cleanImageUrl || null,
      imageUrls: cleanedImages,
      status: cleanStatus,
      specs,
    },
  };
}

export function validateStoreSettingsInput({
  storeName,
  upiId,
  upiDisplayName,
  upiQrImageUrl,
  upiPaymentInstructions,
}) {
  const cleanStoreName = sanitizePlainText(storeName, 80);
  const cleanUpiId = String(upiId || '').trim();
  const cleanDisplayName = sanitizePlainText(upiDisplayName || cleanStoreName, 60);
  const cleanQrUrl = String(upiQrImageUrl || '').trim().slice(0, 500);
  const cleanInstructions = sanitizePlainText(upiPaymentInstructions || '', 500);

  if (cleanStoreName.length < 2) {
    return { ok: false, error: 'Store name must be at least 2 characters.' };
  }
  if (cleanUpiId && !/^[a-zA-Z0-9._-]{2,64}@[a-zA-Z0-9.-]{2,32}$/.test(cleanUpiId)) {
    return { ok: false, error: 'Enter a valid Merchant UPI ID (for example store@ibl).' };
  }
  if (cleanQrUrl && !/^https:\/\/[^\s<>]+$/i.test(cleanQrUrl)) {
    return { ok: false, error: 'Custom QR image URL must be an https:// URL.' };
  }

  return {
    ok: true,
    data: {
      store_name: cleanStoreName,
      upi_id: cleanUpiId || null,
      upi_display_name: cleanDisplayName || cleanStoreName,
      upi_qr_image_url: cleanQrUrl || null,
      upi_payment_instructions: cleanInstructions || null,
    },
  };
}

export function csvEscapeCell(value) {
  let str = String(value ?? '').replace(/\r?\n/g, ' ');
  // Neutralize spreadsheet formula injection (=, +, -, @, tab)
  if (/^[=+\-@\t]/.test(str)) {
    str = `'${str}`;
  }
  if (/[",]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildOrdersCsv(orders = []) {
  const headers = [
    'Order Number',
    'Date',
    'Customer Name',
    'Email',
    'Phone',
    'Shipping Address',
    'Items',
    'Amount (INR)',
    'Payment Method',
    'Payment Status',
    'Delivery Status',
    'UTR / Reference',
    'Courier',
    'Tracking Number',
  ];

  const rows = (Array.isArray(orders) ? orders : []).map((order) => {
    const customer = order.customer_snapshot || {};
    const addr = order.delivery_address_snapshot || {};
    const addressLine = [
      addr.house_building,
      addr.street,
      addr.city,
      addr.state,
      addr.pin_code || addr.postal_code,
    ]
      .filter(Boolean)
      .join(', ');
    const itemsText = (order.order_items || [])
      .map((li) => `${li.product_name_snapshot || li.sku_snapshot} x${li.quantity}`)
      .join(' | ');

    return [
      order.order_number || '',
      order.created_at || '',
      customer.full_name || '',
      customer.email || '',
      customer.phone || '',
      addressLine,
      itemsText,
      order.final_amount ?? '',
      order.payment_method || '',
      order.payment_status || '',
      order.delivery_status || '',
      order.payment_reference || '',
      order.courier_partner || '',
      order.tracking_number || '',
    ]
      .map(csvEscapeCell)
      .join(',');
  });

  return [headers.map(csvEscapeCell).join(','), ...rows].join('\n');
}

export const ADMIN_INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
export const ADMIN_INACTIVITY_WARN_MS = 2 * 60 * 1000; // Warn during final 2 minutes

export function evaluateAdminLoginLockout(state, now = Date.now()) {
  const lockedUntil = Number(state?.lockedUntil || 0);
  const failures = Number(state?.failures || 0);
  if (lockedUntil > now) {
    const remainingSeconds = Math.max(1, Math.ceil((lockedUntil - now) / 1000));
    return { locked: true, remainingSeconds, failures };
  }
  return { locked: false, remainingSeconds: 0, failures };
}

export function recordAdminLoginFailure(state, now = Date.now()) {
  const prevFailures = Number(state?.failures || 0);
  const failures = prevFailures + 1;
  let cooldownMs = 0;
  if (failures === 3) {
    cooldownMs = 15 * 1000;
  } else if (failures === 4) {
    cooldownMs = 60 * 1000;
  } else if (failures >= 5) {
    cooldownMs = 5 * 60 * 1000;
  }
  return {
    failures,
    lockedUntil: cooldownMs > 0 ? now + cooldownMs : 0,
  };
}


