-- Applied to live Supabase project `youixtxcfluaskmylqmp` via `harden_storage_and_rls_followup`:
-- 1. Disabled blanket anonymous guest payment-proof reads (`USING (false) TO authenticated`)
-- 2. Narrowed authenticated storage & client-owned RLS policies explicitly `TO authenticated`
-- 3. Removed `image/svg+xml` from public `store-assets` bucket `allowed_mime_types`

ALTER POLICY "Guest read own uploaded payment proof"
  ON storage.objects
  TO authenticated
  USING (false);

ALTER POLICY "Authenticated users upload own avatar" ON storage.objects TO authenticated;
ALTER POLICY "Authenticated users upload own payment proof" ON storage.objects TO authenticated;
ALTER POLICY "Customers read own payment proofs or admin reads all" ON storage.objects TO authenticated;

ALTER POLICY addresses_customer_own ON public.addresses TO authenticated;
ALTER POLICY carts_customer_own ON public.carts TO authenticated;
ALTER POLICY cart_items_customer_own ON public.cart_items TO authenticated;
ALTER POLICY wishlists_customer_own ON public.wishlists TO authenticated;
ALTER POLICY wishlist_items_customer_own ON public.wishlist_items TO authenticated;
ALTER POLICY profiles_insert_own ON public.profiles TO authenticated;
ALTER POLICY profiles_select_own_or_admin ON public.profiles TO authenticated;
ALTER POLICY profiles_update_own_or_admin ON public.profiles TO authenticated;
ALTER POLICY orders_select_own_or_admin ON public.orders TO authenticated;
ALTER POLICY order_items_select_own_or_admin ON public.order_items TO authenticated;
ALTER POLICY order_status_history_select_own_or_admin ON public.order_status_history TO authenticated;
ALTER POLICY payments_select_own_or_admin ON public.payments TO authenticated;
ALTER POLICY payment_verifications_select_own_or_admin ON public.payment_verifications TO authenticated;
ALTER POLICY user_roles_select_own_or_admin ON public.user_roles TO authenticated;

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'store-assets';
