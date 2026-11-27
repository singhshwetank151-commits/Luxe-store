import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Check, ShoppingBag, ArrowUpRight } from 'lucide-react';
import { RUNWAY_LOOKS } from '../data/runwayLooks';
import { PRODUCTS, getProductById } from '../data/catalog';
import { useCart, useRouter } from '../context/storeHooks';
import './RunwayLookbook.css';

const MAX_LOOKS = 10;

function getDepthStyle(rawOffset, total, hasScrolled) {
  let offset = ((rawOffset % total) + total) % total;
  if (offset > total / 2) {
    offset -= total;
  }

  // After scrolling: hide all behind watches cleanly, center active watch in showcase slot
  if (hasScrolled) {
    if (offset === 0) {
      return {
        transform: 'translate3d(-50%, 0px, 0) scale(1)',
        opacity: 1,
        filter: 'none',
        zIndex: 40,
      };
    }
    return {
      transform: 'translate3d(-50%, -20px, 0) scale(0.84)',
      opacity: 0,
      filter: 'blur(6px)',
      zIndex: 1,
    };
  }

  if (offset < -0.45) {
    return {
      transform: `translate3d(calc(-50% - 210px), 24px, 0) scale(1.12)`,
      opacity: 0,
      filter: 'blur(4px)',
      zIndex: 45,
    };
  }

  const depth = Math.max(0, offset);
  const scale = Math.max(0.26, Math.pow(0.72, depth));
  const translateX = depth * 155 - Math.pow(depth, 1.32) * 10;
  const translateY = -depth * 52;
  const blurPx = depth < 0.25 ? 0 : Math.min(8.5, Math.pow(depth, 1.4) * 1.35);
  const opacity = Math.max(0.14, 1 - depth * 0.19);
  const zIndex = Math.max(1, Math.round(40 - depth * 7));

  return {
    transform: `translate3d(calc(-50% + ${translateX.toFixed(1)}px), ${translateY.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`,
    opacity: Number(opacity.toFixed(3)),
    filter: blurPx > 0 ? `blur(${blurPx.toFixed(1)}px)` : 'none',
    zIndex,
  };
}

export function RunwayLookbook({ looks: propLooks, initialIndex = 0 }) {
  const looks = useMemo(() => (propLooks || RUNWAY_LOOKS).slice(0, MAX_LOOKS), [propLooks]);
  const totalLooks = looks.length;

  const [activeIndex, setActiveIndex] = useState(() =>
    totalLooks > 0 ? ((initialIndex % totalLooks) + totalLooks) % totalLooks : 0
  );
  const [hasScrolled, setHasScrolled] = useState(false);
  const [addedProductMap, setAddedProductMap] = useState({});
  const [stageAdded, setStageAdded] = useState(false);
  const [cartError, setCartError] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('All');

  const railRef = useRef(null);
  const timersRef = useRef(new Map());

  const { addToCart, items } = useCart();
  const { navigate } = useRouter();

  const mobileCategories = useMemo(
    () => ['All', ...Array.from(new Set(PRODUCTS.map((p) => p.category)))],
    []
  );

  const mobileProducts = useMemo(
    () =>
      selectedCategory === 'All'
        ? PRODUCTS
        : PRODUCTS.filter((p) => p.category === selectedCategory),
    [selectedCategory]
  );

  // Build full scrollable menu list (1 product per look, 3 visible at once in rail)
  const railEntries = useMemo(
    () =>
      looks
        .map((look, lookIdx) => {
          const product = getProductById(look.productIds[0]);
          if (!product) return null;
          return { look, lookIdx, product };
        })
        .filter(Boolean),
    [looks]
  );

  // Sync active look cleanly from right-side scroll menu position
  const handleRailScroll = useCallback(() => {
    const el = railRef.current;
    if (!el || totalLooks <= 1) return;

    const isHorizontal = el.scrollWidth > el.clientWidth + 4 && el.scrollHeight <= el.clientHeight + 4;
    const maxScroll = isHorizontal ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
    if (maxScroll <= 0) return;

    const currentScroll = isHorizontal ? el.scrollLeft : el.scrollTop;
    if (currentScroll > 4) {
      setHasScrolled(true);
    }

    const ratio = Math.max(0, Math.min(1, currentScroll / maxScroll));
    const nextIdx = Math.round(ratio * (totalLooks - 1));
    setActiveIndex((prev) => (prev !== nextIdx ? nextIdx : prev));
  }, [totalLooks]);

  // Smoothly scroll the right-side menu to a target look index
  const scrollRailToLook = useCallback(
    (targetIdx) => {
      const wrapped = ((targetIdx % totalLooks) + totalLooks) % totalLooks;
      const isWrapJump = Math.abs(wrapped - activeIndex) > 1;
      setHasScrolled(true);
      setActiveIndex(wrapped);

      const el = railRef.current;
      if (!el || totalLooks <= 1) return;

      const isHorizontal = el.scrollWidth > el.clientWidth + 4 && el.scrollHeight <= el.clientHeight + 4;
      const maxScroll = isHorizontal ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
      if (maxScroll <= 0) return;

      const targetOffset = (wrapped / (totalLooks - 1)) * maxScroll;
      el.scrollTo({
        top: isHorizontal ? 0 : targetOffset,
        left: isHorizontal ? targetOffset : 0,
        behavior: isWrapJump ? 'auto' : 'smooth',
      });
    },
    [activeIndex, totalLooks]
  );

  // Cleanup active button timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);

  // Scoped keyboard navigation
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        scrollRailToLook(activeIndex + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        scrollRailToLook(activeIndex - 1);
      }
    },
    [activeIndex, scrollRailToLook]
  );

  const activeLook = looks[activeIndex] || looks[0];
  const featuredProduct = activeLook ? getProductById(activeLook.productIds[0]) : null;

  const handleAddProduct = (e, product) => {
    e.stopPropagation();
    const res = addToCart(product.id);
    if (!res.ok) {
      setCartError(res.error || 'Could not add product.');
      const errTimer = window.setTimeout(() => setCartError(null), 2200);
      timersRef.current.set(`err-${product.id}`, errTimer);
      return;
    }

    setCartError(null);
    setAddedProductMap((prev) => ({ ...prev, [product.id]: true }));

    const prevTimer = timersRef.current.get(product.id);
    if (prevTimer) window.clearTimeout(prevTimer);

    const nextTimer = window.setTimeout(() => {
      setAddedProductMap((prev) => ({ ...prev, [product.id]: false }));
      timersRef.current.delete(product.id);
    }, 1500);
    timersRef.current.set(product.id, nextTimer);
  };

  const handleStageAddToCart = () => {
    if (!featuredProduct) return;
    const res = addToCart(featuredProduct.id);
    if (!res.ok) {
      setCartError(res.error || 'Could not add product.');
      const errTimer = window.setTimeout(() => setCartError(null), 2200);
      timersRef.current.set('stage-err', errTimer);
      return;
    }

    setCartError(null);
    setStageAdded(true);
    const prevTimer = timersRef.current.get('stage-add');
    if (prevTimer) window.clearTimeout(prevTimer);

    const nextTimer = window.setTimeout(() => {
      setStageAdded(false);
      timersRef.current.delete('stage-add');
    }, 1500);
    timersRef.current.set('stage-add', nextTimer);
  };

  const handleBuyNow = () => {
    if (featuredProduct && !items.some((i) => i.productId === featuredProduct.id)) {
      addToCart(featuredProduct.id);
    }
    navigate('/checkout');
  };

  if (!activeLook) return null;

  return (
    <section
      className={`rlb-root ${hasScrolled ? 'has-scrolled' : ''}`}
      tabIndex={0}
      aria-label="The Runway Edit Lookbook"
      onKeyDown={handleKeyDown}
    >
      {/* Phone-only Square Luxury Grid (hidden on PC & tablet) */}
      <div className="rlb-mobile-grid-view">
        <header className="rlb-mgrid-header">
          <div className="rlb-mgrid-head-row">
            <span className="rlb-mgrid-eyebrow">Collection</span>
            <span className="rlb-mgrid-count">
              {mobileProducts.length} {mobileProducts.length === 1 ? 'timepiece' : 'timepieces'}
            </span>
          </div>
          <h1 className="rlb-mgrid-heading">Mechanical skeletons</h1>
          <div className="rlb-mgrid-rule" aria-hidden="true" />
        </header>

        <div className="rlb-mgrid-filters" role="tablist" aria-label="Filter collection">
          {mobileCategories.map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={selectedCategory === cat}
              className={`rlb-mgrid-pill ${selectedCategory === cat ? 'is-active' : ''}`}
              onClick={() => setSelectedCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="rlb-mgrid">
          {mobileProducts.map((product, index) => {
            const isAdded = Boolean(addedProductMap[product.id]);
            return (
              <article
                key={product.id}
                className="rlb-mgrid-card"
                style={{ '--stagger': Math.min(index, 5) }}
                onClick={() => navigate(`/product/${product.id}`)}
              >
                <div className="rlb-mgrid-square">
                  <span className="rlb-mgrid-index" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>

                  <button
                    type="button"
                    className={`rlb-mgrid-add ${isAdded ? 'is-added' : ''}`}
                    aria-label={isAdded ? `${product.title} added to bag` : `Add ${product.title} to bag`}
                    onClick={(e) => handleAddProduct(e, product)}
                  >
                    {isAdded ? <Check size={16} strokeWidth={1.5} /> : <Plus size={16} strokeWidth={1.5} />}
                  </button>

                  <img
                    src={product.image}
                    alt={product.title}
                    className="rlb-mgrid-img"
                    loading="lazy"
                  />
                  <div className="rlb-mgrid-shadow" aria-hidden="true" />
                </div>

                <div className="rlb-mgrid-info">
                  <span className="rlb-mgrid-cat">{product.category}</span>
                  <h2 className="rlb-mgrid-title">{product.title}</h2>
                  <div className="rlb-mgrid-foot">
                    <span className="rlb-mgrid-price">{product.formattedPrice}</span>
                    <span className="rlb-mgrid-view-cue" aria-hidden="true">
                      <ArrowUpRight size={16} strokeWidth={1.5} />
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {cartError && (
          <div className="rlb-mgrid-toast" role="alert">
            {cartError}
          </div>
        )}
      </div>

      {/* Left/Center Runway Stage (PC & Tablet) */}
      <div className="rlb-stage-shell">
        <div className="rlb-runway-line" aria-live="polite">
          {looks.map((look, idx) => {
            const rawOffset = idx - activeIndex;
            const depthStyle = getDepthStyle(rawOffset, totalLooks, hasScrolled);
            const isFront = idx === activeIndex;

            return (
              <div
                key={look.id}
                className={`rlb-model-slot ${isFront ? 'is-active' : ''}`}
                style={depthStyle}
                aria-hidden={!isFront}
              >
                <img
                  src={look.modelImage}
                  alt={look.modelAlt}
                  className="rlb-model-img"
                  draggable={false}
                />
                <div className="rlb-floor-shadow" />
              </div>
            );
          })}

          {/* Buy Now & Add to Bag Buttons directly below the active watch */}
          {featuredProduct && (
            <div className="rlb-stage-actions">
              <button
                type="button"
                className="rlb-stage-buy-btn"
                onClick={handleBuyNow}
              >
                <ShoppingBag size={16} strokeWidth={1.5} />
                <span>Buy now</span>
              </button>

              <button
                type="button"
                className={`rlb-stage-cart-btn ${stageAdded ? 'is-added' : ''}`}
                onClick={handleStageAddToCart}
              >
                {stageAdded ? (
                  <>
                    <Check size={16} strokeWidth={1.5} />
                    <span>Added to bag</span>
                  </>
                ) : (
                  <>
                    <Plus size={16} strokeWidth={1.5} />
                    <span>Add to bag</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Brief Watch Detail Panel (shown beside the watch after scrolling) */}
          {hasScrolled && featuredProduct && (
            <div className="rlb-detail-panel" key={featuredProduct.id}>
              <span className="rlb-detail-category">{featuredProduct.category}</span>
              <h2 className="rlb-detail-title">{featuredProduct.title}</h2>
              <p className="rlb-detail-subtitle">{featuredProduct.subtitle}</p>
              <p className="rlb-detail-price">{featuredProduct.formattedPrice}</p>
              <div className="rlb-detail-divider" />
              <p className="rlb-detail-desc">{featuredProduct.description}</p>
              {featuredProduct.specs?.length > 0 && (
                <ul className="rlb-detail-specs" aria-label="Watch Specifications">
                  {featuredProduct.specs.map((spec) => (
                    <li key={spec}>{spec}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {cartError && (
          <div className="rlb-error-toast" role="alert">
            {cartError}
          </div>
        )}
      </div>

      {/* Right-Side Scroll Menu (PC & Tablet) */}
      <aside
        className="rlb-rail"
        ref={railRef}
        onScroll={handleRailScroll}
        aria-label="Collection Scroll Menu"
      >
        <div className="rlb-rail-list">
          {railEntries.map(({ look, lookIdx, product }, idx) => {
            const isAdded = Boolean(addedProductMap[product.id]);
            const isSelected = lookIdx === activeIndex;
            return (
              <article
                key={`${look.id}-${product.id}`}
                className={`rlb-card ${idx % 2 === 0 ? 'is-even' : 'is-odd'} ${
                  isSelected ? 'is-selected' : ''
                }`}
                onClick={() => navigate(`/product/${product.id}`)}
              >
                <div className="rlb-card-media">
                  <img
                    src={product.image}
                    alt={product.title}
                    className="rlb-card-img"
                    loading="lazy"
                  />
                </div>

                <div className="rlb-card-bottom">
                  <div className="rlb-card-meta">
                    <h2 className="rlb-card-title">{product.title}</h2>
                    <p className="rlb-card-price">{product.formattedPrice}</p>
                  </div>

                  <button
                    type="button"
                    className={`rlb-add-btn ${isAdded ? 'is-added' : ''}`}
                    aria-label={isAdded ? `${product.title} added to bag` : `Add ${product.title} to bag`}
                    onClick={(e) => handleAddProduct(e, product)}
                  >
                    {isAdded ? <Check size={16} strokeWidth={1.5} /> : <Plus size={16} strokeWidth={1.5} />}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </aside>
    </section>
  );
}
