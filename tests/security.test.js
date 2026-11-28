import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_FINISH_OPTIONS,
  MAX_CART_DISTINCT_ITEMS,
  MAX_ITEM_QUANTITY,
  calculateAuthoritativeCartTotals,
  isSafeRoutePath,
  isValidEmail,
  normalizeUserText,
  safeJsonParse,
  sanitizeAuthUrlError,
  sanitizeCartItems,
  sanitizePlainText,
  MAX_PROOF_FILE_BYTES,
  buildOrdersCsv,
  buildSafeUpiIntentUrl,
  csvEscapeCell,
  evaluateAdminLoginLockout,
  recordAdminLoginFailure,
  validateCheckoutSubmission,
  validateInventoryAdjustment,
  validateOrderLifecycleUpdate,
  validateProductInput,
  validateProfileInput,
  validateStoreSettingsInput,
  validateUpiPaymentProof,
  withNetworkGuard,
} from '../src/lib/security.js';
import {
  DEFAULT_ADMIN_ROUTE_PATH,
  isAdminRoutePath,
  normalizeAdminRoutePath,
} from '../src/lib/adminRoute.js';
import { formatInr, STORE_CURRENCY } from '../src/lib/currency.js';
import { PRODUCTS, mapSupabaseProduct, mergeCatalogProducts } from '../src/data/catalog.js';

const sampleProduct = PRODUCTS[0];
const sampleVariant = sampleProduct.variants[0];

test('Access control & routing: blocks open redirects and dangerous schemes', () => {
  assert.equal(isSafeRoutePath('/profile'), true);
  assert.equal(isSafeRoutePath('/signin'), true);
  assert.equal(isSafeRoutePath('/product/chronograph-silver-skeleton'), true);

  assert.equal(isSafeRoutePath('//evil.com'), false);
  assert.equal(isSafeRoutePath('/\\evil.com'), false);
  assert.equal(isSafeRoutePath('https://evil.com/phish'), false);
  assert.equal(isSafeRoutePath('javascript:alert(1)'), false);
  assert.equal(isSafeRoutePath('/ok\nSet-Cookie: a=1'), false);
  assert.equal(isSafeRoutePath(null), false);
});

test('Cart tampering protection: re-hydrates prices from catalog and drops invalid items', () => {
  const tamperedStorage = [
    {
      productId: sampleProduct.id,
      variantId: sampleVariant.id,
      title: '<script>alert(1)</script>',
      price: 1, // Attempted price manipulation
      quantity: 2,
    },
    {
      productId: 'fake-product-id',
      variantId: 'fake-variant',
      price: 1,
      quantity: 3,
    },
    {
      productId: sampleProduct.id,
      variantId: sampleVariant.id,
      quantity: 500, // Exceeds MAX_ITEM_QUANTITY
    },
    {
      productId: sampleProduct.id,
      variantId: sampleVariant.id,
      quantity: -4, // Negative quantity
    },
    {
      productId: sampleProduct.id,
      variantId: sampleVariant.id,
      quantity: 1.5, // Non-integer quantity
    },
  ];

  const sanitized = sanitizeCartItems(tamperedStorage);
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].price, sampleProduct.price);
  assert.equal(sanitized[0].title, sampleProduct.title);
  assert.equal(sanitized[0].quantity, MAX_ITEM_QUANTITY);
});

test('Checkout pricing & boundary validation: rejects tampered prices and out-of-range quantities', () => {
  const valid = calculateAuthoritativeCartTotals([
    { productId: sampleProduct.id, variantId: sampleVariant.id, quantity: 2 },
  ]);
  assert.equal(valid.ok, true);
  assert.equal(valid.subtotal, sampleProduct.price * 2);
  assert.equal(valid.total, sampleProduct.price * 2);
  assert.equal(valid.itemCount, 2);

  // Price mismatch tampering rejected
  const tamperedPrice = calculateAuthoritativeCartTotals([
    { productId: sampleProduct.id, variantId: sampleVariant.id, quantity: 1, price: 10 },
  ]);
  assert.equal(tamperedPrice.ok, false);

  // Zero, negative, fractional, and over-limit quantities rejected
  for (const badQty of [0, -1, 1.5, NaN, MAX_ITEM_QUANTITY + 1]) {
    const res = calculateAuthoritativeCartTotals([
      { productId: sampleProduct.id, variantId: sampleVariant.id, quantity: badQty },
    ]);
    assert.equal(res.ok, false, `Expected quantity ${badQty} to be rejected`);
  }

  // Excessive distinct items rejected
  const tooMany = Array.from({ length: MAX_CART_DISTINCT_ITEMS + 1 }, (_, i) => ({
    productId: sampleProduct.id,
    variantId: sampleVariant.id,
    quantity: 1,
    _idx: i,
  }));
  assert.equal(calculateAuthoritativeCartTotals(tooMany).ok, false);
});

test('Checkout submission validation: enforces contact fields and catalog totals', () => {
  const validCheckout = validateCheckoutSubmission({
    items: [{ productId: sampleProduct.id, variantId: sampleVariant.id, quantity: 1 }],
    customerName: 'Alexander Vance',
    customerEmail: 'alex@example.com',
    customerPhone: '+1 212 555 0194',
    shippingAddress: '745 Fifth Avenue, Suite 1400',
    cityPostal: 'New York, 10151',
  });
  assert.equal(validCheckout.ok, true);
  assert.equal(validCheckout.quote.total, sampleProduct.price);

  const badEmail = validateCheckoutSubmission({
    items: [{ productId: sampleProduct.id, variantId: sampleVariant.id, quantity: 1 }],
    customerName: 'Alexander Vance',
    customerEmail: 'invalid-email',
    customerPhone: '+1 212 555 0194',
    shippingAddress: '745 Fifth Avenue',
    cityPostal: 'New York',
  });
  assert.equal(badEmail.ok, false);
});

test('Profile & privilege protection: pins verified email, preserves Unicode/emoji/Arabic & literal text, allowlists finish', () => {
  const res = validateProfileInput(
    {
      fullName: '  José مرحبا 🎉 <b>hi</b> ',
      email: 'attacker@evil.com',
      phone: '+91 98765 43210',
      address: '745 Fifth Avenue',
      city: 'New York',
      postalCode: '10151',
      country: 'United States',
      preferredFinish: 'Admin Secret Role',
    },
    'verified-client@gmail.com'
  );

  assert.equal(res.ok, true);
  assert.equal(res.data.email, 'verified-client@gmail.com');
  assert.equal(res.data.fullName, 'José مرحبا 🎉 <b>hi</b>');
  assert.equal(res.data.preferredFinish, ALLOWED_FINISH_OPTIONS[0]);

  // 5,000-word wall of text truncated cleanly without crashing
  const wall = 'word '.repeat(5000);
  assert.ok(normalizeUserText(wall, 100).length <= 100);

  const shortPhone = validateProfileInput(
    {
      fullName: 'Alexander Vance',
      phone: '123',
      address: '745 Fifth Avenue',
      city: 'New York',
      postalCode: '10151',
      country: 'US',
    },
    'verified-client@gmail.com'
  );
  assert.equal(shortPhone.ok, false);
});

test('XSS sanitization: strips angle brackets and control chars from URL errors & plain text', () => {
  const sanitized = sanitizeAuthUrlError('<script>alert(1)</script>\x00Invalid OAuth state');
  assert.equal(sanitized.includes('<'), false);
  assert.equal(sanitized.includes('>'), false);
  assert.equal(sanitized.includes('\x00'), false);
  assert.equal(sanitizePlainText('A'.repeat(400), 100).length, 100);
});

test('Prototype pollution & ReDoS immunity: strips __proto__/constructor and completes long inputs immediately', () => {
  const polluted = safeJsonParse('{"__proto__":{"polluted":true},"constructor":{"bad":1},"ok":42}');
  assert.equal(polluted.ok, 42);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.hasOwn(polluted, 'constructor'), false);
  assert.equal(safeJsonParse('x'.repeat(70000)), null);

  const start = performance.now();
  assert.equal(isValidEmail(`${'a'.repeat(10000)}@`), false);
  assert.equal(isValidEmail('valid.client@luxestore.com'), true);
  assert.ok(performance.now() - start < 50);
});

test('Admin operations validation: enforces inventory integer bounds & order status/URL allowlist', () => {
  assert.equal(validateInventoryAdjustment({ quantity: -1, threshold: 5 }).ok, false);
  assert.equal(validateInventoryAdjustment({ quantity: 2.5, threshold: 5 }).ok, false);
  assert.equal(validateInventoryAdjustment({ quantity: 20, threshold: 5, notes: '<script>x</script>' }).ok, true);

  assert.equal(
    validateOrderLifecycleUpdate({ status: 'hacked_status' }).ok,
    false
  );
  assert.equal(
    validateOrderLifecycleUpdate({
      status: 'shipped',
      trackingUrl: 'javascript:alert(1)',
    }).ok,
    false
  );
  assert.equal(
    validateOrderLifecycleUpdate({
      status: 'shipped',
      trackingNumber: 'AWB123',
      courierPartner: 'Sequel',
      trackingUrl: 'https://track.example.com/AWB123',
    }).ok,
    true
  );
});

test('Slow network guard: times out hung requests cleanly instead of leaving endless spinner', async () => {
  await assert.rejects(
    withNetworkGuard(() => new Promise(() => {}), 30),
    /Request timed out/
  );
  const okResult = await withNetworkGuard(Promise.resolve('done'), 100);
  assert.equal(okResult, 'done');
});

test('Currency formatting: formats prices in INR and keeps all catalog prices in ₹', () => {
  assert.equal(STORE_CURRENCY, 'INR');
  assert.equal(formatInr(14800), '₹14,800');
  assert.equal(formatInr(125000), '₹1,25,000');
  assert.equal(formatInr(14800.5), '₹14,800.50');
  assert.equal(formatInr(NaN), '₹0');
  assert.equal(
    PRODUCTS.every((product) => product.formattedPrice.startsWith('₹') && !product.formattedPrice.includes('$')),
    true
  );
});

test('UPI payment proof validation: enforces UTR format, optional VPA, and safe image MIME/size limits', () => {
  const validProof = validateUpiPaymentProof({
    utrNumber: ' 4231 9988 1234 ',
    payerUpiId: 'client.name@okaxis',
    customerNote: 'Paid via Google Pay',
    file: { type: 'image/png', size: 1024 * 512 },
  });
  assert.equal(validProof.ok, true);
  assert.equal(validProof.data.utrNumber, '423199881234');
  assert.equal(validProof.data.payerUpiId, 'client.name@okaxis');

  // Short or invalid UTR rejected
  assert.equal(validateUpiPaymentProof({ utrNumber: '12345' }).ok, false);
  assert.equal(validateUpiPaymentProof({ utrNumber: 'UTR-<script>' }).ok, false);

  // Invalid VPA rejected
  assert.equal(
    validateUpiPaymentProof({ utrNumber: '423199881234', payerUpiId: 'not-a-upi-id' }).ok,
    false
  );

  // Disallowed file types (SVG / PDF) and oversized files rejected
  assert.equal(
    validateUpiPaymentProof({
      utrNumber: '423199881234',
      file: { type: 'image/svg+xml', size: 1024 },
    }).ok,
    false
  );
  assert.equal(
    validateUpiPaymentProof({
      utrNumber: '423199881234',
      file: { type: 'application/pdf', size: 1024 },
    }).ok,
    false
  );
  assert.equal(
    validateUpiPaymentProof({
      utrNumber: '423199881234',
      file: { type: 'image/jpeg', size: MAX_PROOF_FILE_BYTES + 1 },
    }).ok,
    false
  );
});

test('UPI intent URL builder: generates strict INR upi://pay links and rejects unsafe inputs', () => {
  const url = buildSafeUpiIntentUrl({
    upiId: 'shw2100@ibl',
    payeeName: 'TIMESSELLERS',
    amount: 14800,
    orderNumber: 'LX-20261127-1234',
  });
  assert.ok(url.startsWith('upi://pay?'));
  assert.ok(url.includes('pa=shw2100%40ibl'));
  assert.ok(url.includes('am=14800.00'));
  assert.ok(url.includes('cu=INR'));
  assert.ok(url.includes('tn=LX-20261127-1234'));

  assert.equal(buildSafeUpiIntentUrl({ upiId: 'javascript:alert(1)', amount: 100 }), '');
  assert.equal(buildSafeUpiIntentUrl({ upiId: 'shw2100@ibl', amount: 0 }), '');
  assert.equal(buildSafeUpiIntentUrl({ upiId: 'shw2100@ibl', amount: -500 }), '');
});

test('Admin product validation: enforces valid INR price, SKU, stock bounds, and safe image URLs', () => {
  const valid = validateProductInput({
    name: 'Celestial Skeleton 41mm',
    brand: 'Luxe Store',
    sku: 'ls-cel-41',
    sellingPrice: 24500,
    originalPrice: 29900,
    stockQuantity: 8,
    lowStockThreshold: 2,
    mainImageUrl: 'https://example.supabase.co/storage/v1/object/public/product-images/watch.png',
    status: 'active',
    specsText: 'Movement: Automatic\nCrystal: Sapphire',
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.data.sku, 'LS-CEL-41');
  assert.equal(valid.data.sellingPrice, 24500);
  assert.equal(valid.data.specs.length, 2);

  assert.equal(
    validateProductInput({ name: 'Bad Price', sku: 'LS-1', sellingPrice: -100, stockQuantity: 1 }).ok,
    false
  );
  assert.equal(
    validateProductInput({
      name: 'XSS Img',
      sku: 'LS-2',
      sellingPrice: 12000,
      stockQuantity: 1,
      mainImageUrl: 'javascript:alert(1)',
    }).ok,
    false
  );
});

test('Admin store settings validation: enforces valid UPI VPA and HTTPS QR image URLs', () => {
  const valid = validateStoreSettingsInput({
    storeName: 'TIMESSELLERS',
    upiId: 'shw2100@ibl',
    upiDisplayName: 'TIMESSELLERS',
    upiQrImageUrl: 'https://example.supabase.co/storage/v1/object/public/store-assets/qr.png',
    upiPaymentInstructions: 'Scan QR and submit 12-digit UTR.',
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.data.upi_id, 'shw2100@ibl');

  assert.equal(
    validateStoreSettingsInput({ storeName: 'TIMESSELLERS', upiId: 'not-a-vpa' }).ok,
    false
  );
  assert.equal(
    validateStoreSettingsInput({
      storeName: 'TIMESSELLERS',
      upiId: 'shw2100@ibl',
      upiQrImageUrl: 'javascript:alert(1)',
    }).ok,
    false
  );
});

test('Orders CSV export: prevents spreadsheet formula injection and formats Indian addresses cleanly', () => {
  assert.equal(csvEscapeCell('=CMD|"/C calc"!A0'), '"\'=CMD|""/C calc""!A0"');
  assert.equal(csvEscapeCell('+919876543210'), "'+919876543210");

  const csv = buildOrdersCsv([
    {
      order_number: 'LS-20261127-ABCD',
      created_at: '2026-11-27T10:00:00Z',
      customer_snapshot: {
        full_name: '=HYPERLINK("http://evil.com","Click")',
        email: 'client@example.com',
        phone: '+91 98765 43210',
      },
      delivery_address_snapshot: {
        street: 'Linking Road, Bandra',
        city: 'Mumbai',
        state: 'Maharashtra',
        postal_code: '400050',
      },
      order_items: [{ product_name_snapshot: 'Aurelia 18K Gold', quantity: 1 }],
      final_amount: 32500,
      payment_method: 'upi',
      payment_status: 'confirmed',
      delivery_status: 'shipped',
      payment_reference: '423199881234',
      courier_partner: 'Blue Dart',
      tracking_number: 'BD123456',
    },
  ]);

  assert.ok(csv.includes('Order Number,Date,Customer Name'));
  assert.ok(csv.includes('"\'=HYPERLINK'));
  assert.ok(csv.includes('400050'));
  assert.ok(csv.includes('Aurelia 18K Gold x1'));
});

test('Live Supabase catalog mapping: maps INR prices and merges cleanly with fallback catalog', () => {
  const mapped = mapSupabaseProduct({
    id: 'db-watch-1',
    name: 'Sovereign Tourbillon Live',
    slug: 'sovereign-tourbillon-live',
    sku: 'LS-LIVE-01',
    brand: 'Luxe Atelier',
    selling_price: 45000,
    original_price: 52000,
    main_image_url: 'https://example.supabase.co/watch.png',
    status: 'active',
    categories: { name: 'Haute Horlogerie' },
    inventory: [{ available_quantity: 4, stock_status: 'in_stock' }],
  });

  assert.equal(mapped.formattedPrice, '₹45,000');
  assert.equal(mapped.formattedOriginalPrice, '₹52,000');
  assert.equal(mapped.source, 'supabase');
  assert.equal(mapped.variants[0].available, true);

  const merged = mergeCatalogProducts([
    {
      id: 'db-watch-1',
      name: 'Sovereign Tourbillon Live',
      slug: 'sovereign-tourbillon-live',
      sku: 'LS-LIVE-01',
      selling_price: 45000,
    },
  ]);
  assert.equal(merged[0].id, 'db-watch-1');
  assert.equal(merged.length, PRODUCTS.length + 1);
});

test('Randomized admin URL: blocks predictable /admin slugs and requires opaque path match', () => {
  assert.equal(normalizeAdminRoutePath('/admin'), DEFAULT_ADMIN_ROUTE_PATH);
  assert.equal(normalizeAdminRoutePath('/admin-panel'), DEFAULT_ADMIN_ROUTE_PATH);
  assert.equal(normalizeAdminRoutePath('/login'), DEFAULT_ADMIN_ROUTE_PATH);
  assert.equal(normalizeAdminRoutePath('/short'), DEFAULT_ADMIN_ROUTE_PATH);
  assert.equal(normalizeAdminRoutePath('vault-9a8b7c6d5e4f'), '/vault-9a8b7c6d5e4f');

  assert.equal(isAdminRoutePath('/admin'), false);
  assert.equal(isAdminRoutePath('/admin/orders'), false);
  assert.equal(isAdminRoutePath(DEFAULT_ADMIN_ROUTE_PATH), true);
  assert.equal(isAdminRoutePath(`${DEFAULT_ADMIN_ROUTE_PATH}/`), true);
  assert.equal(isAdminRoutePath('/vault-9a8b7c6d5e4f', '/vault-9a8b7c6d5e4f'), true);
});

test('Admin login brute-force protection: applies progressive cooldowns after 3, 4, and 5 failures', () => {
  const t0 = 1_700_000_000_000;
  let state = { failures: 0, lockedUntil: 0 };

  state = recordAdminLoginFailure(state, t0);
  assert.equal(evaluateAdminLoginLockout(state, t0).locked, false);

  state = recordAdminLoginFailure(state, t0);
  assert.equal(evaluateAdminLoginLockout(state, t0).locked, false);

  // 3rd failure -> 15s cooldown
  state = recordAdminLoginFailure(state, t0);
  assert.equal(evaluateAdminLoginLockout(state, t0).locked, true);
  assert.equal(evaluateAdminLoginLockout(state, t0).remainingSeconds, 15);

  // 4th failure -> 60s cooldown
  state = recordAdminLoginFailure(state, t0 + 20_000);
  assert.equal(evaluateAdminLoginLockout(state, t0 + 20_000).remainingSeconds, 60);

  // 5th failure -> 300s (5-minute) lockout
  state = recordAdminLoginFailure(state, t0 + 90_000);
  assert.equal(evaluateAdminLoginLockout(state, t0 + 90_000).remainingSeconds, 300);
  assert.equal(evaluateAdminLoginLockout(state, t0 + 90_000 + 301_000).locked, false);
});

test('Multi-photo product gallery: validates up to 8 safe URLs and orders primary photo first', () => {
  const valid = validateProductInput({
    name: 'Chronograph Multi-View',
    sku: 'LS-MV-01',
    sellingPrice: 19500,
    stockQuantity: 3,
    imageUrls: [
      'https://example.supabase.co/watch-front.png',
      'https://example.supabase.co/watch-back.png',
      'https://example.supabase.co/watch-front.png', // Duplicate deduped
    ],
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.data.imageUrls.length, 2);
  assert.equal(valid.data.mainImageUrl, 'https://example.supabase.co/watch-front.png');

  // Exceeding 8 photos rejected
  const tooMany = validateProductInput({
    name: 'Too Many Photos',
    sku: 'LS-MV-02',
    sellingPrice: 19500,
    stockQuantity: 3,
    imageUrls: Array.from({ length: 9 }, (_, i) => `https://example.supabase.co/p-${i}.png`),
  });
  assert.equal(tooMany.ok, false);

  // Unsafe URL in gallery rejected
  const unsafe = validateProductInput({
    name: 'Bad Gallery',
    sku: 'LS-MV-03',
    sellingPrice: 19500,
    stockQuantity: 3,
    imageUrls: ['https://example.supabase.co/ok.png', 'javascript:alert(1)'],
  });
  assert.equal(unsafe.ok, false);

  // mapSupabaseProduct sorts primary first, then display_order ascending
  const mapped = mapSupabaseProduct({
    id: 'multi-1',
    name: 'Multi View Watch',
    slug: 'multi-view-watch',
    sku: 'LS-MV-01',
    selling_price: 19500,
    main_image_url: 'https://example.supabase.co/front.png',
    product_images: [
      { image_url: 'https://example.supabase.co/clasp.png', display_order: 2, is_primary: false },
      { image_url: 'https://example.supabase.co/front.png', display_order: 1, is_primary: true },
      { image_url: 'https://example.supabase.co/side.png', display_order: 1, is_primary: false },
    ],
  });
  assert.deepEqual(mapped.images, [
    'https://example.supabase.co/front.png',
    'https://example.supabase.co/side.png',
    'https://example.supabase.co/clasp.png',
  ]);
  assert.equal(mapped.image, 'https://example.supabase.co/front.png');
});




