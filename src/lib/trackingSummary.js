import { csvEscapeCell } from './security.js';

export function formatDurationCompact(totalSeconds) {
  const secs = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if (mins < 60) return rem > 0 ? `${mins}m ${rem}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

export function getPersonIdentityKey(row) {
  if (row?.user_id) return `u:${row.user_id}`;
  if (row?.viewer_email) return `e:${String(row.viewer_email).trim().toLowerCase()}`;
  return `v:${row?.visitor_id || 'unknown'}`;
}

export function getShortGuestLabel(visitorId) {
  const clean = String(visitorId || '').replace(/^v_/i, '');
  return `Guest #${(clean.slice(0, 6) || 'anon').toUpperCase()}`;
}

/**
 * Aggregates raw product_views rows into:
 * - overview metrics (totalViews, uniquePeople, hotLeadsCount, avgDwellSeconds)
 * - people: sorted list of visitors/clients with every product they saw + visit counts & dwell times
 * - products: sorted list of watches with total views, unique viewers, add-to-bag counts, and viewer breakdown
 */
export function aggregateProductViews(rows = [], clientsById = new Map()) {
  const list = Array.isArray(rows) ? rows : [];
  const peopleMap = new Map();
  const productMap = new Map();

  let totalDuration = 0;
  let durationSamples = 0;
  let totalProductViews = 0;

  for (const row of list) {
    if (!row || !row.product_id) continue;

    const personKey = getPersonIdentityKey(row);
    const clientProfile = row.user_id ? clientsById.get(row.user_id) : null;
    const isIdentified = Boolean(row.user_id || row.viewer_email || clientProfile);
    const displayName =
      clientProfile?.full_name ||
      row.viewer_name ||
      (row.viewer_email ? row.viewer_email.split('@')[0] : getShortGuestLabel(row.visitor_id));
    const email = clientProfile?.email || row.viewer_email || '';
    const phone = clientProfile?.phone || '';
    const dur = Math.max(0, Number(row.duration_seconds) || 0);
    const eventType = row.event_type || 'product_view';
    const ts = row.viewed_at || '';

    if (eventType === 'product_view' || eventType === 'lookbook_focus') {
      totalProductViews += 1;
    }
    if (dur > 0) {
      totalDuration += dur;
      durationSamples += 1;
    }

    // 1. Aggregate by person
    let person = peopleMap.get(personKey);
    if (!person) {
      person = {
        key: personKey,
        userId: row.user_id || null,
        visitorId: row.visitor_id || '',
        isIdentified,
        name: displayName,
        email,
        phone,
        totalEvents: 0,
        totalProductViews: 0,
        totalDurationSeconds: 0,
        addToCartCount: 0,
        checkoutStartCount: 0,
        lastSeenAt: ts,
        deviceType: row.device_type || 'desktop',
        referrerHost: row.referrer_host || 'direct',
        productsMap: new Map(),
      };
      peopleMap.set(personKey, person);
    }

    person.totalEvents += 1;
    if (eventType === 'product_view' || eventType === 'lookbook_focus') {
      person.totalProductViews += 1;
    }
    if (eventType === 'add_to_cart') person.addToCartCount += 1;
    if (eventType === 'checkout_start') person.checkoutStartCount += 1;
    person.totalDurationSeconds += dur;
    if (ts && (!person.lastSeenAt || ts > person.lastSeenAt)) {
      person.lastSeenAt = ts;
      person.deviceType = row.device_type || person.deviceType;
      if (row.referrer_host && row.referrer_host !== 'internal') {
        person.referrerHost = row.referrer_host;
      }
    }

    let personProd = person.productsMap.get(row.product_id);
    if (!personProd) {
      personProd = {
        productId: row.product_id,
        productSlug: row.product_slug || row.product_id,
        title: row.product_title || 'Untitled Timepiece',
        price: row.product_price,
        visitCount: 0,
        detailViews: 0,
        lookbookViews: 0,
        addedToCart: false,
        startedCheckout: false,
        totalDurationSeconds: 0,
        lastViewedAt: ts,
      };
      person.productsMap.set(row.product_id, personProd);
    }
    if (eventType === 'product_view') {
      personProd.visitCount += 1;
      personProd.detailViews += 1;
    } else if (eventType === 'lookbook_focus') {
      personProd.visitCount += 1;
      personProd.lookbookViews += 1;
    } else if (eventType === 'add_to_cart') {
      personProd.addedToCart = true;
    } else if (eventType === 'checkout_start') {
      personProd.startedCheckout = true;
    }
    personProd.totalDurationSeconds += dur;
    if (ts && (!personProd.lastViewedAt || ts > personProd.lastViewedAt)) {
      personProd.lastViewedAt = ts;
    }

    // 2. Aggregate by product
    let prod = productMap.get(row.product_id);
    if (!prod) {
      prod = {
        productId: row.product_id,
        productSlug: row.product_slug || row.product_id,
        title: row.product_title || 'Untitled Timepiece',
        price: row.product_price,
        totalViews: 0,
        detailViews: 0,
        addToCartCount: 0,
        checkoutStartCount: 0,
        totalDurationSeconds: 0,
        durationSamples: 0,
        lastViewedAt: ts,
        viewersMap: new Map(),
      };
      productMap.set(row.product_id, prod);
    }
    if (eventType === 'product_view') {
      prod.totalViews += 1;
      prod.detailViews += 1;
    } else if (eventType === 'lookbook_focus') {
      prod.totalViews += 1;
    } else if (eventType === 'add_to_cart') {
      prod.addToCartCount += 1;
    } else if (eventType === 'checkout_start') {
      prod.checkoutStartCount += 1;
    }
    if (dur > 0) {
      prod.totalDurationSeconds += dur;
      prod.durationSamples += 1;
    }
    if (ts && (!prod.lastViewedAt || ts > prod.lastViewedAt)) {
      prod.lastViewedAt = ts;
    }

    let prodViewer = prod.viewersMap.get(personKey);
    if (!prodViewer) {
      prodViewer = {
        key: personKey,
        name: displayName,
        email,
        phone,
        isIdentified,
        visitCount: 0,
        totalDurationSeconds: 0,
        addedToCart: false,
        startedCheckout: false,
        lastViewedAt: ts,
      };
      prod.viewersMap.set(personKey, prodViewer);
    }
    if (eventType === 'product_view' || eventType === 'lookbook_focus') {
      prodViewer.visitCount += 1;
    }
    if (eventType === 'add_to_cart') prodViewer.addedToCart = true;
    if (eventType === 'checkout_start') prodViewer.startedCheckout = true;
    prodViewer.totalDurationSeconds += dur;
    if (ts && (!prodViewer.lastViewedAt || ts > prodViewer.lastViewedAt)) {
      prodViewer.lastViewedAt = ts;
    }
  }

  const people = Array.from(peopleMap.values())
    .map((p) => {
      const products = Array.from(p.productsMap.values()).sort(
        (a, b) => b.visitCount - a.visitCount || (b.lastViewedAt > a.lastViewedAt ? 1 : -1)
      );
      const maxVisitsOnSingleProduct = products.reduce((m, item) => Math.max(m, item.visitCount), 0);
      const isHotLead =
        p.checkoutStartCount > 0 ||
        p.addToCartCount > 0 ||
        maxVisitsOnSingleProduct >= 2 ||
        p.totalDurationSeconds >= 45;

      return {
        key: p.key,
        userId: p.userId,
        visitorId: p.visitorId,
        isIdentified: p.isIdentified,
        name: p.name,
        email: p.email,
        phone: p.phone,
        totalEvents: p.totalEvents,
        totalProductViews: p.totalProductViews,
        uniqueProductsCount: products.length,
        totalDurationSeconds: p.totalDurationSeconds,
        addToCartCount: p.addToCartCount,
        checkoutStartCount: p.checkoutStartCount,
        lastSeenAt: p.lastSeenAt,
        deviceType: p.deviceType,
        referrerHost: p.referrerHost,
        isHotLead,
        products,
      };
    })
    .sort((a, b) => {
      if (a.isHotLead !== b.isHotLead) return a.isHotLead ? -1 : 1;
      return b.lastSeenAt > a.lastSeenAt ? 1 : -1;
    });

  const products = Array.from(productMap.values())
    .map((pr) => {
      const viewers = Array.from(pr.viewersMap.values()).sort(
        (a, b) => b.visitCount - a.visitCount || b.totalDurationSeconds - a.totalDurationSeconds
      );
      const repeatViewers = viewers.filter((v) => v.visitCount >= 2).length;
      return {
        productId: pr.productId,
        productSlug: pr.productSlug,
        title: pr.title,
        price: pr.price,
        totalViews: pr.totalViews,
        detailViews: pr.detailViews,
        uniqueViewers: viewers.length,
        repeatViewers,
        addToCartCount: pr.addToCartCount,
        checkoutStartCount: pr.checkoutStartCount,
        avgDurationSeconds:
          pr.durationSamples > 0 ? Math.round(pr.totalDurationSeconds / pr.durationSamples) : 0,
        lastViewedAt: pr.lastViewedAt,
        viewers,
      };
    })
    .sort((a, b) => b.totalViews - a.totalViews || b.uniqueViewers - a.uniqueViewers);

  return {
    summary: {
      totalEvents: list.length,
      totalProductViews,
      uniquePeople: people.length,
      identifiedPeople: people.filter((p) => p.isIdentified).length,
      hotLeadsCount: people.filter((p) => p.isHotLead).length,
      avgDwellSeconds: durationSamples > 0 ? Math.round(totalDuration / durationSamples) : 0,
    },
    people,
    products,
  };
}

export function buildTrackingCsv(people = []) {
  const headers = [
    'Person',
    'Email',
    'Phone',
    'Account Type',
    'Hot Lead',
    'Product Viewed',
    'Visits Count',
    'Time Spent (sec)',
    'Added To Bag',
    'Started Checkout',
    'Device',
    'Source',
    'Last Viewed',
  ];

  const rows = [];
  for (const person of Array.isArray(people) ? people : []) {
    for (const item of person.products || []) {
      rows.push(
        [
          person.name,
          person.email || '',
          person.phone || '',
          person.isIdentified ? 'Signed-in Client' : 'Guest Visitor',
          person.isHotLead ? 'Yes' : 'No',
          item.title,
          item.visitCount,
          item.totalDurationSeconds,
          item.addedToCart ? 'Yes' : 'No',
          item.startedCheckout ? 'Yes' : 'No',
          person.deviceType,
          person.referrerHost,
          item.lastViewedAt || person.lastSeenAt || '',
        ]
          .map(csvEscapeCell)
          .join(',')
      );
    }
  }

  return [headers.map(csvEscapeCell).join(','), ...rows].join('\n');
}
