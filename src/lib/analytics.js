import { isSupabaseConfigured, supabase } from './supabase';

const VISITOR_STORAGE_KEY = 'luxe_visitor_id_v1';
const DEDUPE_WINDOW_MS = 10000;

let memoryVisitorId = '';
let isAdminSession = false;
const recentEventMap = new Map();
let linkedUserId = '';

export function setTrackingAdminMode(isAdmin) {
  isAdminSession = Boolean(isAdmin);
}

function generateVisitorId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(10);
      crypto.getRandomValues(bytes);
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `v_${hex}`;
    }
  } catch {
    // Fallback below
  }
  return `v_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
}

export function getOrCreateVisitorId() {
  if (memoryVisitorId) return memoryVisitorId;
  try {
    const existing = window.localStorage.getItem(VISITOR_STORAGE_KEY);
    if (existing && /^v_[a-z0-9]{8,40}$/i.test(existing)) {
      memoryVisitorId = existing;
      return existing;
    }
    const created = generateVisitorId();
    window.localStorage.setItem(VISITOR_STORAGE_KEY, created);
    memoryVisitorId = created;
    return created;
  } catch {
    memoryVisitorId = generateVisitorId();
    return memoryVisitorId;
  }
}

export function detectDeviceType() {
  if (typeof window === 'undefined') return 'desktop';
  const w = window.innerWidth || 1200;
  if (w <= 767) return 'mobile';
  if (w <= 1024) return 'tablet';
  return 'desktop';
}

export function getSafeReferrerHost() {
  try {
    if (typeof document === 'undefined' || !document.referrer) return 'direct';
    const refUrl = new URL(document.referrer);
    if (typeof window !== 'undefined' && refUrl.hostname === window.location.hostname) {
      return 'internal';
    }
    return refUrl.hostname.replace(/^www\./i, '').slice(0, 120) || 'direct';
  } catch {
    return 'direct';
  }
}

/**
 * Records a product interaction event ('product_view' | 'lookbook_focus' | 'add_to_cart' | 'checkout_start')
 * via Supabase RPC and returns the created view UUID (for dwell-time updates) or null.
 */
export async function trackProductEvent(product, eventType = 'product_view') {
  if (!isSupabaseConfigured || !supabase || isAdminSession || !product) return null;

  const productId = String(product.dbId || product.id || product.productId || '').trim();
  if (!productId) return null;

  const dedupeKey = `${eventType}:${productId}`;
  const now = Date.now();
  const prevTs = recentEventMap.get(dedupeKey) || 0;
  if (now - prevTs < DEDUPE_WINDOW_MS) {
    return null;
  }
  recentEventMap.set(dedupeKey, now);

  const visitorId = getOrCreateVisitorId();
  try {
    const { data, error } = await supabase.rpc('record_product_view', {
      p_visitor_id: visitorId,
      p_product_id: productId,
      p_product_slug: product.slug || productId,
      p_product_title: product.title || product.name || 'Untitled Timepiece',
      p_product_price: Number.isFinite(Number(product.price)) ? Number(product.price) : null,
      p_event_type: eventType,
      p_device_type: detectDeviceType(),
      p_referrer_host: getSafeReferrerHost(),
      p_page_path: typeof window !== 'undefined' ? window.location.pathname.slice(0, 200) : '/',
    });
    if (error) return null;
    return typeof data === 'string' ? data : null;
  } catch {
    return null;
  }
}

/**
 * Updates visible dwell time (seconds) for an active view row.
 */
export async function flushProductViewDuration(viewId, durationSeconds) {
  if (!isSupabaseConfigured || !supabase || isAdminSession || !viewId) return;
  const rounded = Math.max(0, Math.min(3600, Math.round(Number(durationSeconds) || 0)));
  if (rounded < 1) return;

  const visitorId = getOrCreateVisitorId();
  try {
    await supabase.rpc('update_product_view_duration', {
      p_view_id: viewId,
      p_visitor_id: visitorId,
      p_duration_seconds: rounded,
    });
  } catch {
    // Non-fatal
  }
}

/**
 * Links prior anonymous browser visits to the signed-in user once per session.
 */
export async function linkVisitorToSignedInUser(userId) {
  if (!isSupabaseConfigured || !supabase || isAdminSession || !userId) return;
  if (linkedUserId === userId) return;
  linkedUserId = userId;

  const visitorId = getOrCreateVisitorId();
  try {
    await supabase.rpc('link_visitor_to_current_user', {
      p_visitor_id: visitorId,
    });
  } catch {
    // Non-fatal
  }
}
