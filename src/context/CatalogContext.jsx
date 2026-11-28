import { useCallback, useEffect, useMemo, useState } from 'react';
import { PRODUCTS, setLiveCatalogProducts } from '../data/catalog';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { withNetworkGuard } from '../lib/security';
import { CatalogContext } from './storeHooks';

export function CatalogProvider({ children }) {
  const [products, setProducts] = useState(PRODUCTS);
  const [hasLiveProducts, setHasLiveProducts] = useState(false);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  const refreshCatalog = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setProducts(PRODUCTS);
      setHasLiveProducts(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await withNetworkGuard(
        supabase
          .from('products')
          .select(
            'id, name, slug, sku, category_id, brand, short_description, full_description, selling_price, original_price, main_image_url, status, created_at, categories(id, name, slug), inventory(available_quantity, low_stock_threshold, stock_status), product_specifications(spec_key, spec_value, display_order)'
          )
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(60),
        12000
      );

      if (!error && Array.isArray(data) && data.length > 0) {
        const merged = setLiveCatalogProducts(data);
        setProducts(merged);
        setHasLiveProducts(true);
      } else {
        setLiveCatalogProducts([]);
        setProducts(PRODUCTS);
        setHasLiveProducts(false);
      }
    } catch {
      // Keep current catalog if offline or unreachable
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCatalog();
  }, [refreshCatalog]);

  const value = useMemo(
    () => ({
      products,
      loading,
      hasLiveProducts,
      refreshCatalog,
    }),
    [products, loading, hasLiveProducts, refreshCatalog]
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}
