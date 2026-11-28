-- First-party Customer & Product View Tracking for Luxe Store
-- Run this script once in Supabase Dashboard -> SQL Editor

CREATE TABLE IF NOT EXISTS public.product_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  viewer_name text,
  viewer_email text,
  product_id text NOT NULL,
  product_slug text,
  product_title text NOT NULL,
  product_price numeric(12, 2),
  event_type text NOT NULL DEFAULT 'product_view'
    CHECK (event_type IN ('product_view', 'lookbook_focus', 'add_to_cart', 'checkout_start')),
  duration_seconds integer NOT NULL DEFAULT 0
    CHECK (duration_seconds >= 0 AND duration_seconds <= 3600),
  device_type text DEFAULT 'desktop',
  referrer_host text,
  page_path text,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_views_viewed_at
  ON public.product_views (viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_views_user_product
  ON public.product_views (user_id, product_id, viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_views_visitor_product
  ON public.product_views (visitor_id, product_id, viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_views_product_id
  ON public.product_views (product_id, viewed_at DESC);

ALTER TABLE public.product_views ENABLE ROW LEVEL SECURITY;

-- Only verified admins can read customer browsing history
DROP POLICY IF EXISTS product_views_admin_select ON public.product_views;
CREATE POLICY product_views_admin_select
  ON public.product_views
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- Secure RPC to record a product view or high-intent event (works for both guests & signed-in clients)
CREATE OR REPLACE FUNCTION public.record_product_view(
  p_visitor_id text,
  p_product_id text,
  p_product_slug text DEFAULT NULL,
  p_product_title text DEFAULT 'Untitled Timepiece',
  p_product_price numeric DEFAULT NULL,
  p_event_type text DEFAULT 'product_view',
  p_device_type text DEFAULT 'desktop',
  p_referrer_host text DEFAULT NULL,
  p_page_path text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_visitor text := left(trim(coalesce(p_visitor_id, '')), 64);
  v_product_id text := left(trim(coalesce(p_product_id, '')), 120);
  v_event text := coalesce(nullif(trim(p_event_type), ''), 'product_view');
  v_name text := NULL;
  v_email text := NULL;
  v_existing_id uuid := NULL;
  v_new_id uuid;
BEGIN
  IF length(v_visitor) < 6 OR length(v_product_id) < 1 THEN
    RETURN NULL;
  END IF;

  IF v_event NOT IN ('product_view', 'lookbook_focus', 'add_to_cart', 'checkout_start') THEN
    v_event := 'product_view';
  END IF;

  -- Skip recording admin browsing so analytics stay clean
  IF v_uid IS NOT NULL AND public.is_admin(v_uid) THEN
    RETURN NULL;
  END IF;

  -- Anti-spam dedupe: ignore duplicate same-visitor/same-product/same-event within 3 seconds
  SELECT id INTO v_existing_id
  FROM public.product_views
  WHERE visitor_id = v_visitor
    AND product_id = v_product_id
    AND event_type = v_event
    AND viewed_at > now() - interval '3 seconds'
  ORDER BY viewed_at DESC
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  IF v_uid IS NOT NULL THEN
    SELECT p.full_name, coalesce(p.email, u.email)
    INTO v_name, v_email
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE u.id = v_uid;
  END IF;

  INSERT INTO public.product_views (
    visitor_id,
    user_id,
    viewer_name,
    viewer_email,
    product_id,
    product_slug,
    product_title,
    product_price,
    event_type,
    device_type,
    referrer_host,
    page_path
  )
  VALUES (
    v_visitor,
    v_uid,
    left(v_name, 120),
    left(v_email, 160),
    v_product_id,
    left(trim(coalesce(p_product_slug, '')), 120),
    left(coalesce(nullif(trim(p_product_title), ''), 'Untitled Timepiece'), 140),
    CASE WHEN p_product_price IS NOT NULL AND p_product_price >= 0 THEN p_product_price ELSE NULL END,
    v_event,
    CASE WHEN p_device_type IN ('mobile', 'tablet', 'desktop') THEN p_device_type ELSE 'desktop' END,
    left(trim(coalesce(p_referrer_host, '')), 120),
    left(trim(coalesce(p_page_path, '')), 200)
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- Secure RPC to update visible dwell time for an existing view row owned by the same visitor
CREATE OR REPLACE FUNCTION public.update_product_view_duration(
  p_view_id uuid,
  p_visitor_id text,
  p_duration_seconds integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visitor text := left(trim(coalesce(p_visitor_id, '')), 64);
  v_clamped integer := greatest(0, least(coalesce(p_duration_seconds, 0), 3600));
BEGIN
  IF p_view_id IS NULL OR length(v_visitor) < 6 OR v_clamped <= 0 THEN
    RETURN;
  END IF;

  UPDATE public.product_views
  SET duration_seconds = greatest(duration_seconds, v_clamped)
  WHERE id = p_view_id
    AND visitor_id = v_visitor
    AND viewed_at > now() - interval '2 hours';
END;
$$;

-- Stitch previous anonymous guest visits from this browser to the newly signed-in user
CREATE OR REPLACE FUNCTION public.link_visitor_to_current_user(
  p_visitor_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_visitor text := left(trim(coalesce(p_visitor_id, '')), 64);
  v_name text := NULL;
  v_email text := NULL;
  v_updated integer := 0;
BEGIN
  IF v_uid IS NULL OR length(v_visitor) < 6 OR public.is_admin(v_uid) THEN
    RETURN 0;
  END IF;

  SELECT p.full_name, coalesce(p.email, u.email)
  INTO v_name, v_email
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.id = v_uid;

  UPDATE public.product_views
  SET
    user_id = v_uid,
    viewer_name = coalesce(viewer_name, left(v_name, 120)),
    viewer_email = coalesce(viewer_email, left(v_email, 160))
  WHERE visitor_id = v_visitor
    AND user_id IS NULL
    AND viewed_at > now() - interval '30 days';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_product_view(text, text, text, text, numeric, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_view_duration(uuid, text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_visitor_to_current_user(text) TO authenticated;
