const ALLOWED_ORIGINS = new Set([
  // Catálogos com preço — lista "Minha Seleção" (modo WhatsApp)
  'https://precodasiscas.chumbada.com.br',
  'https://precosdosanzois.chumbada.com.br',
  'https://precodaschumbadas.chumbada.com.br',
  'https://precodosacessorios.chumbada.com.br',
  'https://precodosoculos.chumbada.com.br',
  'https://catalogosdeprecos.chumbada.com.br',
  // Catálogos sem preço — lista "Minha Seleção" (modo PDF)
  'https://iscas.chumbada.com.br',
  'https://anzois.chumbada.com.br',
  'https://chumbadas.chumbada.com.br',
  'https://acessorios.chumbada.com.br',
  'https://oculos.chumbada.com.br',
  'https://catalogos.chumbada.com.br',
]);

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Local dev servers only — the Origin header cannot be spoofed by page
  // content, so allowing localhost here poses no risk in production.
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function isValidSid(sid) {
  return typeof sid === 'string' && /^[a-zA-Z0-9-]{10,80}$/.test(sid);
}

// Limits — the Origin check only stops other websites in a browser; anything
// can still call the Worker directly with a forged Origin, so every size and
// count is capped here instead of trusting what the client sends.
const MAX_BODY_BYTES = 8 * 1024;
const MAX_ITEMS = 300;
const MAX_QTY = 9999;
const MAX_UNIT_PRICE = 100000;
const MAX_STORE_NAME = 120;
const FIELD_LIMITS = { productId: 80, name: 200, sku: 60, variant: 120 };
const CATALOGS = new Set(['iscas', 'anzois', 'chumbadas', 'acessorios', 'oculos']);

class LimitError extends Error {}

function clip(value, max) {
  return (value == null ? '' : String(value)).slice(0, max);
}

function clampQty(value) {
  return Math.min(MAX_QTY, Math.max(1, Math.floor(Number(value) || 1)));
}

function cleanPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(MAX_UNIT_PRICE, Math.max(0, Math.round(n * 100) / 100));
}

// Reads the request body but gives up as soon as it passes the limit, so an
// oversized (or chunked, no Content-Length) upload is never fully buffered.
async function readCappedText(request, maxBytes) {
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > maxBytes) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function normalizeVariant(v) {
  return (v || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function computeItemId(item) {
  const key = item.sku || item.productId || '';
  return item.catalog + '::' + key + '::' + normalizeVariant(item.variant);
}

// One CartSession instance per session id. Durable Objects process requests
// to the same instance one at a time, so this is naturally safe against the
// same customer having several catalog tabs open at once — no explicit
// locking needed, unlike the old iframe+localStorage bridge.
export class CartSession {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const body = await request.json();
    const stored = (await this.ctx.storage.get('cart')) || { storeName: '', items: [] };
    let next;
    try {
      next = handle(body.type, body.payload, stored);
    } catch (e) {
      if (e instanceof LimitError) {
        return Response.json({ ok: false, error: e.message, state: stored }, { status: 422 });
      }
      throw e;
    }
    await this.ctx.storage.put('cart', next);
    return Response.json({ ok: true, state: next });
  }
}

function handle(type, payload, state) {
  switch (type) {
    case 'GET_STATE':
      return state;

    case 'SET_STORE_NAME':
      state.storeName = clip(payload && payload.storeName, MAX_STORE_NAME);
      return state;

    case 'ADD_ITEM': {
      const raw = payload || {};
      if (!CATALOGS.has(raw.catalog)) throw new LimitError('unknown catalog');
      const item = {
        catalog: raw.catalog,
        productId: clip(raw.productId, FIELD_LIMITS.productId),
        name: clip(raw.name, FIELD_LIMITS.name),
        sku: raw.sku ? clip(raw.sku, FIELD_LIMITS.sku) : null,
        variant: clip(raw.variant, FIELD_LIMITS.variant),
      };
      const id = computeItemId(item);
      const qty = clampQty(raw.qty);
      const existing = state.items.find((it) => it.id === id);
      if (existing) {
        existing.qty = Math.min(MAX_QTY, existing.qty + qty);
      } else {
        if (state.items.length >= MAX_ITEMS) throw new LimitError('cart full');
        state.items.push({ id, ...item, qty, unitPrice: cleanPrice(raw.unitPrice) });
      }
      return state;
    }

    case 'ADJUST_QTY': {
      const delta = Math.max(-MAX_QTY, Math.min(MAX_QTY, Math.floor(Number((payload || {}).delta) || 0)));
      const target = state.items.find((it) => it.id === (payload || {}).id);
      if (target) target.qty = Math.min(MAX_QTY, Math.max(1, target.qty + delta));
      return state;
    }

    case 'REMOVE_ITEM':
      state.items = state.items.filter((it) => it.id !== (payload || {}).id);
      return state;

    case 'CLEAR':
      return { storeName: state.storeName, items: [] };

    default:
      return state;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = isAllowedOrigin(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: allowed ? corsHeaders(origin) : {} });
    }

    if (!allowed) {
      return Response.json({ ok: false, error: 'origin not allowed' }, { status: 403 });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) });
    }

    // One IP can't hammer the Worker (and burn the free-plan daily quota for
    // everyone). Fails open: if the limiter itself errors, customers still
    // get served.
    if (env.RATE_LIMITER) {
      try {
        const { success } = await env.RATE_LIMITER.limit({
          key: request.headers.get('CF-Connecting-IP') || 'unknown',
        });
        if (!success) {
          return Response.json(
            { ok: false, error: 'rate limited' },
            { status: 429, headers: { ...corsHeaders(origin), 'Retry-After': '30' } }
          );
        }
      } catch (e) {
        // ignore — see comment above
      }
    }

    const text = await readCappedText(request, MAX_BODY_BYTES);
    if (text === null) {
      return Response.json(
        { ok: false, error: 'payload too large' },
        { status: 413, headers: corsHeaders(origin) }
      );
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch (e) {
      body = null;
    }
    if (!body || typeof body !== 'object' || typeof body.type !== 'string') {
      return Response.json(
        { ok: false, error: 'invalid json' },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    if (!isValidSid(body.sid)) {
      return Response.json(
        { ok: false, error: 'invalid session id' },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    const id = env.CART.idFromName(body.sid);
    const stub = env.CART.get(id);
    const doResponse = await stub.fetch('https://cart/', {
      method: 'POST',
      body: JSON.stringify({ type: body.type, payload: body.payload }),
    });

    const responseBody = await doResponse.text();
    return new Response(responseBody, {
      status: doResponse.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  },
};
