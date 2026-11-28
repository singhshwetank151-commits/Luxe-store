import { useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Image as ImageIcon,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { formatInr } from '../../lib/currency';
import { supabase } from '../../lib/supabase';
import {
  ALLOWED_PROOF_MIME_TYPES,
  MAX_PRODUCT_IMAGES,
  MAX_PROOF_FILE_BYTES,
  isSafeAssetImageUrl,
  slugifyProductName,
  validateInventoryAdjustment,
  validateProductInput,
  withNetworkGuard,
} from '../../lib/security';

function getExt(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

function makeSuggestedSku(name) {
  const base = slugifyProductName(name || 'watch')
    .replace(/-/g, '')
    .slice(0, 6)
    .toUpperCase();
  const suffix = String(Math.floor(100 + Math.random() * 900));
  return `LS-${base || 'TIME'}-${suffix}`;
}

function extractOrderedProductImages(prod) {
  const rows = Array.isArray(prod?.product_images)
    ? [...prod.product_images].sort((a, b) => {
        if (Boolean(b.is_primary) !== Boolean(a.is_primary)) {
          return b.is_primary ? 1 : -1;
        }
        return (a.display_order ?? 0) - (b.display_order ?? 0);
      })
    : [];
  const urls = [];
  const seen = new Set();
  for (const img of rows) {
    const u = String(img?.image_url || '').trim();
    if (u && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  }
  const main = String(prod?.main_image_url || '').trim();
  if (main && !seen.has(main)) {
    urls.unshift(main);
  }
  return urls.slice(0, MAX_PRODUCT_IMAGES);
}

function createEmptyDraft(categories) {
  return {
    id: null,
    name: '',
    brand: 'Luxe Store',
    sku: makeSuggestedSku('luxe'),
    categoryId: categories[0]?.id || '',
    sellingPrice: '',
    originalPrice: '',
    stockQuantity: '5',
    lowStockThreshold: '2',
    shortDescription: '',
    fullDescription: '',
    imageUrls: [],
    status: 'active',
    specsText: 'Mechanical Automatic\nSapphire Crystal\n100m Water Resistance',
  };
}

function ProductEditorForm({
  initialDraft,
  categories,
  onCancel,
  onSaved,
  setFeedback,
}) {
  const isEditing = Boolean(initialDraft?.id);
  const [form, setForm] = useState(initialDraft);
  const [urlInput, setUrlInput] = useState('');
  const [uploadingCount, setUploadingCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const uploadingImage = uploadingCount > 0;
  const imageUrls = Array.isArray(form.imageUrls) ? form.imageUrls : [];
  const remainingSlots = Math.max(0, MAX_PRODUCT_IMAGES - imageUrls.length);

  const updateField = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleAddImageUrl = () => {
    const clean = urlInput.trim();
    if (!clean) return;
    if (!isSafeAssetImageUrl(clean)) {
      setFeedback({ type: 'error', text: 'Photo URL must be an https:// URL or relative path.' });
      return;
    }
    if (imageUrls.includes(clean)) {
      setUrlInput('');
      return;
    }
    if (imageUrls.length >= MAX_PRODUCT_IMAGES) {
      setFeedback({ type: 'error', text: `Maximum ${MAX_PRODUCT_IMAGES} photos per timepiece.` });
      return;
    }
    updateField('imageUrls', [...imageUrls, clean]);
    setUrlInput('');
  };

  const handleSetPrimary = (index) => {
    if (index <= 0 || index >= imageUrls.length) return;
    const next = [...imageUrls];
    const [picked] = next.splice(index, 1);
    next.unshift(picked);
    updateField('imageUrls', next);
  };

  const handleMovePhoto = (index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= imageUrls.length) return;
    const next = [...imageUrls];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    updateField('imageUrls', next);
  };

  const handleRemovePhoto = (index) => {
    updateField(
      'imageUrls',
      imageUrls.filter((_, i) => i !== index)
    );
  };

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0 || !supabase) return;

    if (remainingSlots <= 0) {
      setFeedback({ type: 'error', text: `Maximum ${MAX_PRODUCT_IMAGES} photos per timepiece.` });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    const toUpload = files.slice(0, remainingSlots);
    const skippedForLimit = files.length - toUpload.length;
    const validFiles = [];

    for (const file of toUpload) {
      if (!ALLOWED_PROOF_MIME_TYPES.includes(file.type)) {
        setFeedback({ type: 'error', text: `${file.name}: only JPEG, PNG, or WebP images are allowed.` });
        continue;
      }
      if (file.size > MAX_PROOF_FILE_BYTES) {
        setFeedback({ type: 'error', text: `${file.name}: image must be 5 MB or smaller.` });
        continue;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) {
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setUploadingCount(validFiles.length);
    const uploadedUrls = [];
    let lastErr = '';

    try {
      const slug = slugifyProductName(form.name || form.sku || 'watch') || 'watch';
      const batchTs = Date.now();

      for (let i = 0; i < validFiles.length; i++) {
        const file = validFiles[i];
        const path = `catalog/${slug}-${batchTs}-${i + 1}.${getExt(file.type)}`;
        const { error: uploadErr } = await withNetworkGuard(
          supabase.storage.from('product-images').upload(path, file, {
            contentType: file.type,
            upsert: false,
          }),
          25000
        );
        if (uploadErr) {
          lastErr = uploadErr.message;
          continue;
        }
        const { data: pub } = supabase.storage.from('product-images').getPublicUrl(path);
        if (pub?.publicUrl) {
          uploadedUrls.push(pub.publicUrl);
        }
      }

      if (uploadedUrls.length > 0) {
        setForm((prev) => {
          const prevUrls = Array.isArray(prev.imageUrls) ? prev.imageUrls : [];
          const merged = [...prevUrls];
          for (const u of uploadedUrls) {
            if (!merged.includes(u) && merged.length < MAX_PRODUCT_IMAGES) {
              merged.push(u);
            }
          }
          return { ...prev, imageUrls: merged };
        });
        setFeedback({
          type: 'success',
          text:
            skippedForLimit > 0
              ? `Uploaded ${uploadedUrls.length} photo${uploadedUrls.length === 1 ? '' : 's'} (${skippedForLimit} skipped due to ${MAX_PRODUCT_IMAGES}-photo limit).`
              : `Uploaded ${uploadedUrls.length} photo${uploadedUrls.length === 1 ? '' : 's'}.`,
        });
      } else if (lastErr) {
        setFeedback({ type: 'error', text: `Image upload failed: ${lastErr}` });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to upload photos.',
      });
    } finally {
      setUploadingCount(0);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const syncProductImagesTable = async (productId, productName, urls) => {
    await supabase.from('product_images').delete().eq('product_id', productId);
    if (urls.length > 0) {
      await supabase.from('product_images').insert(
        urls.map((url, idx) => ({
          product_id: productId,
          image_url: url,
          alt_text: `${productName} — view ${idx + 1}`,
          display_order: idx,
          is_primary: idx === 0,
        }))
      );
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!supabase || saving) return;

    // Auto-include any URL typed in the URL input box before saving
    const pendingUrl = urlInput.trim();
    const combinedUrls =
      pendingUrl && !imageUrls.includes(pendingUrl)
        ? [...imageUrls, pendingUrl]
        : imageUrls;

    const validated = validateProductInput({
      ...form,
      imageUrls: combinedUrls,
    });
    if (!validated.ok) {
      setFeedback({ type: 'error', text: validated.error });
      return;
    }

    const d = validated.data;
    setSaving(true);
    try {
      if (isEditing) {
        const { error: updateErr } = await withNetworkGuard(
          supabase
            .from('products')
            .update({
              name: d.name,
              brand: d.brand,
              sku: d.sku,
              category_id: form.categoryId || null,
              selling_price: d.sellingPrice,
              original_price: d.originalPrice,
              short_description: d.shortDescription || null,
              full_description: d.fullDescription || null,
              main_image_url: d.mainImageUrl,
              status: d.status,
            })
            .eq('id', form.id),
          15000
        );
        if (updateErr) {
          setFeedback({ type: 'error', text: updateErr.message });
          return;
        }

        await syncProductImagesTable(form.id, d.name, d.imageUrls);

        const { error: invRpcErr } = await withNetworkGuard(
          supabase.rpc('admin_adjust_inventory', {
            p_product_id: form.id,
            p_new_quantity: d.stockQuantity,
            p_low_stock_threshold: d.lowStockThreshold,
            p_notes: 'Updated via Admin product editor',
          }),
          15000
        );
        if (invRpcErr) {
          await supabase.from('inventory').upsert(
            {
              product_id: form.id,
              sku: d.sku,
              available_quantity: d.stockQuantity,
              low_stock_threshold: d.lowStockThreshold,
            },
            { onConflict: 'product_id' }
          );
        }

        setFeedback({
          type: 'success',
          text: `${d.name} updated with ${d.imageUrls.length} photo${d.imageUrls.length === 1 ? '' : 's'}.`,
        });
        onSaved();
        return;
      }

      // Create new product
      const baseSlug = slugifyProductName(d.name) || 'timepiece';
      const uniqueSlug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;

      const { data: created, error: insertErr } = await withNetworkGuard(
        supabase
          .from('products')
          .insert({
            name: d.name,
            slug: uniqueSlug,
            sku: d.sku,
            brand: d.brand,
            category_id: form.categoryId || null,
            selling_price: d.sellingPrice,
            original_price: d.originalPrice,
            short_description: d.shortDescription || null,
            full_description: d.fullDescription || null,
            main_image_url: d.mainImageUrl,
            status: d.status,
            is_new_arrival: true,
          })
          .select('id')
          .single(),
        15000
      );

      if (insertErr || !created?.id) {
        setFeedback({
          type: 'error',
          text: insertErr?.message || 'Could not create product.',
        });
        return;
      }

      const productId = created.id;

      await supabase.from('inventory').insert({
        product_id: productId,
        sku: d.sku,
        available_quantity: d.stockQuantity,
        low_stock_threshold: d.lowStockThreshold,
      });

      await syncProductImagesTable(productId, d.name, d.imageUrls);

      if (d.specs.length > 0) {
        await supabase.from('product_specifications').insert(
          d.specs.map((spec, idx) => {
            const colonIdx = spec.indexOf(':');
            const specKey = colonIdx > 0 ? spec.slice(0, colonIdx).trim() : `Detail ${idx + 1}`;
            const specVal = colonIdx > 0 ? spec.slice(colonIdx + 1).trim() : spec;
            return {
              product_id: productId,
              spec_group: 'Specifications',
              spec_key: specKey,
              spec_value: specVal,
              display_order: idx,
            };
          })
        );
      }

      setFeedback({
        type: 'success',
        text: `${d.name} added to catalog with ${d.imageUrls.length} photo${d.imageUrls.length === 1 ? '' : 's'}.`,
      });
      onSaved();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to save product.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="adm-panel adm-product-editor" onSubmit={handleSubmit}>
      <div className="adm-panel-head">
        <h2>{isEditing ? `Edit timepiece · ${initialDraft.name}` : 'Add new timepiece'}</h2>
        <button type="button" className="adm-secondary-btn" onClick={onCancel}>
          <X size={16} strokeWidth={1.5} />
          <span>Cancel</span>
        </button>
      </div>

      <div className="adm-product-form-grid">
        <label className="adm-field">
          <span>Watch name</span>
          <input
            type="text"
            required
            maxLength={120}
            placeholder="Sovereign Rose Skeleton"
            value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
          />
        </label>

        <label className="adm-field">
          <span>Brand</span>
          <input
            type="text"
            maxLength={60}
            placeholder="Luxe Store"
            value={form.brand}
            onChange={(e) => updateField('brand', e.target.value)}
          />
        </label>

        <label className="adm-field">
          <span>SKU</span>
          <input
            type="text"
            required
            maxLength={40}
            placeholder="LS-SOV-101"
            value={form.sku}
            onChange={(e) => updateField('sku', e.target.value.toUpperCase())}
          />
        </label>

        <label className="adm-field">
          <span>Category</span>
          <select
            value={form.categoryId}
            onChange={(e) => updateField('categoryId', e.target.value)}
          >
            <option value="">Uncategorized</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </label>

        <label className="adm-field">
          <span>Selling price (₹ INR)</span>
          <input
            type="number"
            required
            min={1}
            step="any"
            placeholder="18900"
            value={form.sellingPrice}
            onChange={(e) => updateField('sellingPrice', e.target.value)}
          />
        </label>

        <label className="adm-field">
          <span>Original MRP (₹, optional)</span>
          <input
            type="number"
            min={1}
            step="any"
            placeholder="24500"
            value={form.originalPrice}
            onChange={(e) => updateField('originalPrice', e.target.value)}
          />
        </label>

        <label className="adm-field">
          <span>Stock quantity</span>
          <input
            type="number"
            required
            min={0}
            max={100000}
            value={form.stockQuantity}
            onChange={(e) => updateField('stockQuantity', e.target.value)}
          />
        </label>

        <label className="adm-field">
          <span>Low-stock alert at</span>
          <input
            type="number"
            min={0}
            max={10000}
            value={form.lowStockThreshold}
            onChange={(e) => updateField('lowStockThreshold', e.target.value)}
          />
        </label>

        <label className="adm-field">
          <span>Storefront visibility</span>
          <select value={form.status} onChange={(e) => updateField('status', e.target.value)}>
            <option value="active">Active (visible on store)</option>
            <option value="inactive">Draft / Hidden</option>
          </select>
        </label>

        <label className="adm-field">
          <span>Edition / short subtitle</span>
          <input
            type="text"
            maxLength={260}
            placeholder="41mm Brushed Steel Mechanical Chronograph"
            value={form.shortDescription}
            onChange={(e) => updateField('shortDescription', e.target.value)}
          />
        </label>

        {/* MULTI-PHOTO GALLERY MANAGER */}
        <div className="adm-field adm-full-span">
          <span>
            Product photos ({imageUrls.length} / {MAX_PRODUCT_IMAGES}) — first photo is the main cover
          </span>

          <div className="adm-gallery-controls">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              className="adm-hidden-file"
              onChange={handleImageUpload}
            />
            <button
              type="button"
              className="adm-secondary-btn"
              disabled={uploadingImage || remainingSlots <= 0}
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={15} strokeWidth={1.5} />
              <span>
                {uploadingImage
                  ? `Uploading ${uploadingCount} photo${uploadingCount === 1 ? '' : 's'}...`
                  : remainingSlots <= 0
                  ? 'Max photos reached'
                  : 'Upload photos'}
              </span>
            </button>

            <div className="adm-url-add-group">
              <input
                type="url"
                maxLength={500}
                placeholder="Or paste https:// photo URL..."
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddImageUrl();
                  }
                }}
              />
              <button
                type="button"
                className="adm-secondary-btn"
                disabled={!urlInput.trim() || remainingSlots <= 0}
                onClick={handleAddImageUrl}
              >
                <Plus size={15} strokeWidth={1.5} />
                <span>Add URL</span>
              </button>
            </div>
          </div>

          {imageUrls.length > 0 ? (
            <div className="adm-gallery-grid">
              {imageUrls.map((url, idx) => (
                <div
                  key={`${url}-${idx}`}
                  className={`adm-gallery-tile ${idx === 0 ? 'is-cover' : ''}`}
                >
                  <div className="adm-gallery-thumb">
                    <img src={url} alt={`${form.name || 'Watch'} view ${idx + 1}`} />
                    {idx === 0 && <span className="adm-cover-tag">Cover</span>}
                    <button
                      type="button"
                      className="adm-tile-remove"
                      aria-label={`Remove photo ${idx + 1}`}
                      onClick={() => handleRemovePhoto(idx)}
                    >
                      <X size={13} strokeWidth={1.75} />
                    </button>
                  </div>

                  <div className="adm-gallery-tile-actions">
                    <button
                      type="button"
                      className="adm-mini-btn"
                      aria-label="Move photo left"
                      disabled={idx === 0}
                      onClick={() => handleMovePhoto(idx, -1)}
                    >
                      <ChevronLeft size={14} strokeWidth={1.5} />
                    </button>
                    {idx > 0 ? (
                      <button
                        type="button"
                        className="adm-mini-btn adm-mini-cover"
                        onClick={() => handleSetPrimary(idx)}
                      >
                        <Star size={12} strokeWidth={1.5} />
                        <span>Cover</span>
                      </button>
                    ) : (
                      <span className="adm-mini-label">Main</span>
                    )}
                    <button
                      type="button"
                      className="adm-mini-btn"
                      aria-label="Move photo right"
                      disabled={idx === imageUrls.length - 1}
                      onClick={() => handleMovePhoto(idx, 1)}
                    >
                      <ChevronRight size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="adm-gallery-empty">
              <ImageIcon size={18} strokeWidth={1.5} />
              <span>Select multiple JPEG, PNG, or WebP files at once to build this watch&apos;s photo gallery.</span>
            </div>
          )}
        </div>

        <label className="adm-field adm-full-span">
          <span>Full description</span>
          <textarea
            rows={3}
            maxLength={2000}
            placeholder="Hand-finished case framing an open-worked automatic calibre..."
            value={form.fullDescription}
            onChange={(e) => updateField('fullDescription', e.target.value)}
          />
        </label>

        {!isEditing && (
          <label className="adm-field adm-full-span">
            <span>Key specifications (one per line)</span>
            <textarea
              rows={3}
              placeholder={'Movement: Calibre LS-901 Automatic\nCrystal: Anti-reflective Sapphire\nWater Resistance: 100m'}
              value={form.specsText}
              onChange={(e) => updateField('specsText', e.target.value)}
            />
          </label>
        )}
      </div>

      <div className="adm-inline-actions">
        <button type="submit" className="adm-primary-btn" disabled={saving || uploadingImage}>
          <Check size={16} strokeWidth={1.5} />
          <span>{saving ? 'Saving...' : isEditing ? 'Save timepiece changes' : 'Create timepiece'}</span>
        </button>
      </div>
    </form>
  );
}

function ProductCatalogCard({
  product,
  onEdit,
  onUpdated,
  setFeedback,
}) {
  const inv = Array.isArray(product.inventory) ? product.inventory[0] : product.inventory;
  const photos = extractOrderedProductImages(product);
  const [qty, setQty] = useState(String(inv?.available_quantity ?? 0));
  const [threshold, setThreshold] = useState(String(inv?.low_stock_threshold ?? 3));
  const [notes, setNotes] = useState('');
  const [savingStock, setSavingStock] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busyAction, setBusyAction] = useState('');

  const stockStatus = inv?.stock_status || (Number(inv?.available_quantity ?? 0) <= 0 ? 'out_of_stock' : 'in_stock');

  const handleAdjustStock = async (e) => {
    e.preventDefault();
    if (!supabase) return;
    const validated = validateInventoryAdjustment({ quantity: qty, threshold, notes });
    if (!validated.ok) {
      setFeedback({ type: 'error', text: validated.error });
      return;
    }

    setSavingStock(true);
    try {
      const { error } = await withNetworkGuard(
        supabase.rpc('admin_adjust_inventory', {
          p_product_id: product.id,
          p_new_quantity: validated.quantity,
          p_low_stock_threshold: validated.threshold,
          p_notes: validated.notes,
        }),
        15000
      );
      if (error) {
        const { error: fallbackErr } = await supabase.from('inventory').upsert(
          {
            product_id: product.id,
            sku: product.sku,
            available_quantity: validated.quantity,
            low_stock_threshold: validated.threshold ?? 3,
          },
          { onConflict: 'product_id' }
        );
        if (fallbackErr) {
          setFeedback({ type: 'error', text: error.message });
          return;
        }
      }
      setNotes('');
      setFeedback({
        type: 'success',
        text: `Stock for ${product.name} updated to ${validated.quantity}.`,
      });
      onUpdated();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Stock adjustment failed.',
      });
    } finally {
      setSavingStock(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!supabase) return;
    const nextStatus = product.status === 'active' ? 'inactive' : 'active';
    setBusyAction('status');
    try {
      const { error } = await withNetworkGuard(
        supabase.from('products').update({ status: nextStatus }).eq('id', product.id),
        15000
      );
      if (error) {
        setFeedback({ type: 'error', text: error.message });
        return;
      }
      setFeedback({ type: 'success', text: `${product.name} marked ${nextStatus}.` });
      onUpdated();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to update status.',
      });
    } finally {
      setBusyAction('');
    }
  };

  const handleDelete = async () => {
    if (!supabase) return;
    setBusyAction('delete');
    try {
      const { error } = await withNetworkGuard(
        supabase.from('products').delete().eq('id', product.id),
        15000
      );
      if (error) {
        setFeedback({
          type: 'error',
          text: `Could not delete ${product.name}: ${error.message}`,
        });
        return;
      }
      setFeedback({ type: 'success', text: `${product.name} removed from catalog.` });
      onUpdated();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Delete failed.',
      });
    } finally {
      setBusyAction('');
      setConfirmDelete(false);
    }
  };

  return (
    <article className="adm-list-card">
      <div className="adm-list-card-top">
        <div className="adm-prod-card-head">
          <div className="adm-prod-thumb">
            {photos[0] ? (
              <img src={photos[0]} alt={product.name} />
            ) : (
              <ImageIcon size={18} strokeWidth={1.5} />
            )}
          </div>
          <div>
            <div className="adm-row-title">{product.name}</div>
            <div className="adm-row-meta">
              SKU {product.sku} · {formatInr(product.selling_price)}
              {product.original_price && Number(product.original_price) > Number(product.selling_price)
                ? ` (MRP ${formatInr(product.original_price)})`
                : ''}{' '}
              · {product.categories?.name || product.brand || 'Timepieces'}
            </div>
            <div className="adm-pill-row">
              <span className={`adm-pill adm-pill-${stockStatus}`}>
                {stockStatus} ({inv?.available_quantity ?? 0})
              </span>
              <span className={`adm-pill adm-pill-${product.status || 'active'}`}>
                {product.status || 'active'}
              </span>
              <span className="adm-pill">
                {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
              </span>
              {Number(product.total_sold || 0) > 0 && (
                <span className="adm-pill">{product.total_sold} sold</span>
              )}
            </div>
          </div>
        </div>

        <div className="adm-card-actions">
          <button type="button" className="adm-secondary-btn" onClick={() => onEdit(product)}>
            <Edit3 size={15} strokeWidth={1.5} />
            <span>Edit</span>
          </button>
          <button
            type="button"
            className="adm-secondary-btn"
            disabled={busyAction === 'status'}
            onClick={handleToggleStatus}
          >
            {product.status === 'active' ? 'Hide' : 'Publish'}
          </button>
          {confirmDelete ? (
            <div className="adm-confirm-inline">
              <button
                type="button"
                className="adm-primary-btn"
                disabled={busyAction === 'delete'}
                onClick={handleDelete}
              >
                {busyAction === 'delete' ? 'Deleting...' : 'Confirm'}
              </button>
              <button
                type="button"
                className="adm-secondary-btn"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="adm-secondary-btn adm-danger-ghost"
              aria-label={`Delete ${product.name}`}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={15} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>

      <form className="adm-stock-form" onSubmit={handleAdjustStock}>
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
          <span>Stock adjustment note</span>
          <input
            type="text"
            placeholder="Restock or physical count"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <button type="submit" className="adm-primary-btn" disabled={savingStock}>
          {savingStock ? 'Saving...' : 'Save stock'}
        </button>
      </form>
    </article>
  );
}

export function AdminCatalogManager({
  products,
  categories,
  initialFilter = 'all',
  autoOpenCreate = false,
  onUpdated,
  setFeedback,
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState(initialFilter);
  const [editorDraft, setEditorDraft] = useState(() =>
    autoOpenCreate ? createEmptyDraft(categories) : null
  );

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((prod) => {
      const inv = Array.isArray(prod.inventory) ? prod.inventory[0] : prod.inventory;
      const stockStatus = inv?.stock_status || 'in_stock';
      const qty = Number(inv?.available_quantity ?? 0);

      if (filter === 'active' && prod.status !== 'active') return false;
      if (filter === 'inactive' && prod.status !== 'inactive') return false;
      if (
        filter === 'low_stock' &&
        stockStatus !== 'low_stock' &&
        stockStatus !== 'out_of_stock' &&
        qty > Number(inv?.low_stock_threshold ?? 3)
      ) {
        return false;
      }

      if (!q) return true;
      const hay = `${prod.name || ''} ${prod.sku || ''} ${prod.brand || ''} ${
        prod.categories?.name || ''
      }`.toLowerCase();
      return hay.includes(q);
    });
  }, [products, search, filter]);

  const handleOpenEdit = (prod) => {
    const inv = Array.isArray(prod.inventory) ? prod.inventory[0] : prod.inventory;
    setEditorDraft({
      id: prod.id,
      name: prod.name || '',
      brand: prod.brand || 'Luxe Store',
      sku: prod.sku || '',
      categoryId: prod.category_id || '',
      sellingPrice: String(prod.selling_price ?? ''),
      originalPrice: prod.original_price != null ? String(prod.original_price) : '',
      stockQuantity: String(inv?.available_quantity ?? 0),
      lowStockThreshold: String(inv?.low_stock_threshold ?? 3),
      shortDescription: prod.short_description || '',
      fullDescription: prod.full_description || '',
      imageUrls: extractOrderedProductImages(prod),
      status: prod.status || 'active',
      specsText: '',
    });
  };

  return (
    <section className="adm-section" aria-label="Products and Inventory">
      <div className="adm-toolbar">
        <div className="adm-search-wrap">
          <Search size={15} strokeWidth={1.5} />
          <input
            type="search"
            className="adm-search"
            placeholder="Search timepiece, SKU, brand, or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="adm-filter-pills" role="tablist" aria-label="Product filters">
          {[
            { id: 'all', label: `All (${products.length})` },
            { id: 'active', label: 'Active' },
            { id: 'inactive', label: 'Drafts' },
            { id: 'low_stock', label: 'Low stock' },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={filter === item.id}
              className={`adm-filter-pill ${filter === item.id ? 'is-active' : ''}`}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="adm-primary-btn"
          onClick={() => setEditorDraft(createEmptyDraft(categories))}
        >
          <Plus size={16} strokeWidth={1.5} />
          <span>Add timepiece</span>
        </button>
      </div>

      {editorDraft && (
        <ProductEditorForm
          key={editorDraft.id || 'new'}
          initialDraft={editorDraft}
          categories={categories}
          onCancel={() => setEditorDraft(null)}
          onSaved={() => {
            setEditorDraft(null);
            onUpdated();
          }}
          setFeedback={setFeedback}
        />
      )}

      <div className="adm-stack">
        {filteredProducts.map((prod) => {
          const inv = Array.isArray(prod.inventory) ? prod.inventory[0] : prod.inventory;
          const photoCount = extractOrderedProductImages(prod).length;
          return (
            <ProductCatalogCard
              key={`${prod.id}-${prod.status}-${prod.selling_price}-${inv?.available_quantity ?? 0}-${photoCount}`}
              product={prod}
              onEdit={handleOpenEdit}
              onUpdated={onUpdated}
              setFeedback={setFeedback}
            />
          );
        })}

        {filteredProducts.length === 0 && (
          <p className="adm-empty">
            No products match this filter. Click &ldquo;Add timepiece&rdquo; to publish a watch to your live storefront.
          </p>
        )}
      </div>
    </section>
  );
}
