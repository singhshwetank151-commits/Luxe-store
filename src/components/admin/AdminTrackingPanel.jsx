import { useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Clock,
  Copy,
  Download,
  Eye,
  Flame,
  Monitor,
  Search,
  ShoppingBag,
  Smartphone,
  Tablet,
  UserCheck,
  Users,
} from 'lucide-react';
import { formatInr } from '../../lib/currency';
import {
  aggregateProductViews,
  buildTrackingCsv,
  formatDurationCompact,
} from '../../lib/trackingSummary';

const RANGE_OPTIONS = [
  { id: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: 'all', label: 'All time', ms: null },
];

const EVENT_LABELS = {
  product_view: 'Viewed page',
  lookbook_focus: 'Browsed in collection',
  add_to_cart: 'Added to bag',
  checkout_start: 'Started checkout',
};

function formatTimeAgo(iso) {
  if (!iso) return '—';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function DeviceIcon({ device }) {
  if (device === 'mobile') return <Smartphone size={13} strokeWidth={1.5} />;
  if (device === 'tablet') return <Tablet size={13} strokeWidth={1.5} />;
  return <Monitor size={13} strokeWidth={1.5} />;
}

export function AdminTrackingPanel({
  views,
  clients,
  setupRequired = false,
  setFeedback,
}) {
  const [subView, setSubView] = useState('people'); // 'people' | 'products' | 'feed'
  const [range, setRange] = useState('30d');
  const [search, setSearch] = useState('');
  const [onlyHotLeads, setOnlyHotLeads] = useState(false);
  const [onlySignedIn, setOnlySignedIn] = useState(false);
  const [expandedProductId, setExpandedProductId] = useState(null);
  const [copiedContact, setCopiedContact] = useState('');

  const clientsById = useMemo(() => {
    const map = new Map();
    for (const c of clients || []) {
      if (c?.id) map.set(c.id, c);
    }
    return map;
  }, [clients]);

  const rangedViews = useMemo(() => {
    const selected = RANGE_OPTIONS.find((r) => r.id === range);
    if (!selected?.ms) return views;
    const cutoff = Date.now() - selected.ms;
    return views.filter((v) => v?.viewed_at && new Date(v.viewed_at).getTime() >= cutoff);
  }, [views, range]);

  const { summary, people, products } = useMemo(
    () => aggregateProductViews(rangedViews, clientsById),
    [rangedViews, clientsById]
  );

  const filteredPeople = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      if (onlyHotLeads && !p.isHotLead) return false;
      if (onlySignedIn && !p.isIdentified) return false;
      if (!q) return true;
      const productText = p.products.map((item) => item.title).join(' ');
      const hay = `${p.name} ${p.email} ${p.phone} ${p.visitorId} ${productText}`.toLowerCase();
      return hay.includes(q);
    });
  }, [people, search, onlyHotLeads, onlySignedIn]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((pr) => {
      const viewerNames = pr.viewers.map((v) => `${v.name} ${v.email}`).join(' ');
      const hay = `${pr.title} ${pr.productSlug} ${viewerNames}`.toLowerCase();
      return hay.includes(q);
    });
  }, [products, search]);

  const filteredFeed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rangedViews.slice(0, 120).filter((row) => {
      if (onlySignedIn && !row.user_id && !row.viewer_email) return false;
      if (!q) return true;
      const hay = `${row.viewer_name || ''} ${row.viewer_email || ''} ${row.visitor_id || ''} ${
        row.product_title || ''
      } ${row.event_type || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rangedViews, search, onlySignedIn]);

  const handleExportTrackingCsv = () => {
    if (filteredPeople.length === 0) {
      setFeedback({ type: 'error', text: 'No tracking records to export.' });
      return;
    }
    const csv = buildTrackingCsv(filteredPeople);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `luxe-store-visitor-tracking-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setFeedback({ type: 'success', text: `Exported tracking data for ${filteredPeople.length} visitors.` });
  };

  const handleCopyContact = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedContact(key);
      window.setTimeout(() => setCopiedContact(''), 1800);
    } catch {
      // Ignore clipboard restrictions
    }
  };

  if (setupRequired) {
    return (
      <section className="adm-section" aria-label="Visitor Tracking Setup">
        <div className="adm-panel">
          <div className="adm-panel-head">
            <h2>Activate product &amp; visitor tracking in Supabase</h2>
          </div>
          <p className="adm-subtitle">
            Run the SQL migration file{' '}
            <code>supabase/migrations/20261128_product_view_tracking.sql</code> once in your
            Supabase Dashboard → <strong>SQL Editor</strong> to create the{' '}
            <code>public.product_views</code> table and tracking RPCs. As soon as you run it, click{' '}
            <strong>Refresh</strong> above and every customer view, repeat visit count, dwell time,
            and add-to-bag event will appear live here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="adm-section" aria-label="Customer Product Tracking">
      {/* KPI Summary Strip */}
      <div className="adm-kpi-grid">
        <article className="adm-kpi-card">
          <span>Product views ({RANGE_OPTIONS.find((r) => r.id === range)?.label})</span>
          <strong>{summary.totalProductViews}</strong>
          <small>{summary.totalEvents} total tracked interactions</small>
        </article>
        <article className="adm-kpi-card">
          <span>Unique visitors</span>
          <strong>{summary.uniquePeople}</strong>
          <small>{summary.identifiedPeople} signed-in clients identified</small>
        </article>
        <article className="adm-kpi-card">
          <span>High-intent shoppers</span>
          <strong>{summary.hotLeadsCount}</strong>
          <small>Repeat viewers (2+ visits) or added to bag</small>
        </article>
        <article className="adm-kpi-card">
          <span>Avg. time per watch</span>
          <strong>{formatDurationCompact(summary.avgDwellSeconds)}</strong>
          <small>Active visible screen time only</small>
        </article>
      </div>

      {/* Sub-view Switcher & Time Range */}
      <div className="adm-toolbar">
        <div className="adm-filter-pills" role="tablist" aria-label="Tracking views">
          {[
            { id: 'people', label: `By person (${people.length})`, icon: Users },
            { id: 'products', label: `By product (${products.length})`, icon: Eye },
            { id: 'feed', label: 'Live feed', icon: Activity },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={subView === tab.id}
                className={`adm-filter-pill adm-pill-with-icon ${subView === tab.id ? 'is-active' : ''}`}
                onClick={() => setSubView(tab.id)}
              >
                <Icon size={14} strokeWidth={1.5} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="adm-period-switch" aria-label="Date range">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={range === opt.id ? 'is-active' : ''}
              onClick={() => setRange(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button type="button" className="adm-secondary-btn" onClick={handleExportTrackingCsv}>
          <Download size={15} strokeWidth={1.5} />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Search & Intent Filters */}
      <div className="adm-toolbar">
        <div className="adm-search-wrap">
          <Search size={15} strokeWidth={1.5} />
          <input
            type="search"
            className="adm-search"
            placeholder="Search person name, email, phone, or timepiece..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {subView === 'people' && (
          <button
            type="button"
            className={`adm-filter-pill adm-pill-with-icon ${onlyHotLeads ? 'is-active' : ''}`}
            onClick={() => setOnlyHotLeads((prev) => !prev)}
          >
            <Flame size={14} strokeWidth={1.5} />
            <span>Hot leads only</span>
          </button>
        )}

        {subView !== 'products' && (
          <button
            type="button"
            className={`adm-filter-pill adm-pill-with-icon ${onlySignedIn ? 'is-active' : ''}`}
            onClick={() => setOnlySignedIn((prev) => !prev)}
          >
            <UserCheck size={14} strokeWidth={1.5} />
            <span>Signed-in clients only</span>
          </button>
        )}
      </div>

      {/* VIEW 1: BY PERSON — WHO SAW WHICH PRODUCTS & HOW MANY TIMES */}
      {subView === 'people' && (
        <div className="adm-stack">
          {filteredPeople.map((person) => {
            const contactLine = [person.email, person.phone].filter(Boolean).join(' · ');
            return (
              <article key={person.key} className="adm-list-card">
                <div className="adm-list-card-top">
                  <div>
                    <div className="adm-row-title adm-person-title">
                      <span>{person.name}</span>
                      {person.isHotLead && (
                        <span className="adm-pill adm-pill-hot">
                          <Flame size={11} strokeWidth={1.75} />
                          Hot lead
                        </span>
                      )}
                      <span
                        className={`adm-pill ${
                          person.isIdentified ? 'adm-pill-confirmed' : ''
                        }`}
                      >
                        {person.isIdentified ? 'Signed-in client' : 'Guest visitor'}
                      </span>
                    </div>
                    <div className="adm-row-meta adm-meta-inline">
                      {contactLine ? <span>{contactLine} · </span> : null}
                      <span>
                        {person.totalProductViews} total{' '}
                        {person.totalProductViews === 1 ? 'visit' : 'visits'} across{' '}
                        {person.uniqueProductsCount}{' '}
                        {person.uniqueProductsCount === 1 ? 'watch' : 'watches'}
                      </span>
                      <span>· {formatDurationCompact(person.totalDurationSeconds)} spent</span>
                      <span className="adm-device-tag">
                        · <DeviceIcon device={person.deviceType} /> {person.deviceType}
                      </span>
                      {person.referrerHost && person.referrerHost !== 'internal' && (
                        <span>· via {person.referrerHost}</span>
                      )}
                      <span>· Last active {formatTimeAgo(person.lastSeenAt)}</span>
                    </div>
                  </div>

                  {contactLine && (
                    <button
                      type="button"
                      className="adm-secondary-btn"
                      onClick={() => handleCopyContact(person.key, contactLine)}
                    >
                      {copiedContact === person.key ? (
                        <>
                          <Check size={14} strokeWidth={1.5} />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy size={14} strokeWidth={1.5} />
                          <span>Copy contact</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Exact Products This Person Saw + Visit Counts */}
                <div className="adm-viewed-table">
                  {person.products.map((item) => (
                    <div key={item.productId} className="adm-viewed-row">
                      <div className="adm-viewed-name">
                        <strong>{item.title}</strong>
                        <small>
                          {item.price ? `${formatInr(item.price)} · ` : ''}
                          Last seen {formatTimeAgo(item.lastViewedAt)}
                        </small>
                      </div>

                      <div className="adm-viewed-metrics">
                        <span className="adm-visit-badge">
                          <Eye size={12} strokeWidth={1.5} />
                          {item.visitCount} {item.visitCount === 1 ? 'visit' : 'visits'}
                        </span>
                        {item.totalDurationSeconds > 0 && (
                          <span className="adm-pill">
                            <Clock size={11} strokeWidth={1.5} />{' '}
                            {formatDurationCompact(item.totalDurationSeconds)}
                          </span>
                        )}
                        {item.addedToCart && (
                          <span className="adm-pill adm-pill-pending">
                            <ShoppingBag size={11} strokeWidth={1.5} /> Added to bag
                          </span>
                        )}
                        {item.startedCheckout && (
                          <span className="adm-pill adm-pill-confirmed">Started checkout</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}

          {filteredPeople.length === 0 && (
            <p className="adm-empty">
              No visitor activity recorded in this window yet. Views from shoppers will appear here automatically.
            </p>
          )}
        </div>
      )}

      {/* VIEW 2: BY PRODUCT — MOST VIEWED WATCHES & WHO VIEWED EACH ONE */}
      {subView === 'products' && (
        <div className="adm-stack">
          {filteredProducts.map((prod) => {
            const isExpanded = expandedProductId === prod.productId;
            return (
              <article key={prod.productId} className="adm-list-card">
                <div className="adm-list-card-top">
                  <div>
                    <div className="adm-row-title">
                      {prod.title} {prod.price ? `· ${formatInr(prod.price)}` : ''}
                    </div>
                    <div className="adm-row-meta">
                      {prod.totalViews} total {prod.totalViews === 1 ? 'view' : 'views'} ·{' '}
                      {prod.uniqueViewers} unique {prod.uniqueViewers === 1 ? 'person' : 'people'} ·{' '}
                      {prod.repeatViewers} repeat {prod.repeatViewers === 1 ? 'viewer' : 'viewers'} ·{' '}
                      Avg. dwell {formatDurationCompact(prod.avgDurationSeconds)}
                    </div>
                    <div className="adm-pill-row">
                      <span className="adm-pill">{prod.detailViews} page opens</span>
                      {prod.addToCartCount > 0 && (
                        <span className="adm-pill adm-pill-pending">
                          {prod.addToCartCount} added to bag
                        </span>
                      )}
                      {prod.checkoutStartCount > 0 && (
                        <span className="adm-pill adm-pill-confirmed">
                          {prod.checkoutStartCount} reached checkout
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="adm-secondary-btn"
                    onClick={() =>
                      setExpandedProductId(isExpanded ? null : prod.productId)
                    }
                  >
                    {isExpanded
                      ? 'Hide viewers'
                      : `See ${prod.uniqueViewers} ${prod.uniqueViewers === 1 ? 'viewer' : 'viewers'}`}
                  </button>
                </div>

                {isExpanded && (
                  <div className="adm-viewed-table">
                    {prod.viewers.map((v) => (
                      <div key={v.key} className="adm-viewed-row">
                        <div className="adm-viewed-name">
                          <strong>{v.name}</strong>
                          <small>
                            {v.email || 'Guest visitor'}
                            {v.phone ? ` · ${v.phone}` : ''} · Last seen{' '}
                            {formatTimeAgo(v.lastViewedAt)}
                          </small>
                        </div>
                        <div className="adm-viewed-metrics">
                          <span className="adm-visit-badge">
                            <Eye size={12} strokeWidth={1.5} />
                            {v.visitCount} {v.visitCount === 1 ? 'visit' : 'visits'}
                          </span>
                          {v.totalDurationSeconds > 0 && (
                            <span className="adm-pill">
                              {formatDurationCompact(v.totalDurationSeconds)}
                            </span>
                          )}
                          {v.addedToCart && (
                            <span className="adm-pill adm-pill-pending">Added to bag</span>
                          )}
                          {v.startedCheckout && (
                            <span className="adm-pill adm-pill-confirmed">Checkout</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            );
          })}

          {filteredProducts.length === 0 && (
            <p className="adm-empty">No product views recorded in this time window yet.</p>
          )}
        </div>
      )}

      {/* VIEW 3: LIVE ACTIVITY FEED */}
      {subView === 'feed' && (
        <div className="adm-panel">
          <div className="adm-panel-head">
            <h2>Recent shopper timeline ({filteredFeed.length})</h2>
          </div>
          <div className="adm-compact-list">
            {filteredFeed.map((row) => {
              const clientProfile = row.user_id ? clientsById.get(row.user_id) : null;
              const who =
                clientProfile?.full_name ||
                row.viewer_name ||
                row.viewer_email ||
                `Guest #${String(row.visitor_id || '').replace(/^v_/i, '').slice(0, 6).toUpperCase()}`;
              return (
                <div key={row.id} className="adm-compact-row">
                  <div>
                    <strong>
                      {who}{' '}
                      <span className="adm-feed-verb">
                        {EVENT_LABELS[row.event_type] || 'viewed'}
                      </span>{' '}
                      {row.product_title}
                    </strong>
                    <small>
                      {clientProfile?.email || row.viewer_email || 'Anonymous session'}
                      {row.duration_seconds > 0
                        ? ` · ${formatDurationCompact(row.duration_seconds)} dwell`
                        : ''}{' '}
                      · {row.device_type || 'desktop'}
                      {row.referrer_host && row.referrer_host !== 'internal'
                        ? ` · via ${row.referrer_host}`
                        : ''}
                    </small>
                  </div>
                  <span className="adm-tabular">{formatTimeAgo(row.viewed_at)}</span>
                </div>
              );
            })}

            {filteredFeed.length === 0 && (
              <p className="adm-empty">No recent events match this filter.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
