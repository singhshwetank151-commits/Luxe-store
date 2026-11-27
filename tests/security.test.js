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
  validateCheckoutSubmission,
  validateInventoryAdjustment,
  validateOrderLifecycleUpdate,
  validateProfileInput,
  withNetworkGuard,
} from '../src/lib/security.js';
import { PRODUCTS } from '../src/data/catalog.js';

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
