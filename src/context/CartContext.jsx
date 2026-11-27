import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDefaultVariant, getProductById } from '../data/catalog';
import { CartContext, useAuth } from './storeHooks';
import {
  calculateAuthoritativeCartTotals,
  MAX_CART_DISTINCT_ITEMS,
  MAX_ITEM_QUANTITY,
  safeJsonParse,
  sanitizeCartItems,
} from '../lib/security';

const BASE_STORAGE_KEY = 'luxe_store_cart_v1';

function loadStoredCart(storageKey) {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = safeJsonParse(raw);
    return sanitizeCartItems(parsed);
  } catch {
    return [];
  }
}

function ScopedCartProvider({ storageKey, children }) {
  const [items, setItems] = useState(() => loadStoredCart(storageKey));
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [drawerView, setDrawerView] = useState('cart');

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(items));
    } catch {
      // Ignore storage quota errors in restricted environments
    }
  }, [storageKey, items]);

  const addToCart = useCallback((productId, variantId) => {
    try {
      const product = getProductById(productId);
      if (!product) {
        return { ok: false, error: 'Product not found in catalog.' };
      }

      const variant =
        (variantId && product.variants?.find((v) => v.id === variantId && v.available !== false)) ||
        getDefaultVariant(product);

      if (!variant || variant.available === false) {
        return { ok: false, error: 'No available variant for this product.' };
      }

      let limitError = '';
      setItems((prev) => {
        const idx = prev.findIndex(
          (entry) => entry.productId === product.id && entry.variantId === variant.id
        );
        if (idx >= 0) {
          if (prev[idx].quantity >= MAX_ITEM_QUANTITY) {
            limitError = `Maximum ${MAX_ITEM_QUANTITY} units allowed per timepiece.`;
            return prev;
          }
          const next = [...prev];
          next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
          return next;
        }
        if (prev.length >= MAX_CART_DISTINCT_ITEMS) {
          limitError = `Basket limit of ${MAX_CART_DISTINCT_ITEMS} distinct items reached.`;
          return prev;
        }
        return [
          ...prev,
          {
            productId: product.id,
            variantId: variant.id,
            variantLabel: variant.label,
            title: product.title,
            price: product.price,
            formattedPrice: product.formattedPrice,
            image: product.image,
            quantity: 1,
          },
        ];
      });

      if (limitError) {
        return { ok: false, error: limitError };
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Unable to add item to cart.' };
    }
  }, []);

  const updateQuantity = useCallback((productId, variantId, delta) => {
    if (!Number.isInteger(delta) || delta === 0) return;

    setItems((prev) =>
      prev
        .map((entry) => {
          if (entry.productId !== productId || entry.variantId !== variantId) return entry;
          const nextQty = Math.min(MAX_ITEM_QUANTITY, entry.quantity + delta);
          return { ...entry, quantity: nextQty };
        })
        .filter((entry) => Number.isInteger(entry.quantity) && entry.quantity > 0)
    );
  }, []);

  const removeFromCart = useCallback((productId, variantId) => {
    setItems((prev) =>
      prev.filter((entry) => !(entry.productId === productId && entry.variantId === variantId))
    );
  }, []);

  const clearCart = useCallback(() => setItems([]), []);

  const authoritativeTotals = useMemo(() => {
    if (items.length === 0) {
      return { subtotal: 0, itemCount: 0, items: [] };
    }
    const quote = calculateAuthoritativeCartTotals(items);
    if (!quote.ok) {
      const clean = sanitizeCartItems(items);
      return {
        subtotal: clean.reduce((sum, item) => sum + item.price * item.quantity, 0),
        itemCount: clean.reduce((sum, item) => sum + item.quantity, 0),
        items: clean,
      };
    }
    return {
      subtotal: quote.subtotal,
      itemCount: quote.itemCount,
      items: quote.items,
    };
  }, [items]);

  const cartCount = authoritativeTotals.itemCount;
  const subtotal = authoritativeTotals.subtotal;

  const openCart = useCallback(() => {
    setDrawerView('cart');
    setIsCartOpen(true);
  }, []);

  const openCheckout = useCallback(() => {
    setDrawerView('checkout');
    setIsCartOpen(true);
  }, []);

  const closeCart = useCallback(() => {
    setIsCartOpen(false);
    setDrawerView('cart');
  }, []);

  const value = useMemo(
    () => ({
      items: authoritativeTotals.items,
      cartCount,
      subtotal,
      isCartOpen,
      drawerView,
      setDrawerView,
      openCart,
      openCheckout,
      closeCart,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
    }),
    [
      authoritativeTotals.items,
      cartCount,
      subtotal,
      isCartOpen,
      drawerView,
      openCart,
      openCheckout,
      closeCart,
      addToCart,
      updateQuantity,
      removeFromCart,
      clearCart,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function CartProvider({ children }) {
  const { user } = useAuth();
  const storageKey = `${BASE_STORAGE_KEY}:${user?.id || 'guest'}`;

  // Keying by user?.id isolates carts immediately across account switches & sign-outs
  return (
    <ScopedCartProvider key={storageKey} storageKey={storageKey}>
      {children}
    </ScopedCartProvider>
  );
}
