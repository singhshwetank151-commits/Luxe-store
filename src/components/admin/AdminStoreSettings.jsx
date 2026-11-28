import { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, QrCode, Upload, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  ALLOWED_PROOF_MIME_TYPES,
  MAX_PROOF_FILE_BYTES,
  buildSafeUpiIntentUrl,
  validateStoreSettingsInput,
  withNetworkGuard,
} from '../../lib/security';

function getExt(mime) {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

export function AdminStoreSettings({ settings, onUpdated, setFeedback }) {
  const [storeName, setStoreName] = useState(settings?.store_name || 'Luxe Store');
  const [upiId, setUpiId] = useState(settings?.upi_id || '');
  const [upiDisplayName, setUpiDisplayName] = useState(
    settings?.upi_display_name || settings?.store_name || 'Luxe Store'
  );
  const [upiQrImageUrl, setUpiQrImageUrl] = useState(settings?.upi_qr_image_url || '');
  const [upiInstructions, setUpiInstructions] = useState(
    settings?.upi_payment_instructions ||
      'Scan the UPI QR code or transfer the exact invoice amount to our verified UPI ID, then submit your 12-digit UTR reference number below.'
  );
  const [previewQrDataUrl, setPreviewQrDataUrl] = useState('');
  const [uploadingQr, setUploadingQr] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const previewIntentUrl = useMemo(() => {
    if (!upiId.trim()) return '';
    return buildSafeUpiIntentUrl({
      upiId: upiId.trim(),
      payeeName: upiDisplayName.trim() || storeName.trim() || 'Luxe Store',
      amount: 14800,
      orderNumber: 'PREVIEW-TEST',
    });
  }, [upiId, upiDisplayName, storeName]);

  useEffect(() => {
    let active = true;
    if (!previewIntentUrl) {
      setPreviewQrDataUrl('');
      return undefined;
    }
    QRCode.toDataURL(previewIntentUrl, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#220306', light: '#ffffff' },
    })
      .then((url) => {
        if (active) setPreviewQrDataUrl(url);
      })
      .catch(() => {
        if (active) setPreviewQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [previewIntentUrl]);

  const handleQrUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !supabase) return;

    if (!ALLOWED_PROOF_MIME_TYPES.includes(file.type)) {
      setFeedback({ type: 'error', text: 'QR image must be a JPEG, PNG, or WebP file.' });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (file.size > MAX_PROOF_FILE_BYTES) {
      setFeedback({ type: 'error', text: 'QR image must be 5 MB or smaller.' });
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setUploadingQr(true);
    try {
      const path = `upi-qr/merchant-qr-${Date.now()}.${getExt(file.type)}`;
      const { error: uploadErr } = await withNetworkGuard(
        supabase.storage.from('store-assets').upload(path, file, {
          contentType: file.type,
          upsert: false,
        }),
        20000
      );
      if (uploadErr) {
        setFeedback({ type: 'error', text: `QR upload failed: ${uploadErr.message}` });
        return;
      }
      const { data: pub } = supabase.storage.from('store-assets').getPublicUrl(path);
      if (pub?.publicUrl) {
        setUpiQrImageUrl(pub.publicUrl);
        setFeedback({ type: 'success', text: 'Custom UPI QR uploaded. Click Save settings to apply.' });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to upload custom QR.',
      });
    } finally {
      setUploadingQr(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!supabase || saving) return;

    const validated = validateStoreSettingsInput({
      storeName,
      upiId,
      upiDisplayName,
      upiQrImageUrl,
      upiPaymentInstructions: upiInstructions,
    });
    if (!validated.ok) {
      setFeedback({ type: 'error', text: validated.error });
      return;
    }

    setSaving(true);
    try {
      let query;
      if (settings?.id) {
        query = supabase
          .from('store_settings')
          .update(validated.data)
          .eq('id', settings.id);
      } else {
        query = supabase.from('store_settings').insert(validated.data);
      }

      const { error } = await withNetworkGuard(query, 15000);
      if (error) {
        setFeedback({ type: 'error', text: error.message });
        return;
      }

      setFeedback({
        type: 'success',
        text: 'Store & UPI checkout settings saved. Live on /checkout immediately.',
      });
      onUpdated();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not save store settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="adm-section" aria-label="Store and UPI Settings">
      <div className="adm-settings-grid">
        <form className="adm-panel" onSubmit={handleSave}>
          <div className="adm-panel-head">
            <h2>Direct UPI & store configuration</h2>
          </div>

          <div className="adm-product-form-grid">
            <label className="adm-field">
              <span>Store name</span>
              <input
                type="text"
                required
                maxLength={80}
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
              />
            </label>

            <label className="adm-field">
              <span>Merchant UPI ID (VPA)</span>
              <input
                type="text"
                maxLength={96}
                placeholder="yourstore@ibl"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
              />
            </label>

            <label className="adm-field adm-full-span">
              <span>UPI payee display name</span>
              <input
                type="text"
                maxLength={60}
                placeholder="TIMESSELLERS"
                value={upiDisplayName}
                onChange={(e) => setUpiDisplayName(e.target.value)}
              />
            </label>

            <div className="adm-field adm-full-span">
              <span>Custom static QR image (optional — leave blank for auto dynamic-amount QR)</span>
              <div className="adm-media-controls">
                <input
                  type="url"
                  maxLength={500}
                  placeholder="Leave blank to auto-generate exact-amount QR per order"
                  value={upiQrImageUrl}
                  onChange={(e) => setUpiQrImageUrl(e.target.value)}
                />
                <div className="adm-media-btns">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="adm-hidden-file"
                    onChange={handleQrUpload}
                  />
                  <button
                    type="button"
                    className="adm-secondary-btn"
                    disabled={uploadingQr}
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload size={15} strokeWidth={1.5} />
                    <span>{uploadingQr ? 'Uploading...' : 'Upload custom QR'}</span>
                  </button>
                  {upiQrImageUrl && (
                    <button
                      type="button"
                      className="adm-secondary-btn"
                      onClick={() => setUpiQrImageUrl('')}
                    >
                      <X size={15} strokeWidth={1.5} />
                      <span>Use dynamic QR</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            <label className="adm-field adm-full-span">
              <span>Checkout payment instructions</span>
              <textarea
                rows={4}
                maxLength={500}
                value={upiInstructions}
                onChange={(e) => setUpiInstructions(e.target.value)}
              />
            </label>
          </div>

          <div className="adm-inline-actions">
            <button type="submit" className="adm-primary-btn" disabled={saving || uploadingQr}>
              <Check size={16} strokeWidth={1.5} />
              <span>{saving ? 'Saving settings...' : 'Save settings'}</span>
            </button>
          </div>
        </form>

        <aside className="adm-panel adm-qr-preview-card" aria-label="Checkout UPI QR Preview">
          <div className="adm-panel-head">
            <h2>Live checkout QR preview</h2>
            <QrCode size={16} strokeWidth={1.5} />
          </div>

          <div className="adm-qr-box">
            {upiQrImageUrl ? (
              <img src={upiQrImageUrl} alt="Custom merchant UPI QR" className="adm-qr-img" />
            ) : previewQrDataUrl ? (
              <img src={previewQrDataUrl} alt="Dynamic checkout UPI QR preview" className="adm-qr-img" />
            ) : (
              <p className="adm-empty">Enter a valid Merchant UPI ID to preview the scannable QR.</p>
            )}
          </div>

          <div className="adm-qr-meta">
            <div>
              <small>Mode</small>
              <strong>
                {upiQrImageUrl ? 'Custom static QR image' : 'Auto dynamic QR (locks exact order ₹)'}
              </strong>
            </div>
            <div>
              <small>Payee</small>
              <strong>{upiDisplayName || storeName || '—'}</strong>
            </div>
            <div>
              <small>UPI ID</small>
              <strong>{upiId || 'Not configured'}</strong>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
