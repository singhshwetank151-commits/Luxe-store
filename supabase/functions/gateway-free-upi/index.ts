// Hardened Supabase Edge Function: gateway-free-upi
// - Trusted-origin CORS allowlist (never falls back to wildcard '*')
// - 64 KB request size limit + prototype-pollution-safe JSON parsing
// - Secret read strictly from x-gateway-free-secret header with SHA-256 constant-time check
// - External fetches protected with 10s AbortController timeout & HTTPS Apps Script allowlist
// - Per-order polling cooldown (10s) against Apps Script amplification DoS

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const DEFAULT_ALLOWED_ORIGINS = [
  'https://youixtxcfluaskmylqmp.supabase.co',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
const MAX_REQUEST_BYTES = 65536;
const FETCH_TIMEOUT_MS = 10000;

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
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-gateway-free-secret',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
  if (origin && allowed.has(origin)) {
    base['Access-Control-Allow-Origin'] = origin;
  }
  return base;
}

async function readSafeJsonBody(req: Request): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: string }> {
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return { ok: false, status: 413, error: 'Request payload exceeds size limit.' };
  }
  const raw = await req.text().catch(() => '');
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    return { ok: false, status: 413, error: 'Request payload exceeds size limit.' };
  }
  try {
    const parsed = JSON.parse(raw, (key, value) =>
      key === '__proto__' || key === 'constructor' || key === 'prototype' ? undefined : value
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: 'Invalid JSON request body.' };
    }
    return { ok: true, data: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON request body.' };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function timingSafeEqualHashed(a: string, b: string): Promise<boolean> {
  const cleanA = a.trim();
  const cleanB = b.trim();
  if (!cleanA || !cleanB) return false;
  const encoder = new TextEncoder();
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(cleanA)),
    crypto.subtle.digest('SHA-256', encoder.encode(cleanB)),
  ]);
  const bytesA = new Uint8Array(hashA);
  const bytesB = new Uint8Array(hashB);
  if (bytesA.length !== bytesB.length) return false;
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

function isAllowedAppsScriptUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    return (
      parsed.hostname === 'script.google.com' ||
      parsed.hostname === 'script.googleusercontent.com'
    );
  } catch {
    return false;
  }
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
    const gatewayFreeSecret = Deno.env.get('GATEWAY_FREE_UPI_SECRET') || '';

    if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseAnonKey) {
      throw new Error('Server Supabase environment variables are not configured.');
    }

    const parsedBody = await readSafeJsonBody(req);
    if (!parsedBody.ok) {
      return new Response(JSON.stringify({ ok: false, error: parsedBody.error }), {
        status: parsedBody.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = parsedBody.data;
    const action = String(body.action || '');
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    // ACTION 1: DIRECT BANK CREDIT WEBHOOK FROM GOOGLE APPS SCRIPT
    if (action === 'webhook_bank_credit') {
      const providedSecret = req.headers.get('x-gateway-free-secret') || '';

      if (!gatewayFreeSecret || !(await timingSafeEqualHashed(providedSecret, gatewayFreeSecret))) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Unauthorized gateway-free webhook secret.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const paidAmount = Number(body.amount);
      const utr = String(body.utr || '').trim();
      const payerName = body.payer ? String(body.payer).trim().slice(0, 120) : null;
      const payerVpa = body.vpa ? String(body.vpa).trim().slice(0, 120) : null;
      const messageId = body.message_id ? String(body.message_id).trim().slice(0, 160) : null;
      const orderId = body.order_id ? String(body.order_id).trim() : null;

      if (!Number.isFinite(paidAmount) || paidAmount <= 0 || !utr) {
        return new Response(
          JSON.stringify({ ok: false, error: 'Valid amount and utr are required.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { data: rpcResult, error: rpcError } = await adminClient.rpc(
        'reconcile_gateway_free_upi_credit',
        {
          p_paid_amount: paidAmount,
          p_utr_number: utr,
          p_payer_name: payerName,
          p_payer_vpa: payerVpa,
          p_gmail_message_id: messageId,
          p_order_id: orderId,
        }
      );

      if (rpcError) throw rpcError;

      return new Response(JSON.stringify({ ok: true, result: rpcResult }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // AUTHENTICATED CUSTOMER ACTIONS
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid authentication session.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const orderId = String(body.order_id || '');
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'order_id is required.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Strict object-level ownership check
    const { data: order, error: orderErr } = await adminClient
      .from('orders')
      .select('*, payments(*)')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();

    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: 'Order not found.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: bridgeUrlRpc } = await adminClient.rpc('get_private_gateway_bridge_url');
    const rawAppsScriptUrl =
      Deno.env.get('GATEWAY_FREE_APPS_SCRIPT_URL') ||
      (typeof bridgeUrlRpc === 'string' ? bridgeUrlRpc : '') ||
      '';
    const appsScriptUrl = isAllowedAppsScriptUrl(rawAppsScriptUrl) ? rawAppsScriptUrl : '';
    const paymentRow = Array.isArray(order.payments) ? order.payments[0] : null;
    const expectedAmount = Number(order.unique_payable_amount ?? order.final_amount);

    if (action === 'register_bridge') {
      if (!appsScriptUrl) {
        return new Response(
          JSON.stringify({
            ok: true,
            bridged: false,
            amount: expectedAmount.toFixed(2),
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const customer = order.customer_snapshot || {};
      const gsRes = await fetchWithTimeout(appsScriptUrl, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'register',
          site: 'timessellers',
          order_id: order.id,
          order_number: order.order_number,
          exact_amount: expectedAmount,
          name: customer.full_name || 'TIMESSELLERS Client',
          email: customer.email || `${order.order_number.toLowerCase()}@timessellers.com`,
          phone: customer.phone || '9999999999',
          website: '',
        }),
      });

      const gsJson = await gsRes.json();
      if (gsJson.ok && gsJson.data && paymentRow) {
        await adminClient
          .from('payments')
          .update({
            gateway_free_reg_id: Number(gsJson.data.id) || null,
            gateway_free_token: String(gsJson.data.token || paymentRow.gateway_free_token || ''),
          })
          .eq('id', paymentRow.id);
      }

      return new Response(
        JSON.stringify({
          ok: true,
          bridged: Boolean(gsJson.ok),
          data: gsJson.data || null,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'sync_order_status') {
      if (order.payment_status === 'confirmed') {
        return new Response(
          JSON.stringify({
            ok: true,
            status: 'Paid',
            payment_status: 'confirmed',
            utr: order.payment_reference,
            amount: expectedAmount.toFixed(2),
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const isExpired =
        Boolean(order.payment_expires_at) && new Date(order.payment_expires_at).getTime() < Date.now();

      // 10-second per-order cooldown before nudging external Apps Script
      const rateKey = `upi_poll:${order.id}`;
      const { data: rlRow } = await adminClient
        .from('security_rate_limits')
        .select('updated_at')
        .eq('rate_key', rateKey)
        .maybeSingle();

      const canPollUpstream =
        !rlRow?.updated_at || Date.now() - new Date(rlRow.updated_at).getTime() >= 10000;

      if (!isExpired && appsScriptUrl && paymentRow?.gateway_free_reg_id && canPollUpstream) {
        try {
          await adminClient.from('security_rate_limits').upsert({
            rate_key: rateKey,
            attempt_count: 1,
            window_started_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });

          const gsRes = await fetchWithTimeout(appsScriptUrl, {
            method: 'POST',
            redirect: 'error',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
              action: 'status',
              site: 'timessellers',
              id: paymentRow.gateway_free_reg_id,
              token: paymentRow.gateway_free_token,
            }),
          });
          const gsJson = await gsRes.json();
          const reportedAmount = Number(gsJson?.data?.amount);
          const paiseMatch =
            Number.isFinite(reportedAmount) &&
            Math.round(reportedAmount * 100) === Math.round(expectedAmount * 100);

          if (gsJson.ok && gsJson.data?.status === 'Paid' && gsJson.data?.utr && paiseMatch) {
            const { data: reconciled } = await adminClient.rpc(
              'reconcile_gateway_free_upi_credit',
              {
                p_paid_amount: expectedAmount,
                p_utr_number: String(gsJson.data.utr),
                p_payer_name: gsJson.data.payer || null,
                p_payer_vpa: gsJson.data.vpa || null,
                p_gmail_message_id: `gs_row_${paymentRow.gateway_free_reg_id}`,
                p_order_id: order.id,
              }
            );

            return new Response(
              JSON.stringify({
                ok: true,
                status: 'Paid',
                payment_status: 'confirmed',
                utr: gsJson.data.utr,
                reconciled,
              }),
              { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
        } catch {
          // Fall through and return current DB state
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          status:
            order.payment_status === 'payment_verification'
              ? 'Review'
              : paymentRow?.status === 'expired' || isExpired
              ? 'Expired'
              : 'Pending',
          payment_status: order.payment_status,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Unexpected payment gateway error.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
