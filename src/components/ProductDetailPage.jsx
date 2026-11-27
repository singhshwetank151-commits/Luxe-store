import { useState } from 'react';
import { ArrowLeft, Check, Plus } from 'lucide-react';
import { getDefaultVariant, getProductById } from '../data/catalog';
import { useCart, useRouter } from '../context/storeHooks';
import './ProductDetailPage.css';

export function ProductDetailPage({ productId }) {
  const product = getProductById(productId);
  const { navigate } = useRouter();
  const { addToCart } = useCart();

  const defaultVariant = getDefaultVariant(product);
  const [selectedVariantId, setSelectedVariantId] = useState(defaultVariant?.id || '');
  const [added, setAdded] = useState(false);

  if (!product) {
    return (
      <main className="pdp-page">
        <div className="pdp-not-found">
          <h1>Timepiece Not Found</h1>
          <button type="button" className="pdp-back-btn" onClick={() => navigate('/collection')}>
            <ArrowLeft size={16} />
            <span>Back to The Runway Edit</span>
          </button>
        </div>
      </main>
    );
  }

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
          <ArrowLeft size={15} />
          <span>BACK TO THE RUNWAY EDIT</span>
        </button>

        <div className="pdp-grid">
          <div className="pdp-media">
            <img src={product.image} alt={product.title} className="pdp-img" />
          </div>

          <div className="pdp-info">
            <span className="pdp-category">{product.category}</span>
            <h1 className="pdp-title">{product.title}</h1>
            <p className="pdp-subtitle">{product.subtitle}</p>
            <p className="pdp-price">{product.formattedPrice}</p>

            <p className="pdp-description">{product.description}</p>

            {product.variants?.length > 0 && (
              <div className="pdp-variants">
                <span className="pdp-label">EDITION / CASE SIZE</span>
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
                    <Check size={16} />
                    <span>ADDED TO BASKET</span>
                  </>
                ) : (
                  <>
                    <Plus size={16} />
                    <span>ADD TO BASKET</span>
                  </>
                )}
              </button>

              <button type="button" className="pdp-bag-link" onClick={() => navigate('/cart')}>
                VIEW BASKET
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
