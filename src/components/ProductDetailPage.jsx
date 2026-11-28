import { useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { getDefaultVariant, getProductById } from '../data/catalog';
import { useCart, useCatalog, useRouter } from '../context/storeHooks';
import './ProductDetailPage.css';

export function ProductDetailPage({ productId }) {
  const { products } = useCatalog();
  const product = useMemo(
    () =>
      products.find((p) => p.id === productId || p.slug === productId || p.sku === productId) ||
      getProductById(productId),
    [products, productId]
  );
  const { navigate } = useRouter();
  const { addToCart } = useCart();

  const defaultVariant = getDefaultVariant(product);
  const [selectedVariantId, setSelectedVariantId] = useState(defaultVariant?.id || '');
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [added, setAdded] = useState(false);

  const galleryImages = useMemo(() => {
    if (!product) return [];
    if (Array.isArray(product.images) && product.images.length > 0) {
      return product.images;
    }
    return product.image ? [product.image] : [];
  }, [product]);

  if (!product) {
    return (
      <main className="pdp-page">
        <div className="pdp-not-found">
          <h1>Timepiece not found</h1>
          <button type="button" className="pdp-back-btn" onClick={() => navigate('/collection')}>
            <ArrowLeft size={16} strokeWidth={1.5} />
            <span>Back to collection</span>
          </button>
        </div>
      </main>
    );
  }

  const safeImageIndex =
    galleryImages.length > 0 ? Math.min(activeImageIndex, galleryImages.length - 1) : 0;
  const currentImage = galleryImages[safeImageIndex] || product.image;
  const hasMultipleImages = galleryImages.length > 1;

  const stepImage = (delta) => {
    if (galleryImages.length <= 1) return;
    setActiveImageIndex(
      (prev) => (prev + delta + galleryImages.length) % galleryImages.length
    );
  };

  const handleAdd = () => {
    const res = addToCart(product.id, selectedVariantId);
    if (res.ok) {
      setAdded(true);
      window.setTimeout(() => setAdded(false), 1500);
    }
  };

  return (
    <main className="pdp-page">
      <div className="pdp-container">
        <button type="button" className="pdp-back-btn" onClick={() => navigate('/collection')}>
          <ArrowLeft size={16} strokeWidth={1.5} />
          <span>Back to collection</span>
        </button>

        <div className="pdp-grid">
          <div className="pdp-gallery">
            <div
              className="pdp-media"
              tabIndex={hasMultipleImages ? 0 : undefined}
              onKeyDown={(e) => {
                if (!hasMultipleImages) return;
                if (e.key === 'ArrowRight') {
                  e.preventDefault();
                  stepImage(1);
                } else if (e.key === 'ArrowLeft') {
                  e.preventDefault();
                  stepImage(-1);
                }
              }}
            >
              <img
                src={currentImage}
                alt={`${product.title}${hasMultipleImages ? ` — photo ${safeImageIndex + 1} of ${galleryImages.length}` : ''}`}
                className="pdp-img"
              />

              {hasMultipleImages && (
                <>
                  <button
                    type="button"
                    className="pdp-nav-btn pdp-nav-prev"
                    aria-label="Previous photo"
                    onClick={() => stepImage(-1)}
                  >
                    <ChevronLeft size={18} strokeWidth={1.5} />
                  </button>
                  <button
                    type="button"
                    className="pdp-nav-btn pdp-nav-next"
                    aria-label="Next photo"
                    onClick={() => stepImage(1)}
                  >
                    <ChevronRight size={18} strokeWidth={1.5} />
                  </button>
                  <span className="pdp-photo-count" aria-live="polite">
                    {safeImageIndex + 1} / {galleryImages.length}
                  </span>
                </>
              )}
            </div>

            {hasMultipleImages && (
              <div className="pdp-thumbs" role="tablist" aria-label="Product photos">
                {galleryImages.map((imgUrl, idx) => (
                  <button
                    key={`${imgUrl}-${idx}`}
                    type="button"
                    role="tab"
                    aria-selected={idx === safeImageIndex}
                    aria-label={`View photo ${idx + 1}`}
                    className={`pdp-thumb-btn ${idx === safeImageIndex ? 'is-active' : ''}`}
                    onClick={() => setActiveImageIndex(idx)}
                  >
                    <img src={imgUrl} alt={`${product.title} thumbnail ${idx + 1}`} />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="pdp-info">
            <span className="pdp-category">{product.category}</span>
            <h1 className="pdp-title">{product.title}</h1>
            <p className="pdp-subtitle">{product.subtitle}</p>
            <p className="pdp-price">{product.formattedPrice}</p>

            <p className="pdp-description">{product.description}</p>

            {product.variants?.length > 0 && (
              <div className="pdp-variants">
                <span className="pdp-label">Edition and case size</span>
                <div className="pdp-variant-list">
                  {product.variants.map((variant) => (
                    <button
                      key={variant.id}
                      type="button"
                      className={`pdp-variant-btn ${selectedVariantId === variant.id ? 'is-selected' : ''}`}
                      onClick={() => setSelectedVariantId(variant.id)}
                    >
                      {variant.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="pdp-actions">
              <button type="button" className="pdp-cta" onClick={handleAdd}>
                {added ? (
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

              <button type="button" className="pdp-bag-link" onClick={() => navigate('/cart')}>
                View bag
              </button>
            </div>

            <ul className="pdp-specs">
              {product.specs.map((spec) => (
                <li key={spec}>{spec}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
