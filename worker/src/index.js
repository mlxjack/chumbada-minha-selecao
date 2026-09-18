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
    const next = handle(body.type, body.payload, stored);
    await this.ctx.storage.put('cart', next);
    return Response.json({ ok: true, state: next });
  }
}

function handle(type, payload, state) {
  switch (type) {
    case 'GET_STATE':
      return state;

    case 'SET_STORE_NAME':
      state.storeName = ((payload && payload.storeName) || '').slice(0, 120);
      return state;

    case 'ADD_ITEM': {
      const item = payload || {};
      const id = computeItemId(item);
      const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
      const existing = state.items.find((it) => it.id === id);
      if (existing) {
        existing.qty += qty;
      } else {
        state.items.push({
          id,
          catalog: item.catalog,
          productId: item.productId || '',
          name: item.name || '',
          sku: item.sku || null,
          variant: item.variant || '',
          qty,
          unitPrice: Number(item.unitPrice) || 0,
        });
      }
      return state;
    }

    case 'ADJUST_QTY': {
      const delta = Math.floor(Number((payload || {}).delta) || 0);
      const target = state.items.find((it) => it.id === (payload || {}).id);
      if (target) target.qty = Math.max(1, target.qty + delta);
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

    let body;
    try {
      body = await request.json();
    } catch (e) {
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
