import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  LogOut,
  Package,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react';
import { useAuth, useRouter } from '../context/storeHooks';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import {
  ALLOWED_ORDER_STATUSES,
  validateInventoryAdjustment,
  validateOrderLifecycleUpdate,
  withNetworkGuard,
} from '../lib/security';
import './AdminPanel.css';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'orders', label: 'Orders', icon: ClipboardList },
  { id: 'verifications', label: 'UPI Proofs', icon: ShieldCheck },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'audit', label: 'Clients & Audit', icon: Users },
];

function formatInr(value) {
  const num = Number(value || 0);
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

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

function OrderLifecycleEditor({ order, onUpdated, setFeedback }) {
  const [status, setStatus] = useState(order.delivery_status || 'pending_payment');
  const [trackingNumber, setTrackingNumber] = useState(order.tracking_number || '');
  const [courierPartner, setCourierPartner] = useState(order.courier_partner || '');
  const [trackingUrl, setTrackingUrl] = useState(order.tracking_url || '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const isTerminal = order.delivery_status === 'cancelled' || order.delivery_status === 'refunded';

  const handleSave = async (e) => {
    e.preventDefault();
    if (!supabase) return;
    const validated = validateOrderLifecycleUpdate({
      status,
      trackingNumber,
      courierPartner,
      trackingUrl,
      note,
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
      setFeedback({ type: 'success', text: `Order ${order.order_number} updated to ${validated.status}.` });
      setNote('');
      onUpdated();
    } catch (err) {
      setFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Update failed.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="adm-inline-form" onSubmit={handleSave}>
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

function InventoryAdjustRow({ row, onUpdated, setFeedback }) {
  const [qty, setQty] = useState(String(row.available_quantity ?? 0));
  const [threshold, setThreshold] = useState(String(row.low_stock_threshold ?? 5));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdjust = async (e) => {
    e.preventDefault();
    if (!supabase) return;
    const validated = validateInventoryAdjustment({
      quantity: qty,
      threshold,
      notes,
    });
    if (!validated.ok) {
      setFeedback({ type: 'error', text: validated.error });
      return;
    }

    setSaving(true);
    try {
      const { error } = await withNetworkGuard(
        supabase.rpc('admin_adjust_inventory', {
          p_product_id: row.product_id,
          p_new_quantity: validated.quantity,
          p_low_stock_threshold: validated.threshold,
          p_notes: validated.notes,
        }),
        15000
      );

      if (error) {
        setFeedback({ type: 'error', text: error.message });
        return;
      }

      setNotes('');
      setFeedback({
        type: 'success',
        text: `Stock for ${row.products?.name || row.sku} updated to ${validated.quantity}.`,
      });
      onUpdated();
    } catch (err) {
      setFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Stock adjustment failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleProductStatus = async () => {
    if (!supabase || !row.products) return;
    const nextStatus = row.products.status === 'active' ? 'inactive' : 'active';
    try {
      const { error } = await withNetworkGuard(
        supabase.from('products').update({ status: nextStatus }).eq('id', row.product_id),
        15000
      );
      if (error) {
        setFeedback({ type: 'error', text: error.message });
        return;
      }
      setFeedback({
        type: 'success',
        text: `${row.products.name} marked ${nextStatus}.`,
      });
      onUpdated();
    } catch (err) {
      setFeedback({ type: 'error', text: err instanceof Error ? err.message : 'Unable to update product.' });
    }
  };

  return (
    <div className="adm-list-card">
      <div className="adm-list-card-top">
        <div>
          <div className="adm-row-title">{row.products?.name || 'Untitled Watch'}</div>
          <div className="adm-row-meta">
            SKU {row.sku} · {formatInr(row.products?.selling_price)} ·{' '}
            <span className={`adm-pill adm-pill-${row.stock_status}`}>{row.stock_status}</span> ·{' '}
            <span className={`adm-pill adm-pill-${row.products?.status}`}>
              {row.products?.status || 'active'}
            </span>
          </div>
        </div>
        <button type="button" className="adm-secondary-btn" onClick={handleToggleProductStatus}>
          {row.products?.status === 'active' ? 'Set inactive' : 'Set active'}
        </button>
      </div>

      <form className="adm-stock-form" onSubmit={handleAdjust}>
        <label className="adm-field">
          <span>Available qty</span>
          <input
            type="number"
            min={0}
            max={100000}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </label>
        <label className="adm-field">
          <span>Low threshold</span>
          <input
            type="number"
            min={0}
            max={10000}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </label>
        <label className="adm-field adm-stock-notes">
          <span>Adjustment note</span>
          <input
            type="text"
            placeholder="Restock or physical count"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <button type="submit" className="adm-primary-btn" disabled={saving}>
          {saving ? 'Saving...' : 'Save stock'}
        </button>
      </form>
    </div>
  );
}

export function AdminPanel() {
  const {
    user,
    authLoading,
    isAuthenticated,
    isAdmin,
    signInWithAdminPassword,
    signInWithGoogle,
    signOut,
  } = useAuth();
  const { navigate } = useRouter();

  // Admin Login Form State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Dashboard State
  const [activeTab, setActiveTab] = useState('overview');
  const [salesPeriod, setSalesPeriod] = useState('daily');
  const [orderFilter, setOrderFilter] = useState('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [verifRemarks, setVerifRemarks] = useState({});

  const [analytics, setAnalytics] = useState(null);
  const [orders, setOrders] = useState([]);
  const [verifications, setVerifications] = useState([]);
  const [inventoryRows, setInventoryRows] = useState([]);
  const [clients, setClients] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState('');
  const [feedback, setFeedback] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const actionLockRef = useRef(new Set());

  const triggerRefresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

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
          invRes,
          profilesRes,
          rolesRes,
          auditRes,
        ] = await withNetworkGuard(
          Promise.all([
            supabase.rpc('admin_get_dashboard_analytics'),
            supabase
              .from('orders')
              .select(
                'id, order_number, user_id, customer_snapshot, delivery_address_snapshot, final_amount, currency, payment_method, payment_status, delivery_status, payment_reference, tracking_number, courier_partner, tracking_url, created_at, order_items(id, product_name_snapshot, sku_snapshot, quantity, total_price)'
              )
              .order('created_at', { ascending: false })
              .limit(40),
            supabase
              .from('payment_verifications')
              .select(
                'id, order_id, utr_number, payer_upi_id, proof_image_url, customer_note, verification_status, admin_remarks, submitted_at, verified_at, orders(order_number, final_amount)'
              )
              .order('submitted_at', { ascending: false })
              .limit(40),
            supabase
              .from('inventory')
              .select(
                'id, product_id, sku, available_quantity, low_stock_threshold, stock_status, products(id, name, selling_price, status, total_sold)'
              )
              .order('available_quantity', { ascending: true }),
            supabase
              .from('profiles')
              .select('id, full_name, email, phone, is_restricted, restriction_reason, created_at')
              .order('created_at', { ascending: false })
              .limit(50),
            supabase.from('user_roles').select('user_id, role'),
            supabase
              .from('admin_audit_logs')
              .select('id, admin_user_id, action, entity_type, entity_id, created_at')
              .order('created_at', { ascending: false })
              .limit(25),
          ]),
          15000
        );

        if (!active) return;

        const firstErr =
          analyticsRes.error ||
          ordersRes.error ||
          verifRes.error ||
          invRes.error ||
          profilesRes.error ||
          rolesRes.error ||
          auditRes.error;
        if (firstErr) {
          setFeedback({ type: 'error', text: firstErr.message });
        }

        if (analyticsRes.data) setAnalytics(analyticsRes.data);
        if (ordersRes.data) setOrders(ordersRes.data);
        if (verifRes.data) setVerifications(verifRes.data);
        if (invRes.data) setInventoryRows(invRes.data);

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

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return orders.filter((order) => {
      if (orderFilter !== 'all' && order.delivery_status !== orderFilter && order.payment_status !== orderFilter) {
        return false;
      }
      if (!q) return true;
      const hay = `${order.order_number} ${order.customer_snapshot?.full_name || ''} ${
        order.customer_snapshot?.phone || ''
      } ${order.payment_reference || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [orders, orderFilter, orderSearch]);

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

  const handleAdminPasswordSubmit = async (e) => {
    e.preventDefault();
    if (actionLockRef.current.has('admin-login')) return;
    actionLockRef.current.add('admin-login');
    setLoginError('');
    setLoginLoading(true);
    const res = await signInWithAdminPassword(loginEmail, loginPassword);
    setLoginLoading(false);
    actionLockRef.current.delete('admin-login');
    if (!res.ok) {
      setLoginError(res.error);
    } else {
      setLoginPassword('');
    }
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

  const handleOpenSignedProof = async (proofUrl) => {
    if (!supabase) return;
    const objectPath = extractProofObjectPath(proofUrl);
    if (!objectPath) {
      setFeedback({ type: 'error', text: 'Unsupported storage path for payment proof.' });
      return;
    }
    const { data, error } = await supabase.storage
      .from('payment-proofs')
      .createSignedUrl(objectPath, 120);
    if (error || !data?.signedUrl) {
      setFeedback({ type: 'error', text: error?.message || 'Could not generate signed proof URL.' });
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
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
    return (
      <main className="adm-page">
        <div className="adm-shell">
          <button type="button" className="adm-back-btn" onClick={() => navigate('/')}>
            <ArrowLeft size={16} strokeWidth={1.5} />
            <span>Back to store</span>
          </button>

          <section className="adm-gate-card" aria-label="Administrator Sign In">
            <span className="adm-eyebrow">Luxe Store Administration</span>
            <h1 className="adm-title">Admin sign in</h1>
            <p className="adm-subtitle">
              Restricted to verified administrators with server-assigned <code>admin</code> or{' '}
              <code>super_admin</code> roles.
            </p>

            {loginError && (
              <div className="adm-banner adm-banner-error" role="alert">
                {loginError}
              </div>
            )}

            <form className="adm-login-form" onSubmit={handleAdminPasswordSubmit}>
              <label className="adm-field">
                <span>Administrator email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="admin@timessellers.com"
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
                  placeholder="Enter administrator password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                />
              </label>

              <button type="submit" className="adm-primary-btn adm-full-btn" disabled={loginLoading}>
                {loginLoading ? 'Verifying credentials...' : 'Sign in to Admin Console'}
              </button>
            </form>

            <div className="adm-gate-divider">
              <span>or if your admin role uses Google SSO</span>
            </div>

            <button type="button" className="adm-secondary-btn adm-full-btn" onClick={signInWithGoogle}>
              Continue with Google
            </button>
          </section>
        </div>
      </main>
    );
  }

  // GATE 2: SIGNED IN WITHOUT ADMIN ROLE (403 DENY-BY-DEFAULT)
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
            <span className="adm-eyebrow">HTTP 403 · Authorization required</span>
            <h1 className="adm-title">Admin access denied</h1>
            <p className="adm-subtitle">
              Signed in as <strong>{user.email}</strong>, which carries the <code>{user.role}</code>{' '}
              role. Server-side RLS and RPC guards allow access only to accounts assigned{' '}
              <code>admin</code> or <code>super_admin</code> in <code>public.user_roles</code>.
            </p>

            <div className="adm-gate-actions">
              <button type="button" className="adm-secondary-btn" onClick={() => navigate('/profile')}>
                Go to profile
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
              <ArrowLeft size={15} strokeWidth={1.5} />
              <span>Storefront</span>
            </button>
            <div className="adm-header-badges">
              <span className="adm-eyebrow">Luxe Store Concierge Ops</span>
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
              <RefreshCw size={15} className={loadingData ? 'adm-spin' : ''} />
              <span>{loadingData ? 'Refreshing...' : 'Refresh'}</span>
            </button>
            <button
              type="button"
              className="adm-secondary-btn"
              onClick={async () => {
                await signOut();
                navigate('/admin', { replace: true });
              }}
            >
              <LogOut size={15} />
              <span>Sign out</span>
            </button>
          </div>
        </header>

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
            const pendingVerifs =
              tab.id === 'verifications'
                ? verifications.filter((v) => v.verification_status === 'pending').length
                : 0;
            return (
              <button
                key={tab.id}
                type="button"
                className={`adm-tab-btn ${activeTab === tab.id ? 'is-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={15} strokeWidth={1.6} />
                <span>{tab.label}</span>
                {pendingVerifs > 0 && <span className="adm-tab-count">{pendingVerifs}</span>}
              </button>
            );
          })}
        </nav>

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <section className="adm-section" aria-label="Analytics Overview">
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
                <span>Active products</span>
                <strong>{analytics?.total_products ?? inventoryRows.length}</strong>
                <small>Low/out of stock: {analytics?.low_stock_count ?? 0}</small>
              </article>
              <article className="adm-kpi-card">
                <span>Registered clients</span>
                <strong>{analytics?.total_customers ?? clients.length}</strong>
                <small>Active fulfillment queue: {analytics?.confirmed_orders ?? 0}</small>
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
              <input
                type="search"
                className="adm-search"
                placeholder="Search order #, client name, phone, or UTR..."
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
              />
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
            </div>

            <div className="adm-stack">
              {filteredOrders.map((order) => {
                const isExpanded = expandedOrderId === order.id;
                const customer = order.customer_snapshot || {};
                const addr = order.delivery_address_snapshot || {};
                return (
                  <article key={order.id} className="adm-list-card">
                    <div className="adm-list-card-top">
                      <div>
                        <div className="adm-row-title">
                          {order.order_number} · {formatInr(order.final_amount)}
                        </div>
                        <div className="adm-row-meta">
                          {customer.full_name || 'Client'} · {customer.phone || '—'} ·{' '}
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
                        </div>
                      </div>

                      <button
                        type="button"
                        className="adm-secondary-btn"
                        onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                      >
                        {isExpanded ? 'Close' : 'Manage order'}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="adm-expanded">
                        <div className="adm-order-meta-grid">
                          <div>
                            <small>Delivery address</small>
                            <p>
                              {addr.house_building ? `${addr.house_building}, ` : ''}
                              {addr.street || '—'}, {addr.city || ''} {addr.state || ''}{' '}
                              {addr.pin_code || ''}
                            </p>
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
            <div className="adm-stack">
              {verifications.map((verif) => {
                const isPending = verif.verification_status === 'pending';
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
                        {verif.proof_image_url && (
                          <button
                            type="button"
                            className="adm-secondary-btn"
                            onClick={() => handleOpenSignedProof(verif.proof_image_url)}
                          >
                            <ExternalLink size={14} />
                            <span>View proof</span>
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

              {verifications.length === 0 && (
                <p className="adm-empty">No UPI payment proofs have been submitted.</p>
              )}
            </div>
          </section>
        )}

        {/* TAB 4: INVENTORY */}
        {activeTab === 'inventory' && (
          <section className="adm-section" aria-label="Inventory and Products">
            <div className="adm-stack">
              {inventoryRows.map((row) => (
                <InventoryAdjustRow
                  key={`${row.id}-${row.available_quantity}-${row.products?.status}`}
                  row={row}
                  onUpdated={triggerRefresh}
                  setFeedback={setFeedback}
                />
              ))}
              {inventoryRows.length === 0 && (
                <p className="adm-empty">No inventory records available.</p>
              )}
            </div>
          </section>
        )}

        {/* TAB 5: CLIENTS & AUDIT LOGS */}
        {activeTab === 'audit' && (
          <section className="adm-section" aria-label="Clients and Audit Logs">
            <div className="adm-split-grid">
              <div className="adm-panel">
                <div className="adm-panel-head">
                  <h2>Clients & roles ({clients.length})</h2>
                </div>
                <div className="adm-compact-list">
                  {clients.map((client) => (
                    <div key={client.id} className="adm-compact-row">
                      <div>
                        <strong>{client.full_name || 'Unnamed client'}</strong>
                        <small>
                          {client.email || 'No email'} · {client.roles.join(', ')}
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
    </main>
  );
}
