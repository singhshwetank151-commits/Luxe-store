// Authenticated self-service account deletion Edge Function
// - Trusted-origin CORS allowlist + Bearer token verified via auth.getUser()
// - Blocks admin self-deletion to preserve audit log integrity
// - Scrubs PII from financial ledger rows & removes profile/cart/wishlist before auth.admin.deleteUser()

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://youixtxcfluaskmylqmp.supabase.co',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function getAllowedOrigins(): Set<string> {
  const configured = (Deno.env.get('ALLOWED_ORIGIN') || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]);
}

function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  const allowed = getAllowedOrigins();
  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin && allowed.has(origin)) {
    base['Access-Control-Allow-Origin'] = origin;
  }
  return base;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    const origin = req.headers.get('Origin') || '';
    if (origin && !corsHeaders['Access-Control-Allow-Origin']) {
      return new Response('Forbidden origin', { status: 403, headers: corsHeaders });
    }
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseAnonKey) {
      throw new Error('Server Supabase environment variables are not configured.');
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authorization required.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authErr,
    } = await userClient.auth.getUser();

    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid authentication session.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    const { data: roleRows } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    const isAdminAccount = (roleRows || []).some(
      (r: { role: string }) => r.role === 'admin' || r.role === 'super_admin'
    );
    if (isAdminAccount) {
      return new Response(
        JSON.stringify({ error: 'Administrator accounts cannot be self-deleted to preserve audit logs.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Scrub PII and unlink financial records so auth deletion cascades cleanly
    await adminClient
      .from('orders')
      .update({
        user_id: null,
        customer_snapshot: { deleted_user: true },
        delivery_address_snapshot: { redacted: true },
      })
      .eq('user_id', user.id);

    await adminClient
      .from('payments')
      .update({ user_id: null, payer_name: null, payer_vpa: null })
      .eq('user_id', user.id);

    await adminClient
      .from('payment_verifications')
      .update({ user_id: null, payer_upi_id: null, customer_note: null })
      .eq('user_id', user.id);

    await adminClient.from('addresses').delete().eq('user_id', user.id);
    await adminClient.from('carts').delete().eq('user_id', user.id);
    await adminClient.from('wishlists').delete().eq('user_id', user.id);
    await adminClient.from('product_reviews').delete().eq('user_id', user.id);
    await adminClient.from('profiles').delete().eq('id', user.id);

    const { error: delErr } = await adminClient.auth.admin.deleteUser(user.id);
    if (delErr) {
      return new Response(JSON.stringify({ error: delErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Unable to delete account.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
