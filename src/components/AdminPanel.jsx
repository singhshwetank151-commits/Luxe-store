import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Lock,
  LogOut,
  Package,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth, useCatalog, useRouter } from '../context/storeHooks';
import { ADMIN_ROUTE_PATH } from '../lib/adminRoute';
import { formatInr } from '../lib/currency';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  ADMIN_INACTIVITY_TIMEOUT_MS,
  ADMIN_INACTIVITY_WARN_MS,
  ALLOWED_ORDER_STATUSES,
  buildOrdersCsv,
  evaluateAdminLoginLockout,
  recordAdminLoginFailure,
  safeJsonParse,
  savePostLoginRedirect,
  validateOrderLifecycleUpdate,
  withNetworkGuard,
} from '../lib/security';
import { AdminCatalogManager } from './admin/AdminCatalogManager';
import { AdminStoreSettings } from './admin/AdminStoreSettings';
import { AdminTrackingPanel } from './admin/AdminTrackingPanel';
import './AdminPanel.css';

const LOCKOUT_STORAGE_KEY = 'luxe_ops_auth_guard_v1';

function readLoginGuardState() {
  try {
    const raw = window.sessionStorage.getItem(LOCKOUT_STORAGE_KEY);
    if (!raw) return { failures: 0, lockedUntil: 0 };
    const parsed = safeJsonParse(raw);
    return {
      failures: Number(parsed?.failures || 0),
      lockedUntil: Number(parsed?.lockedUntil || 0),
    };
  } catch {
    return { failures: 0, lockedUntil: 0 };
  }
}

function writeLoginGuardState(state) {
  try {
    if (!state || (state.failures === 0 && state.lockedUntil === 0)) {
      window.sessionStorage.removeItem(LOCKOUT_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(LOCKOUT_STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Ignore storage restrictions
  }
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'orders', label: 'Orders', icon: ClipboardList },
  { id: 'verifications', label: 'UPI Proofs', icon: ShieldCheck },
  { id: 'tracking', label: 'Tracking', icon: Eye },
  { id: 'catalog', label: 'Products & Stock', icon: Package },
  { id: 'settings', label: 'Store & UPI', icon: Settings },
  { id: 'audit', label: 'Clients & Audit', icon: Users },
];

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function extractProofObjectPath(rawUrl) {
  if (typeof rawUrl !== 'string') return null;
  const marker = '/payment-proofs/';
  const idx = rawUrl.indexOf(marker);
  if (idx === -1) return null;
  const after = rawUrl.slice(idx + marker.length).split('?')[0];
  return after || null;
}

function formatShippingLabel(order) {
  const customer = order.customer_snapshot || {};
  const addr = order.delivery_address_snapshot || {};
  const streetLine = [addr.house_building, addr.street].filter(Boolean).join(', ');
  const cityLine = [addr.city, addr.state, addr.pin_code || addr.postal_code]
    .filter(Boolean)
    .join(', ');
  const itemsLines = (order.order_items || []).map(
    (li) => `- ${li.product_name_snapshot || li.sku_snapshot} x${li.quantity}`
  );
  return [
    `Order: ${order.order_number} (${formatInr(order.final_amount)})`,
    `Recipient: ${customer.full_name || 'Client'}`,
    customer.phone ? `Phone: ${customer.phone}` : null,
    customer.email ? `Email: ${customer.email}` : null,
    streetLine ? `Address: ${streetLine}` : null,
    cityLine ? `City/PIN: ${cityLine}` : null,
    addr.notes ? `Note: ${addr.notes}` : null,
    itemsLines.length > 0 ? `Items:\n${itemsLines.join('\n')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function OrderLifecycleEditor({ order, onUpdated, setFeedback }) {
  const [status, setStatus] = useState(order.delivery_status || 'pending_payment');
  const [trackingNumber, setTrackingNumber] = useState(order.tracking_number || '');
  const [courierPartner, setCourierPartner] = useState(order.courier_partner || '');
  const [trackingUrl, setTrackingUrl] = useState(order.tracking_url || '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const isTerminal = order.delivery_status === 'cancelled' || order.delivery_status === 'refunded';

  const applyStatusUpdate = async (targetStatus, customNote) => {
    if (!supabase || saving || isTerminal) return;
    const validated = validateOrderLifecycleUpdate({
      status: targetStatus,
      trackingNumber,
      courierPartner,
      trackingUrl,
      note: customNote ?? note,
    });
    if (!validated.ok) {
      setFeedback({ type: 'error', text: validated.error });
      return;
    }
    setSaving(true);
    try {
      const { error } = await withNetworkGuard(
        supabase.rpc('admin_update_order_lifecycle', {
          p_order_id: order.id,
          p_new_delivery_status: validated.status,
          p_tracking_number: validated.trackingNumber,
          p_courier_partner: validated.courierPartner,
          p_tracking_url: validated.trackingUrl,
          p_note: validated.note,
        }),
        15000
      );
      if (error) {
        setFeedback({ type: 'error', text: error.message });
        return;
      }
      setStatus(validated.status);
      setFeedback({
        type: 'success',
        text: `Order ${order.order_number} updated to ${validated.status}.`,
      });
      setNote('');
      onUpdated();
    } catch (err) {
      setFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Update failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    applyStatusUpdate(status);
  };

  return (
    <form className="adm-inline-form" onSubmit={handleSave}>
      {!isTerminal && (
        <div className="adm-quick-status-row">
          <span className="adm-quick-label">Quick transition:</span>
          {[
            { st: 'confirmed', label: 'Confirm' },
            { st: 'processing', label: 'Packing' },
            { st: 'shipped', label: 'Mark shipped' },
            { st: 'delivered', label: 'Mark delivered' },
          ]
            .filter((item) => item.st !== order.delivery_status)
            .map((item) => (
              <button
                key={item.st}
                type="button"
                className="adm-filter-pill"
                disabled={saving}
                onClick={() => applyStatusUpdate(item.st, `Quick update to ${item.st}`)}
              >
                {item.label}
              </button>
            ))}
        </div>
      )}

      <div className="adm-inline-grid">
        <label className="adm-field">
          <span>Delivery status</span>
          <select
            value={status}
            disabled={saving || isTerminal}
            onChange={(e) => setStatus(e.target.value)}
          >
            {ALLOWED_ORDER_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </label>
        <label className="adm-field">
          <span>Courier partner</span>
          <input
            type="text"
            placeholder="Blue Dart / Sequel"
            value={courierPartner}
            onChange={(e) => setCourierPartner(e.target.value)}
          />
        </label>
        <label className="adm-field">
          <span>Tracking number</span>
          <input
            type="text"
            placeholder="AWB-904812"
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
          />
        </label>
        <label className="adm-field">
          <span>Tracking URL (https)</span>
          <input
            type="url"
            placeholder="https://track.example.com/..."
            value={trackingUrl}
            onChange={(e) => setTrackingUrl(e.target.value)}
          />
        </label>
        <label className="adm-field adm-full-span">
          <span>Internal / audit note</span>
          <input
            type="text"
            placeholder="Reason or dispatch reference"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
      </div>
      <div className="adm-inline-actions">
        <button type="submit" className="adm-primary-btn" disabled={saving || isTerminal}>
          {saving ? 'Updating...' : isTerminal ? 'Terminal status locked' : 'Apply update'}
        </button>
      </div>
    </form>
  );
}

export function AdminPanel() {
  const {
    user,
    authLoading,
    isAuthenticated,
    isAdmin,
    signInWithAdminPassword,
    reverifyAdminSession,
    signInWithGoogle,
    signOut,
  } = useAuth();
  const { refreshCatalog } = useCatalog();
  const { navigate } = useRouter();

  // Admin Login Form & Brute-Force Guard State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginGuard, setLoginGuard] = useState(() => readLoginGuardState());
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState(() =>
    evaluateAdminLoginLockout(readLoginGuardState()).remainingSeconds
  );

  // Inactivity Auto-Lock State (15-minute idle lock)
  const [idleWarnSecondsLeft, setIdleWarnSecondsLeft] = useState(0);
  const lastActivityRef = useRef(0);
  const lastReverifyRef = useRef(0);

  // Dashboard UI State
  const [activeTab, setActiveTab] = useState('overview');
  const [salesPeriod, setSalesPeriod] = useState('daily');
  const [orderFilter, setOrderFilter] = useState('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [verifFilter, setVerifFilter] = useState('all');
  const [verifSearch, setVerifSearch] = useState('');
  const [verifRemarks, setVerifRemarks] = useState({});
  const [clientSearch, setClientSearch] = useState('');
  const [catalogFilterJump, setCatalogFilterJump] = useState('all');
  const [autoOpenCreateProduct, setAutoOpenCreateProduct] = useState(false);
  const [copiedKey, setCopiedKey] = useState('');
  const [proofLightbox, setProofLightbox] = useState(null); // { url, title, subtitle }

  // Server Data State
  const [analytics, setAnalytics] = useState(null);
  const [orders, setOrders] = useState([]);
  const [verifications, setVerifications] = useState([]);
  const [adminProducts, setAdminProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [storeSettings, setStoreSettings] = useState(null);
  const [clients, setClients] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [productViews, setProductViews] = useState([]);
  const [trackingSetupNeeded, setTrackingSetupNeeded] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const actionLockRef = useRef(new Set());

  const triggerRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  const handleCatalogMutated = useCallback(() => {
    triggerRefresh();
    refreshCatalog();
  }, [triggerRefresh, refreshCatalog]);

  // Enforce noindex + no-referrer while the private admin console is mounted
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Restricted Console';

    const robotsMeta = document.createElement('meta');
    robotsMeta.name = 'robots';
    robotsMeta.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(robotsMeta);

    const existingReferrer = document.querySelector('meta[name="referrer"]');
    const prevReferrerContent = existingReferrer?.getAttribute('content') || '';
    let injectedReferrer = null;
    if (existingReferrer) {
      existingReferrer.setAttribute('content', 'no-referrer');
    } else {
      injectedReferrer = document.createElement('meta');
      injectedReferrer.name = 'referrer';
      injectedReferrer.content = 'no-referrer';
      document.head.appendChild(injectedReferrer);
    }

    return () => {
      document.title = prevTitle;
      robotsMeta.remove();
      if (existingReferrer) {
        existingReferrer.setAttribute('content', prevReferrerContent || 'strict-origin-when-cross-origin');
      } else if (injectedReferrer) {
        injectedReferrer.remove();
      }
    };
  }, []);

  // Tick login brute-force cooldown countdown
  useEffect(() => {
    if (!loginGuard.lockedUntil || loginGuard.lockedUntil <= Date.now()) {
      setLockoutSecondsLeft(0);
      return undefined;
    }
    const tick = () => {
      const status = evaluateAdminLoginLockout(loginGuard);
      setLockoutSecondsLeft(status.remainingSeconds);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [loginGuard]);

  const handleLockSessionNow = useCallback(
    async (reason = '') => {
      await signOut();
      setIdleWarnSecondsLeft(0);
      if (reason) {
        setLoginError(reason);
      } else {
        navigate('/', { replace: true });
      }
    },
    [signOut, navigate]
  );

  // 15-minute inactivity auto-lock for authenticated admin sessions
  useEffect(() => {
    if (!isAuthenticated || !isAdmin) {
      setIdleWarnSecondsLeft(0);
      return undefined;
    }

    lastActivityRef.current = Date.now();
    const markActive = () => {
      lastActivityRef.current = Date.now();
      setIdleWarnSecondsLeft(0);
    };

    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((evt) => window.addEventListener(evt, markActive, { passive: true }));

    const intervalId = window.setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      const remainingMs = ADMIN_INACTIVITY_TIMEOUT_MS - idleMs;
      if (remainingMs <= 0) {
        handleLockSessionNow('Session locked after 15 minutes of inactivity. Sign in again.');
      } else if (remainingMs <= ADMIN_INACTIVITY_WARN_MS) {
        setIdleWarnSecondsLeft(Math.ceil(remainingMs / 1000));
      } else {
        setIdleWarnSecondsLeft(0);
      }
    }, 5000);

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, markActive));
      window.clearInterval(intervalId);
    };
  }, [isAuthenticated, isAdmin, handleLockSessionNow]);

  // Re-verify admin role live against Supabase when returning to this browser tab (max once per 60s)
  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return undefined;
    lastReverifyRef.current = Date.now();

    const onFocusOrVisible = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastReverifyRef.current < 60000) return;
      lastReverifyRef.current = Date.now();
      reverifyAdminSession();
    };

    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [isAuthenticated, isAdmin, reverifyAdminSession]);

  // Close proof screenshot lightbox on Escape
  useEffect(() => {
    if (!proofLightbox) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setProofLightbox(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [proofLightbox]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !isAuthenticated || !isAdmin) {
      return undefined;
    }

    let active = true;

    async function loadAdminConsole() {
      setLoadingData(true);
      try {
        const [
          analyticsRes,
          ordersRes,
          verifRes,
          productsRes,
          categoriesRes,
          settingsRes,
          profilesRes,
          rolesRes,
          auditRes,
          viewsRes,
        ] = await withNetworkGuard(
          Promise.all([
            supabase.rpc('admin_get_dashboard_analytics'),
            supabase
              .from('orders')
              .select(
                'id, order_number, user_id, customer_snapshot, delivery_address_snapshot, final_amount, currency, payment_method, payment_status, delivery_status, payment_reference, tracking_number, courier_partner, tracking_url, created_at, order_items(id, product_name_snapshot, sku_snapshot, quantity, total_price)'
              )
              .order('created_at', { ascending: false })
              .limit(60),
            supabase
              .from('payment_verifications')
              .select(
                'id, order_id, utr_number, payer_upi_id, proof_image_url, customer_note, verification_status, admin_remarks, submitted_at, verified_at, orders(order_number, final_amount)'
              )
              .order('submitted_at', { ascending: false })
              .limit(60),
            supabase
              .from('products')
              .select(
                'id, name, slug, sku, category_id, brand, short_description, full_description, selling_price, original_price, main_image_url, status, total_sold, created_at, categories(id, name, slug), inventory(id, available_quantity, low_stock_threshold, stock_status), product_images(id, image_url, alt_text, display_order, is_primary)'
              )
              .order('created_at', { ascending: false })
              .limit(80),
            supabase
              .from('categories')
              .select('id, name, slug, is_active')
              .order('name', { ascending: true }),
            supabase
              .from('store_settings')
              .select('id, store_name, upi_id, upi_display_name, upi_qr_image_url, upi_payment_instructions')
              .limit(1)
              .maybeSingle(),
            supabase
              .from('profiles')
              .select('id, full_name, email, phone, is_restricted, restriction_reason, created_at')
              .order('created_at', { ascending: false })
              .limit(80),
            supabase.from('user_roles').select('user_id, role'),
            supabase
              .from('admin_audit_logs')
              .select('id, admin_user_id, action, entity_type, entity_id, created_at')
              .order('created_at', { ascending: false })
              .limit(30),
            supabase
              .from('product_views')
              .select(
                'id, visitor_id, user_id, viewer_name, viewer_email, product_id, product_slug, product_title, product_price, event_type, duration_seconds, device_type, referrer_host, page_path, viewed_at'
              )
              .order('viewed_at', { ascending: false })
              .limit(500),
          ]),
          15000
        );

        if (!active) return;

        const firstErr =
          analyticsRes.error ||
          ordersRes.error ||
          verifRes.error ||
          productsRes.error ||
          profilesRes.error ||
          rolesRes.error ||
          auditRes.error;
        if (firstErr) {
          setFeedback({ type: 'error', text: firstErr.message });
        }

        if (analyticsRes.data) setAnalytics(analyticsRes.data);
        if (ordersRes.data) setOrders(ordersRes.data);
        if (verifRes.data) setVerifications(verifRes.data);
        if (productsRes.data) setAdminProducts(productsRes.data);
        if (categoriesRes.data) setCategories(categoriesRes.data);
        if (settingsRes.data) setStoreSettings(settingsRes.data);

        if (viewsRes.error) {
          setTrackingSetupNeeded(true);
          setProductViews([]);
        } else {
          setTrackingSetupNeeded(false);
          setProductViews(viewsRes.data || []);
        }

        if (profilesRes.data) {
          const roleMap = new Map();
          for (const r of rolesRes.data || []) {
            const existing = roleMap.get(r.user_id) || [];
            existing.push(r.role);
            roleMap.set(r.user_id, existing);
          }
          setClients(
            profilesRes.data.map((p) => ({
              ...p,
              roles: roleMap.get(p.id) || ['customer'],
            }))
          );
        }

        if (auditRes.data) setAuditLogs(auditRes.data);
      } catch (err) {
        if (active) {
          setFeedback({
            type: 'error',
            text: err instanceof Error ? err.message : 'Unable to load admin console data.',
          });
        }
      } finally {
        if (active) setLoadingData(false);
      }
    }

    loadAdminConsole();
    return () => {
      active = false;
    };
  }, [isAuthenticated, isAdmin, refreshTick]);

  // Actionable counts for Overview attention cards & badges
  const pendingVerificationsCount = useMemo(
    () => verifications.filter((v) => v.verification_status === 'pending').length,
    [verifications]
  );

  const ordersToShipCount = useMemo(
    () =>
      orders.filter(
        (o) =>
          o.payment_status === 'confirmed' &&
          (o.delivery_status === 'confirmed' || o.delivery_status === 'processing')
      ).length,
    [orders]
  );

  const lowStockCount = useMemo(
    () =>
      adminProducts.filter((p) => {
        const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
        const qty = Number(inv?.available_quantity ?? 0);
        const thresh = Number(inv?.low_stock_threshold ?? 3);
        return (
          inv?.stock_status === 'low_stock' ||
          inv?.stock_status === 'out_of_stock' ||
          qty <= thresh
        );
      }).length,
    [adminProducts]
  );

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return orders.filter((order) => {
      if (
        orderFilter !== 'all' &&
        order.delivery_status !== orderFilter &&
        order.payment_status !== orderFilter
      ) {
        return false;
      }
      if (!q) return true;
      const hay = `${order.order_number} ${order.customer_snapshot?.full_name || ''} ${
        order.customer_snapshot?.email || ''
      } ${order.customer_snapshot?.phone || ''} ${order.payment_reference || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [orders, orderFilter, orderSearch]);

  const filteredVerifications = useMemo(() => {
    const q = verifSearch.trim().toLowerCase();
    return verifications.filter((verif) => {
      if (verifFilter !== 'all' && verif.verification_status !== verifFilter) {
        return false;
      }
      if (!q) return true;
      const hay = `${verif.orders?.order_number || ''} ${verif.utr_number || ''} ${
        verif.payer_upi_id || ''
      } ${verif.customer_note || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [verifications, verifFilter, verifSearch]);

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => {
      const hay = `${c.full_name || ''} ${c.email || ''} ${c.phone || ''} ${c.roles.join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [clients, clientSearch]);

  const salesSeries = useMemo(() => {
    if (!analytics) return [];
    if (salesPeriod === 'weekly') return analytics.weekly_sales || [];
    if (salesPeriod === 'monthly') return analytics.monthly_sales || [];
    return analytics.daily_sales || [];
  }, [analytics, salesPeriod]);

  const maxSalesRevenue = useMemo(() => {
    const vals = salesSeries.map((pt) => Number(pt.revenue || 0));
    return Math.max(1, ...vals);
  }, [salesSeries]);

  const handleCopyText = async (key, text) => {
    try {
      await navigator.clipboard.writeText(String(text));
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(''), 1800);
    } catch {
      setFeedback({ type: 'error', text: 'Clipboard permission denied by browser.' });
    }
  };

  const handleExportOrdersCsv = () => {
    const list = activeTab === 'orders' ? filteredOrders : orders;
    if (list.length === 0) {
      setFeedback({ type: 'error', text: 'No orders available to export.' });
      return;
    }
    const csv = buildOrdersCsv(list);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `luxe-store-orders-${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setFeedback({ type: 'success', text: `Exported ${list.length} orders to CSV.` });
  };

  const handleAdminPasswordSubmit = async (e) => {
    e.preventDefault();
    if (actionLockRef.current.has('admin-login')) return;

    const currentGuard = readLoginGuardState();
    const lockCheck = evaluateAdminLoginLockout(currentGuard);
    if (lockCheck.locked) {
      setLoginGuard(currentGuard);
      setLockoutSecondsLeft(lockCheck.remainingSeconds);
      setLoginError(`Too many failed attempts. Try again in ${lockCheck.remainingSeconds}s.`);
      return;
    }

    actionLockRef.current.add('admin-login');
    setLoginError('');
    setLoginLoading(true);
    const res = await signInWithAdminPassword(loginEmail, loginPassword);
    setLoginLoading(false);
    actionLockRef.current.delete('admin-login');

    if (!res.ok) {
      const nextGuard = recordAdminLoginFailure(currentGuard);
      writeLoginGuardState(nextGuard);
      setLoginGuard(nextGuard);
      const nextLock = evaluateAdminLoginLockout(nextGuard);
      setLockoutSecondsLeft(nextLock.remainingSeconds);
      setLoginError(
        nextLock.locked
          ? `Too many failed attempts. Locked for ${nextLock.remainingSeconds}s.`
          : res.error
      );
      setLoginPassword('');
    } else {
      const cleared = { failures: 0, lockedUntil: 0 };
      writeLoginGuardState(cleared);
      setLoginGuard(cleared);
      setLockoutSecondsLeft(0);
      setLoginPassword('');
    }
  };

  const handleAdminGoogleSignIn = async () => {
    savePostLoginRedirect(ADMIN_ROUTE_PATH);
    await signInWithGoogle();
  };

  const handleVerifyDecision = async (verifId, decision) => {
    if (!supabase) return;
    const key = `verif:${verifId}`;
    if (actionLockRef.current.has(key)) return;
    actionLockRef.current.add(key);
    setBusyActionKey(key);
    try {
      const remarks = String(verifRemarks[verifId] || '').trim().slice(0, 200) || null;
      const { error } = await withNetworkGuard(
        supabase.rpc('admin_verify_upi_payment', {
          p_verification_id: verifId,
          p_decision: decision,
          p_admin_remarks: remarks,
        }),
        15000
      );
      if (error) {
        setFeedback({ type: 'error', text: error.message });
        return;
      }
      setFeedback({
        type: 'success',
        text: `Payment verification ${decision}.`,
      });
      triggerRefresh();
    } catch (err) {
      setFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Verification failed.' });
    } finally {
      actionLockRef.current.delete(key);
      setBusyActionKey('');
    }
  };

  const handlePreviewSignedProof = async (verif) => {
    if (!supabase) return;
    const objectPath = extractProofObjectPath(verif.proof_image_url);
    if (!objectPath) {
      setFeedback({ type: 'error', text: 'Unsupported storage path for payment proof.' });
      return;
    }
    const key = `proof:${verif.id}`;
    setBusyActionKey(key);
    try {
      const { data, error } = await withNetworkGuard(
        supabase.storage.from('payment-proofs').createSignedUrl(objectPath, 180),
        12000
      );
      if (error || !data?.signedUrl) {
        setFeedback({ type: 'error', text: error?.message || 'Could not generate signed proof URL.' });
        return;
      }
      setProofLightbox({
        url: data.signedUrl,
        title: `${verif.orders?.order_number || 'Order'} · UTR ${verif.utr_number}`,
        subtitle: `Amount ${formatInr(verif.orders?.final_amount)} · UPI ${verif.payer_upi_id || '—'}`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to load payment proof.',
      });
    } finally {
      setBusyActionKey('');
    }
  };

  const handleToggleUserRestriction = async (client) => {
    if (!supabase) return;
    if (client.id === user?.id) {
      setFeedback({ type: 'error', text: 'You cannot restrict your own active admin session.' });
      return;
    }
    const key = `client:${client.id}`;
    if (actionLockRef.current.has(key)) return;
    actionLockRef.current.add(key);
    setBusyActionKey(key);
    try {
      const nextRestricted = !client.is_restricted;
      const { error } = await withNetworkGuard(
        supabase
          .from('profiles')
          .update({
            is_restricted: nextRestricted,
            restriction_reason: nextRestricted ? 'Restricted via Admin Console' : null,
          })
          .eq('id', client.id),
        15000
      );
      if (error) {
        setFeedback({ type: 'error', text: error.message });
        return;
      }
      setFeedback({
        type: 'success',
        text: `${client.full_name || client.email} ${nextRestricted ? 'restricted' : 'restored'}.`,
      });
      triggerRefresh();
    } catch (err) {
      setFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Unable to update client.' });
    } finally {
      actionLockRef.current.delete(key);
      setBusyActionKey('');
    }
  };

  if (authLoading) {
    return (
      <main className="adm-page">
        <div className="adm-shell">
          <section className="adm-gate-card">
            <span className="adm-eyebrow">Luxe Store Operations</span>
            <h1 className="adm-title">Verifying admin privileges</h1>
            <p className="adm-subtitle">Checking server role and session integrity.</p>
          </section>
        </div>
      </main>
    );
  }

  // GATE 1: NOT SIGNED IN
  if (!isAuthenticated) {
    const isLockedOut = lockoutSecondsLeft > 0;
    return (
      <main className="adm-page">
        <div className="adm-shell">
          <button type="button" className="adm-back-btn" onClick={() => navigate('/')}>
            <ArrowLeft size={16} strokeWidth={1.5} />
            <span>Back to store</span>
          </button>

          <section className="adm-gate-card" aria-label="Restricted Sign In">
            <span className="adm-eyebrow">Restricted Operations</span>
            <h1 className="adm-title">Operator sign in</h1>
            <p className="adm-subtitle">
              Authorized personnel only. Sessions automatically lock after 15 minutes of inactivity.
            </p>

            {loginError && (
              <div className="adm-banner adm-banner-error" role="alert">
                {loginError}
              </div>
            )}

            <form className="adm-login-form" onSubmit={handleAdminPasswordSubmit}>
              <label className="adm-field">
                <span>Email address</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  disabled={isLockedOut || loginLoading}
                  placeholder="operator@domain.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                />
              </label>

              <label className="adm-field">
                <span>Password</span>
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  disabled={isLockedOut || loginLoading}
                  placeholder="Enter password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                />
              </label>

              <button
                type="submit"
                className="adm-primary-btn adm-full-btn"
                disabled={loginLoading || isLockedOut}
              >
                {isLockedOut
                  ? `Locked (${lockoutSecondsLeft}s)`
                  : loginLoading
                  ? 'Verifying credentials...'
                  : 'Sign in'}
              </button>
            </form>

            <div className="adm-gate-divider">
              <span>or continue with verified SSO</span>
            </div>

            <button
              type="button"
              className="adm-secondary-btn adm-full-btn"
              disabled={isLockedOut}
              onClick={handleAdminGoogleSignIn}
            >
              Continue with Google
            </button>
          </section>
        </div>
      </main>
    );
  }

  // GATE 2: SIGNED IN WITHOUT ADMIN ROLE (403 DENY-BY-DEFAULT — ZERO SCHEMA DISCLOSURE)
  if (!isAdmin) {
    return (
      <main className="adm-page">
        <div className="adm-shell">
          <button type="button" className="adm-back-btn" onClick={() => navigate('/')}>
            <ArrowLeft size={16} strokeWidth={1.5} />
            <span>Back to store</span>
          </button>

          <section className="adm-gate-card" aria-label="Access Denied">
            <div className="adm-denied-icon">
              <ShieldAlert size={28} strokeWidth={1.6} />
            </div>
            <span className="adm-eyebrow">HTTP 403 · Forbidden</span>
            <h1 className="adm-title">Access denied</h1>
            <p className="adm-subtitle">
              Your current account does not have permission to view this area.
            </p>

            <div className="adm-gate-actions">
              <button type="button" className="adm-secondary-btn" onClick={() => navigate('/')}>
                Return to storefront
              </button>
              <button
                type="button"
                className="adm-primary-btn"
                onClick={async () => {
                  await signOut();
                }}
              >
                <LogOut size={15} strokeWidth={1.6} />
                <span>Switch account</span>
              </button>
            </div>
          </section>
        </div>
      </main>
    );
  }

  // AUTHENTICATED ADMIN CONSOLE
  return (
    <main className="adm-page">
      <div className="adm-container">
        <header className="adm-header">
          <div>
            <button type="button" className="adm-back-btn" onClick={() => navigate('/collection')}>
              <ArrowLeft size={16} strokeWidth={1.5} />
              <span>Storefront</span>
            </button>
            <div className="adm-header-badges">
              <span className="adm-eyebrow">Luxe Store Operations</span>
              <span className="adm-role-badge">{user.role}</span>
            </div>
            <h1 className="adm-title">Admin console</h1>
            <p className="adm-subtitle">Signed in as {user.email}</p>
          </div>

          <div className="adm-header-actions">
            <button
              type="button"
              className="adm-secondary-btn"
              disabled={loadingData}
              onClick={triggerRefresh}
            >
              <RefreshCw size={16} strokeWidth={1.5} className={loadingData ? 'adm-spin' : ''} />
              <span>{loadingData ? 'Refreshing...' : 'Refresh'}</span>
            </button>
            <button
              type="button"
              className="adm-secondary-btn"
              onClick={() => handleLockSessionNow('Console locked manually.')}
            >
              <Lock size={16} strokeWidth={1.5} />
              <span>Lock now</span>
            </button>
            <button
              type="button"
              className="adm-secondary-btn"
              onClick={async () => {
                await signOut();
                navigate('/', { replace: true });
              }}
            >
              <LogOut size={16} strokeWidth={1.5} />
              <span>Sign out</span>
            </button>
          </div>
        </header>

        {idleWarnSecondsLeft > 0 && (
          <div className="adm-banner adm-banner-error" role="alert">
            <span>
              Inactivity auto-lock in {idleWarnSecondsLeft}s. Interact or click Stay signed in to keep working.
            </span>
            <button
              type="button"
              className="adm-secondary-btn"
              onClick={() => {
                lastActivityRef.current = Date.now();
                setIdleWarnSecondsLeft(0);
              }}
            >
              Stay signed in
            </button>
          </div>
        )}

        {feedback && (
          <div
            className={`adm-banner ${
              feedback.type === 'error' ? 'adm-banner-error' : 'adm-banner-success'
            }`}
            role={feedback.type === 'error' ? 'alert' : 'status'}
          >
            <span>{feedback.text}</span>
            <button
              type="button"
              className="adm-banner-close"
              aria-label="Dismiss notification"
              onClick={() => setFeedback(null)}
            >
              ×
            </button>
          </div>
        )}

        <nav className="adm-tabs" aria-label="Admin sections">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const badgeCount =
              tab.id === 'verifications'
                ? pendingVerificationsCount
                : tab.id === 'orders'
                ? ordersToShipCount
                : tab.id === 'catalog'
                ? lowStockCount
                : 0;
            return (
              <button
                key={tab.id}
                type="button"
                className={`adm-tab-btn ${activeTab === tab.id ? 'is-active' : ''}`}
                onClick={() => {
                  setAutoOpenCreateProduct(false);
                  setActiveTab(tab.id);
                }}
              >
                <Icon size={16} strokeWidth={1.5} />
                <span>{tab.label}</span>
                {badgeCount > 0 && <span className="adm-tab-count">{badgeCount}</span>}
              </button>
            );
          })}
        </nav>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <section className="adm-section" aria-label="Analytics Overview">
            {/* Actionable Attention Queue */}
            {(pendingVerificationsCount > 0 || ordersToShipCount > 0 || lowStockCount > 0) && (
              <div className="adm-attention-grid">
                {pendingVerificationsCount > 0 && (
                  <button
                    type="button"
                    className="adm-attention-card is-warn"
                    onClick={() => {
                      setVerifFilter('pending');
                      setActiveTab('verifications');
                    }}
                  >
                    <ShieldCheck size={18} strokeWidth={1.5} />
                    <div>
                      <strong>{pendingVerificationsCount} UPI proof{pendingVerificationsCount === 1 ? '' : 's'} pending</strong>
                      <span>Review UTR & approve settlement</span>
                    </div>
                    <ArrowRight size={16} strokeWidth={1.5} />
                  </button>
                )}

                {ordersToShipCount > 0 && (
                  <button
                    type="button"
                    className="adm-attention-card"
                    onClick={() => {
                      setOrderFilter('confirmed');
                      setActiveTab('orders');
                    }}
                  >
                    <ClipboardList size={18} strokeWidth={1.5} />
                    <div>
                      <strong>{ordersToShipCount} paid order{ordersToShipCount === 1 ? '' : 's'} ready to ship</strong>
                      <span>Add courier AWB & mark shipped</span>
                    </div>
                    <ArrowRight size={16} strokeWidth={1.5} />
                  </button>
                )}

                {lowStockCount > 0 && (
                  <button
                    type="button"
                    className="adm-attention-card is-danger"
                    onClick={() => {
                      setAutoOpenCreateProduct(false);
                      setCatalogFilterJump('low_stock');
                      setActiveTab('catalog');
                    }}
                  >
                    <AlertTriangle size={18} strokeWidth={1.5} />
                    <div>
                      <strong>{lowStockCount} watch{lowStockCount === 1 ? '' : 'es'} low or out of stock</strong>
                      <span>Restock inventory quantities</span>
                    </div>
                    <ArrowRight size={16} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            )}

            {/* Quick Action Bar */}
            <div className="adm-quick-bar">
              <button
                type="button"
                className="adm-primary-btn"
                onClick={() => {
                  setCatalogFilterJump('all');
                  setAutoOpenCreateProduct(true);
                  setActiveTab('catalog');
                }}
              >
                <Plus size={16} strokeWidth={1.5} />
                <span>Add timepiece</span>
              </button>
              <button
                type="button"
                className="adm-secondary-btn"
                onClick={() => setActiveTab('settings')}
              >
                <Settings size={16} strokeWidth={1.5} />
                <span>Edit UPI & store settings</span>
              </button>
              <button
                type="button"
                className="adm-secondary-btn"
                onClick={handleExportOrdersCsv}
              >
                <Download size={16} strokeWidth={1.5} />
                <span>Export orders CSV</span>
              </button>
            </div>

            <div className="adm-kpi-grid">
              <article className="adm-kpi-card">
                <span>Confirmed revenue</span>
                <strong>{formatInr(analytics?.total_revenue)}</strong>
                <small>Today: {formatInr(analytics?.today_revenue)}</small>
              </article>
              <article className="adm-kpi-card">
                <span>Total orders</span>
                <strong>{analytics?.total_orders ?? orders.length}</strong>
                <small>
                  Pending: {analytics?.pending_orders ?? 0} · Delivered: {analytics?.delivered_orders ?? 0}
                </small>
              </article>
              <article className="adm-kpi-card">
                <span>Catalog watches</span>
                <strong>{analytics?.total_products ?? adminProducts.length}</strong>
                <small>Low/out of stock: {lowStockCount}</small>
              </article>
              <article className="adm-kpi-card">
                <span>Registered clients</span>
                <strong>{analytics?.total_customers ?? clients.length}</strong>
                <small>Ready to dispatch: {ordersToShipCount}</small>
              </article>
            </div>

            <div className="adm-split-grid">
              <div className="adm-panel">
                <div className="adm-panel-head">
                  <h2>Revenue trend</h2>
                  <div className="adm-period-switch">
                    {['daily', 'weekly', 'monthly'].map((p) => (
                      <button
                        key={p}
                        type="button"
                        className={salesPeriod === p ? 'is-active' : ''}
                        onClick={() => setSalesPeriod(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="adm-bars">
                  {salesSeries.map((pt) => {
                    const rev = Number(pt.revenue || 0);
                    const pct = Math.max(2, Math.round((rev / maxSalesRevenue) * 100));
                    return (
                      <div key={pt.period_key} className="adm-bar-row">
                        <span className="adm-bar-label">{pt.label}</span>
                        <div className="adm-bar-track">
                          <div className="adm-bar-fill" style={{ width: `${rev > 0 ? pct : 0}%` }} />
                        </div>
                        <span className="adm-bar-val">
                          {formatInr(rev)} ({pt.orders_count || 0})
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="adm-panel">
                <div className="adm-panel-head">
                  <h2>Top timepieces</h2>
                </div>
                <div className="adm-compact-list">
                  {(analytics?.best_sellers || []).map((item) => (
                    <div key={item.id} className="adm-compact-row">
                      <div>
                        <strong>{item.name}</strong>
                        <small>SKU {item.sku} · {item.total_sold} sold</small>
                      </div>
                      <span className="adm-tabular">{formatInr(item.total_revenue)}</span>
                    </div>
                  ))}
                  {(!analytics?.best_sellers || analytics.best_sellers.length === 0) && (
                    <p className="adm-empty">No sales records yet.</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* TAB 2: ORDERS */}
        {activeTab === 'orders' && (
          <section className="adm-section" aria-label="Orders Management">
            <div className="adm-toolbar">
              <div className="adm-search-wrap">
                <Search size={15} strokeWidth={1.5} />
                <input
                  type="search"
                  className="adm-search"
                  placeholder="Search order #, client name, email, phone, or UTR..."
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                />
              </div>
              <select
                className="adm-select"
                value={orderFilter}
                onChange={(e) => setOrderFilter(e.target.value)}
              >
                <option value="all">All statuses ({orders.length})</option>
                {ALLOWED_ORDER_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="adm-secondary-btn"
                onClick={handleExportOrdersCsv}
              >
                <Download size={15} strokeWidth={1.5} />
                <span>Export CSV ({filteredOrders.length})</span>
              </button>
            </div>

            <div className="adm-stack">
              {filteredOrders.map((order) => {
                const isExpanded = expandedOrderId === order.id;
                const customer = order.customer_snapshot || {};
                const addr = order.delivery_address_snapshot || {};
                const pin = addr.pin_code || addr.postal_code || '';
                const labelKey = `label:${order.id}`;
                return (
                  <article key={order.id} className="adm-list-card">
                    <div className="adm-list-card-top">
                      <div>
                        <div className="adm-row-title">
                          {order.order_number} · {formatInr(order.final_amount)}
                        </div>
                        <div className="adm-row-meta">
                          {customer.full_name || 'Client'}
                          {customer.email ? ` · ${customer.email}` : ''} · {customer.phone || '—'} ·{' '}
                          {order.payment_method} · {formatDate(order.created_at)}
                        </div>
                        <div className="adm-pill-row">
                          <span className={`adm-pill adm-pill-${order.payment_status}`}>
                            payment: {order.payment_status}
                          </span>
                          <span className={`adm-pill adm-pill-${order.delivery_status}`}>
                            delivery: {order.delivery_status}
                          </span>
                          {order.payment_reference && (
                            <span className="adm-pill">ref: {order.payment_reference}</span>
                          )}
                          {order.tracking_number && (
                            <span className="adm-pill">AWB: {order.tracking_number}</span>
                          )}
                        </div>
                      </div>

                      <div className="adm-card-actions">
                        <button
                          type="button"
                          className="adm-secondary-btn"
                          onClick={() => handleCopyText(labelKey, formatShippingLabel(order))}
                        >
                          {copiedKey === labelKey ? (
                            <>
                              <Check size={14} strokeWidth={1.5} />
                              <span>Copied label</span>
                            </>
                          ) : (
                            <>
                              <Copy size={14} strokeWidth={1.5} />
                              <span>Copy label</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          className="adm-secondary-btn"
                          onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                        >
                          {isExpanded ? 'Close' : 'Manage order'}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="adm-expanded">
                        <div className="adm-order-meta-grid">
                          <div>
                            <small>Delivery address</small>
                            <p>
                              {addr.house_building ? `${addr.house_building}, ` : ''}
                              {addr.street || '—'}, {addr.city || ''} {addr.state || ''} {pin}
                            </p>
                            {addr.notes && (
                              <p className="adm-note-copy">Delivery note: {addr.notes}</p>
                            )}
                          </div>
                          <div>
                            <small>Line items</small>
                            <ul>
                              {(order.order_items || []).map((li) => (
                                <li key={li.id}>
                                  {li.product_name_snapshot} ({li.sku_snapshot}) × {li.quantity} —{' '}
                                  {formatInr(li.total_price)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        <OrderLifecycleEditor
                          key={`${order.id}-${order.delivery_status}`}
                          order={order}
                          onUpdated={triggerRefresh}
                          setFeedback={setFeedback}
                        />
                      </div>
                    )}
                  </article>
                );
              })}

              {filteredOrders.length === 0 && <p className="adm-empty">No matching orders found.</p>}
            </div>
          </section>
        )}

        {/* TAB 3: UPI VERIFICATIONS */}
        {activeTab === 'verifications' && (
          <section className="adm-section" aria-label="UPI Payment Verifications">
            <div className="adm-toolbar">
              <div className="adm-search-wrap">
                <Search size={15} strokeWidth={1.5} />
                <input
                  type="search"
                  className="adm-search"
                  placeholder="Search UTR, order number, or payer UPI ID..."
                  value={verifSearch}
                  onChange={(e) => setVerifSearch(e.target.value)}
                />
              </div>
              <div className="adm-filter-pills" role="tablist" aria-label="Verification status filters">
                {[
                  { id: 'all', label: `All (${verifications.length})` },
                  { id: 'pending', label: `Pending (${pendingVerificationsCount})` },
                  { id: 'approved', label: 'Approved' },
                  { id: 'rejected', label: 'Rejected' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={verifFilter === item.id}
                    className={`adm-filter-pill ${verifFilter === item.id ? 'is-active' : ''}`}
                    onClick={() => setVerifFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="adm-stack">
              {filteredVerifications.map((verif) => {
                const isPending = verif.verification_status === 'pending';
                const utrCopyKey = `utr:${verif.id}`;
                return (
                  <article key={verif.id} className="adm-list-card">
                    <div className="adm-list-card-top">
                      <div>
                        <div className="adm-row-title">
                          {verif.orders?.order_number || verif.order_id} · UTR {verif.utr_number}
                        </div>
                        <div className="adm-row-meta">
                          Amount: {formatInr(verif.orders?.final_amount)} · UPI ID:{' '}
                          {verif.payer_upi_id || 'Not provided'} · Submitted{' '}
                          {formatDate(verif.submitted_at)}
                        </div>
                        {verif.customer_note && (
                          <p className="adm-note-copy">Note: {verif.customer_note}</p>
                        )}
                      </div>
                      <div className="adm-verif-right">
                        <span className={`adm-pill adm-pill-${verif.verification_status}`}>
                          {verif.verification_status}
                        </span>
                        <button
                          type="button"
                          className="adm-secondary-btn"
                          onClick={() => handleCopyText(utrCopyKey, verif.utr_number)}
                        >
                          {copiedKey === utrCopyKey ? (
                            <>
                              <Check size={14} strokeWidth={1.5} />
                              <span>Copied UTR</span>
                            </>
                          ) : (
                            <>
                              <Copy size={14} strokeWidth={1.5} />
                              <span>Copy UTR</span>
                            </>
                          )}
                        </button>
                        {verif.proof_image_url && (
                          <button
                            type="button"
                            className="adm-secondary-btn"
                            disabled={busyActionKey === `proof:${verif.id}`}
                            onClick={() => handlePreviewSignedProof(verif)}
                          >
                            <Eye size={14} strokeWidth={1.5} />
                            <span>
                              {busyActionKey === `proof:${verif.id}` ? 'Loading...' : 'Preview proof'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>

                    {isPending ? (
                      <div className="adm-verif-actions">
                        <input
                          type="text"
                          maxLength={200}
                          dir="auto"
                          placeholder="Treasury remarks (optional)"
                          value={verifRemarks[verif.id] || ''}
                          onChange={(e) =>
                            setVerifRemarks((prev) => ({ ...prev, [verif.id]: e.target.value }))
                          }
                        />
                        <button
                          type="button"
                          className="adm-primary-btn"
                          disabled={busyActionKey === `verif:${verif.id}`}
                          onClick={() => handleVerifyDecision(verif.id, 'approved')}
                        >
                          <CheckCircle2 size={15} />
                          <span>Approve</span>
                        </button>
                        <button
                          type="button"
                          className="adm-secondary-btn"
                          disabled={busyActionKey === `verif:${verif.id}`}
                          onClick={() => handleVerifyDecision(verif.id, 'rejected')}
                        >
                          <XCircle size={15} />
                          <span>Reject</span>
                        </button>
                      </div>
                    ) : (
                      verif.admin_remarks && (
                        <p className="adm-note-copy">Admin remarks: {verif.admin_remarks}</p>
                      )
                    )}
                  </article>
                );
              })}

              {filteredVerifications.length === 0 && (
                <p className="adm-empty">No UPI payment proofs match this filter.</p>
              )}
            </div>
          </section>
        )}

        {/* TAB 4: VISITOR & PRODUCT TRACKING */}
        {activeTab === 'tracking' && (
          <AdminTrackingPanel
            views={productViews}
            clients={clients}
            setupRequired={trackingSetupNeeded}
            setFeedback={setFeedback}
          />
        )}

        {/* TAB 5: PRODUCTS & STOCK */}
        {activeTab === 'catalog' && (
          <AdminCatalogManager
            key={`catalog-${catalogFilterJump}-${autoOpenCreateProduct ? 'new' : 'list'}`}
            products={adminProducts}
            categories={categories}
            initialFilter={catalogFilterJump}
            autoOpenCreate={autoOpenCreateProduct}
            onUpdated={handleCatalogMutated}
            setFeedback={setFeedback}
          />
        )}

        {/* TAB 5: STORE & UPI SETTINGS */}
        {activeTab === 'settings' && (
          <AdminStoreSettings
            key={storeSettings?.id || 'default-settings'}
            settings={storeSettings}
            onUpdated={triggerRefresh}
            setFeedback={setFeedback}
          />
        )}

        {/* TAB 6: CLIENTS & AUDIT LOGS */}
        {activeTab === 'audit' && (
          <section className="adm-section" aria-label="Clients and Audit Logs">
            <div className="adm-split-grid">
              <div className="adm-panel">
                <div className="adm-panel-head">
                  <h2>Clients & roles ({filteredClients.length})</h2>
                </div>
                <div className="adm-toolbar">
                  <div className="adm-search-wrap">
                    <Search size={15} strokeWidth={1.5} />
                    <input
                      type="search"
                      className="adm-search"
                      placeholder="Filter by name, email, or phone..."
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="adm-compact-list">
                  {filteredClients.map((client) => (
                    <div key={client.id} className="adm-compact-row">
                      <div>
                        <strong>{client.full_name || 'Unnamed client'}</strong>
                        <small>
                          {client.email || 'No email'}
                          {client.phone ? ` · ${client.phone}` : ''} · {client.roles.join(', ')}
                          {client.is_restricted ? ' · RESTRICTED' : ''}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="adm-secondary-btn"
                        disabled={client.id === user.id || busyActionKey === `client:${client.id}`}
                        onClick={() => handleToggleUserRestriction(client)}
                      >
                        {client.is_restricted ? 'Restore' : 'Restrict'}
                      </button>
                    </div>
                  ))}
                  {filteredClients.length === 0 && (
                    <p className="adm-empty">No matching clients found.</p>
                  )}
                </div>
              </div>

              <div className="adm-panel">
                <div className="adm-panel-head">
                  <h2>Immutable audit log</h2>
                </div>
                <div className="adm-compact-list">
                  {auditLogs.map((log) => (
                    <div key={log.id} className="adm-compact-row">
                      <div>
                        <strong>{log.action}</strong>
                        <small>
                          {log.entity_type} {log.entity_id || ''}
                        </small>
                      </div>
                      <span className="adm-tabular">{formatDate(log.created_at)}</span>
                    </div>
                  ))}
                  {auditLogs.length === 0 && <p className="adm-empty">No audit events recorded.</p>}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Inline UPI Payment Proof Screenshot Lightbox */}
      {proofLightbox && (
        <div
          className="adm-lightbox-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="UPI Payment Screenshot Preview"
          onClick={() => setProofLightbox(null)}
        >
          <div className="adm-lightbox-card" onClick={(e) => e.stopPropagation()}>
            <div className="adm-lightbox-head">
              <div>
                <strong>{proofLightbox.title}</strong>
                <small>{proofLightbox.subtitle}</small>
              </div>
              <div className="adm-card-actions">
                <a
                  href={proofLightbox.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="adm-secondary-btn"
                >
                  <ExternalLink size={14} strokeWidth={1.5} />
                  <span>Open full image</span>
                </a>
                <button
                  type="button"
                  className="adm-secondary-btn"
                  aria-label="Close preview"
                  onClick={() => setProofLightbox(null)}
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              </div>
            </div>
            <div className="adm-lightbox-body">
              <img src={proofLightbox.url} alt={proofLightbox.title} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
