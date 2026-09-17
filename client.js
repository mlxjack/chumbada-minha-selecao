/*
 * Minha Seleção — shared widget for the Chumbada Oficial "com preço" catalogs.
 * Include with: <script src="https://selecao.chumbada.com.br/client.js" defer></script>
 * Public API: window.MinhaSelecao.addItem({ catalog, productId, name, sku, variant, qty, unitPrice })
 *             window.MinhaSelecao.openDrawer() / closeDrawer()
 */
(function () {
  'use strict';

  if (window.__minhaSelecaoLoaded) return;
  window.__minhaSelecaoLoaded = true;

  var BRIDGE_ORIGIN = (window.MINHA_SELECAO_BRIDGE_URL || 'https://selecao.chumbada.com.br').replace(/\/$/, '');
  var WHATSAPP_NUMBER = '5511941900602';
  var MIN_ORDER = 900;
  var WHATSAPP_TEXT_LIMIT = 1800; // encoded length guard before falling back to clipboard

  var CATALOG_LABELS = {
    iscas: 'Iscas',
    anzois: 'Anzóis',
    chumbadas: 'Chumbadas',
    acessorios: 'Acessórios',
    oculos: 'Óculos'
  };
  var CATALOG_ORDER = ['iscas', 'anzois', 'chumbadas', 'acessorios', 'oculos'];

  var state = { storeName: '', items: [] };
  var ready = false;
  var queue = [];
  var pending = {};
  var seq = 0;
  var iframe;

  // ---------------------------------------------------------------------
  // Bridge RPC
  // ---------------------------------------------------------------------

  function initBridge() {
    iframe = document.createElement('iframe');
    iframe.src = BRIDGE_ORIGIN + '/bridge.html';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;top:-9999px;left:-9999px;';
    document.body.appendChild(iframe);
    iframe.addEventListener('load', function () {
      iframe.contentWindow.postMessage({ type: 'HELLO' }, BRIDGE_ORIGIN);
    });
    window.addEventListener('message', onBridgeMessage);
  }

  function onBridgeMessage(e) {
    if (e.origin !== BRIDGE_ORIGIN || !iframe || e.source !== iframe.contentWindow) return;
    var msg = e.data || {};

    if (msg.type === 'READY') {
      ready = true;
      var pendingQueue = queue;
      queue = [];
      pendingQueue.forEach(function (run) { run(); });
      call('GET_STATE', {}).then(function (s) { state = s; renderAll(); });
      return;
    }

    if (msg.type === 'STATE_CHANGED') {
      state = msg.state;
      renderAll();
      return;
    }

    if (msg.id && pending[msg.id]) {
      var resolve = pending[msg.id];
      delete pending[msg.id];
      if (msg.ok) {
        state = msg.state;
        resolve(msg.state);
        renderAll();
      }
    }
  }

  function call(type, payload) {
    return new Promise(function (resolve) {
      var run = function () {
        var id = 'm' + (++seq);
        pending[id] = resolve;
        iframe.contentWindow.postMessage({ id: id, type: type, payload: payload }, BRIDGE_ORIGIN);
      };
      if (ready) run(); else queue.push(run);
    });
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  function formatBRL(n) {
    return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function subtotalOf(items) {
    return items.reduce(function (sum, it) { return sum + it.qty * it.unitPrice; }, 0);
  }

  function groupByCatalog(items) {
    var groups = {};
    items.forEach(function (it) {
      (groups[it.catalog] = groups[it.catalog] || []).push(it);
    });
    return groups;
  }

  function totalQty(items) {
    return items.reduce(function (sum, it) { return sum + it.qty; }, 0);
  }

  function escapeHTML(s) {
    return (s || '').toString().replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------

  function injectStyles() {
    var css = ''
      + '.ms-fab{position:fixed;right:20px;bottom:20px;width:60px;height:60px;border-radius:50%;'
      + 'background:#ff6a00;color:#fff;border:0;box-shadow:0 4px 16px rgba(0,0,0,.25);cursor:pointer;'
      + 'z-index:999999;display:flex;align-items:center;justify-content:center;font-family:Arial,sans-serif;}'
      + '.ms-fab svg{width:26px;height:26px;fill:#fff;}'
      + '.ms-badge{position:absolute;top:-4px;right:-4px;background:#1a1a1a;color:#fff;border-radius:9999px;'
      + 'min-width:20px;height:20px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;'
      + 'padding:0 5px;font-family:Arial,sans-serif;}'
      + '.ms-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);opacity:0;pointer-events:none;'
      + 'transition:opacity .2s ease;z-index:999997;}'
      + '.ms-backdrop.ms-open{opacity:1;pointer-events:auto;}'
      + '.ms-drawer{position:fixed;top:0;right:0;height:100%;width:380px;max-width:92vw;background:#fff;'
      + 'box-shadow:-6px 0 24px rgba(0,0,0,.2);transform:translateX(100%);transition:transform .25s ease;'
      + 'z-index:999998;display:flex;flex-direction:column;font-family:Arial,sans-serif;color:#1a1a1a;}'
      + '.ms-drawer.ms-open{transform:translateX(0);}'
      + '.ms-page{position:fixed;inset:0;background:#fff;z-index:999996;overflow:auto;display:none;'
      + 'font-family:Arial,sans-serif;color:#1a1a1a;}'
      + '.ms-page.ms-open{display:block;}'
      + '.ms-page .ms-body-inner{max-width:720px;margin:0 auto;padding:24px 20px 60px;}'
      + '.ms-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;'
      + 'border-bottom:1px solid #eee;flex:0 0 auto;}'
      + '.ms-head h2{margin:0;font-size:18px;}'
      + '.ms-close{background:none;border:0;font-size:22px;line-height:1;cursor:pointer;color:#666;padding:4px 8px;}'
      + '.ms-body{flex:1 1 auto;overflow:auto;padding:14px 18px;}'
      + '.ms-storename{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #ddd;border-radius:6px;'
      + 'font-size:14px;margin-bottom:14px;font-family:Arial,sans-serif;}'
      + '.ms-empty{color:#888;font-size:14px;text-align:center;padding:40px 10px;}'
      + '.ms-group-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;'
      + 'color:#ff6a00;margin:16px 0 6px;}'
      + '.ms-group-title:first-child{margin-top:0;}'
      + '.ms-row{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #f0f0f0;}'
      + '.ms-row-info{flex:1 1 auto;min-width:0;}'
      + '.ms-row-name{font-size:14px;font-weight:600;margin:0 0 2px;}'
      + '.ms-row-variant{font-size:12px;color:#666;margin:0 0 2px;}'
      + '.ms-row-sku{font-size:11px;color:#999;margin:0 0 4px;}'
      + '.ms-row-price{font-size:12px;color:#444;}'
      + '.ms-row-controls{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:0 0 auto;}'
      + '.ms-qty{display:flex;align-items:center;gap:6px;}'
      + '.ms-qty button{width:22px;height:22px;border:1px solid #ddd;background:#fafafa;border-radius:4px;'
      + 'cursor:pointer;font-size:14px;line-height:1;padding:0;}'
      + '.ms-qty span{min-width:18px;text-align:center;font-size:13px;}'
      + '.ms-remove{background:none;border:0;color:#c33;font-size:12px;cursor:pointer;padding:0;}'
      + '.ms-line-total{font-size:13px;font-weight:700;}'
      + '.ms-foot{flex:0 0 auto;border-top:1px solid #eee;padding:14px 18px 18px;}'
      + '.ms-total-row{display:flex;justify-content:space-between;font-size:15px;font-weight:700;margin-bottom:8px;}'
      + '.ms-progress-wrap{background:#f0f0f0;border-radius:9999px;height:8px;overflow:hidden;margin-bottom:6px;}'
      + '.ms-progress-fill{height:100%;background:#ff6a00;transition:width .2s ease;}'
      + '.ms-progress-label{font-size:12px;color:#666;margin-bottom:10px;}'
      + '.ms-progress-label.ms-ok{color:#1a7d33;}'
      + '.ms-send{width:100%;padding:12px;border:0;border-radius:8px;background:#25D366;color:#fff;'
      + 'font-size:15px;font-weight:700;cursor:pointer;font-family:Arial,sans-serif;}'
      + '.ms-send[disabled]{background:#ccc;cursor:not-allowed;}'
      + '.ms-toast{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);background:#1a1a1a;color:#fff;'
      + 'padding:10px 16px;border-radius:8px;font-size:13px;font-family:Arial,sans-serif;z-index:9999999;'
      + 'opacity:0;transition:opacity .2s ease;pointer-events:none;}'
      + '.ms-toast.ms-show{opacity:1;}'
      + '.ms-page-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}'
      + '.ms-back{color:#ff6a00;text-decoration:none;font-size:14px;font-weight:600;}';
    var style = document.createElement('style');
    style.setAttribute('data-minha-selecao', '');
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ---------------------------------------------------------------------
  // FAB
  // ---------------------------------------------------------------------

  var fabEl, badgeEl;

  function renderFab() {
    fabEl = document.createElement('button');
    fabEl.className = 'ms-fab';
    fabEl.setAttribute('aria-label', 'Abrir Minha Seleção');
    fabEl.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12L8.1 13h7.45c.75 0 1.41-.41 1.75-1.03L20.87 5H4.54l-.94-2H1zM17 18c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>'
      + '<span class="ms-badge" style="display:none">0</span>';
    badgeEl = fabEl.querySelector('.ms-badge');
    fabEl.addEventListener('click', toggleDrawer);
    document.body.appendChild(fabEl);
  }

  function renderBadge() {
    if (!badgeEl) return;
    var count = totalQty(state.items);
    badgeEl.textContent = String(count);
    badgeEl.style.display = count > 0 ? 'flex' : 'none';
  }

  // ---------------------------------------------------------------------
  // Shared row/list rendering (used by both the drawer and the hub page)
  // ---------------------------------------------------------------------

  function renderListInto(bodyEl, footEl) {
    var items = state.items;

    if (!items.length) {
      bodyEl.innerHTML = '<div class="ms-empty">Sua seleção está vazia.<br>Adicione produtos pelos catálogos.</div>';
    } else {
      var groups = groupByCatalog(items);
      var html = '<input type="text" class="ms-storename" placeholder="Nome da loja / cliente" value="'
        + escapeHTML(state.storeName) + '">';
      CATALOG_ORDER.forEach(function (cat) {
        var list = groups[cat];
        if (!list || !list.length) return;
        html += '<div class="ms-group-title">' + CATALOG_LABELS[cat] + '</div>';
        list.forEach(function (it) {
          html += '<div class="ms-row" data-id="' + escapeHTML(it.id) + '">'
            + '<div class="ms-row-info">'
            + '<p class="ms-row-name">' + escapeHTML(it.name) + '</p>'
            + (it.variant ? '<p class="ms-row-variant">' + escapeHTML(it.variant) + '</p>' : '')
            + (it.sku ? '<p class="ms-row-sku">SKU: ' + escapeHTML(it.sku) + '</p>' : '')
            + '<p class="ms-row-price">' + formatBRL(it.unitPrice) + ' un.</p>'
            + '</div>'
            + '<div class="ms-row-controls">'
            + '<button class="ms-remove" data-action="remove">remover</button>'
            + '<div class="ms-qty">'
            + '<button data-action="dec">−</button>'
            + '<span>' + it.qty + '</span>'
            + '<button data-action="inc">+</button>'
            + '</div>'
            + '<div class="ms-line-total">' + formatBRL(it.qty * it.unitPrice) + '</div>'
            + '</div>'
            + '</div>';
        });
      });
      bodyEl.innerHTML = html;

      var nameInput = bodyEl.querySelector('.ms-storename');
      nameInput.addEventListener('change', function () {
        call('SET_STORE_NAME', { storeName: nameInput.value });
      });

      bodyEl.querySelectorAll('.ms-row').forEach(function (row) {
        var id = row.getAttribute('data-id');
        row.querySelector('[data-action="inc"]').addEventListener('click', function () {
          call('ADJUST_QTY', { id: id, delta: 1 });
        });
        row.querySelector('[data-action="dec"]').addEventListener('click', function () {
          call('ADJUST_QTY', { id: id, delta: -1 });
        });
        row.querySelector('[data-action="remove"]').addEventListener('click', function () {
          call('REMOVE_ITEM', { id: id });
        });
      });
    }

    var subtotal = subtotalOf(items);
    var pct = Math.max(0, Math.min(100, (subtotal / MIN_ORDER) * 100));
    var reachedMin = subtotal >= MIN_ORDER;
    var canSend = items.length > 0 && reachedMin;

    footEl.innerHTML = '<div class="ms-total-row"><span>Total</span><span>' + formatBRL(subtotal) + '</span></div>'
      + '<div class="ms-progress-wrap"><div class="ms-progress-fill" style="width:' + pct + '%"></div></div>'
      + '<div class="ms-progress-label' + (reachedMin ? ' ms-ok' : '') + '">'
      + (reachedMin
        ? 'Pedido mínimo atingido ✓'
        : 'Faltam ' + formatBRL(MIN_ORDER - subtotal) + ' para o pedido mínimo de ' + formatBRL(MIN_ORDER))
      + '</div>'
      + '<button class="ms-send"' + (canSend ? '' : ' disabled') + '>Enviar pedido via WhatsApp</button>';

    footEl.querySelector('.ms-send').addEventListener('click', function () {
      if (!canSend) return;
      sendOrder();
    });
  }

  // ---------------------------------------------------------------------
  // Drawer
  // ---------------------------------------------------------------------

  var backdropEl, drawerEl, drawerBodyEl, drawerFootEl;

  function ensureDrawer() {
    if (drawerEl) return;

    backdropEl = document.createElement('div');
    backdropEl.className = 'ms-backdrop';
    backdropEl.addEventListener('click', closeDrawer);
    document.body.appendChild(backdropEl);

    drawerEl = document.createElement('div');
    drawerEl.className = 'ms-drawer';
    drawerEl.innerHTML = '<div class="ms-head"><h2>Minha Seleção</h2><button class="ms-close" aria-label="Fechar">×</button></div>'
      + '<div class="ms-body"></div>'
      + '<div class="ms-foot"></div>';
    drawerEl.querySelector('.ms-close').addEventListener('click', closeDrawer);
    document.body.appendChild(drawerEl);

    drawerBodyEl = drawerEl.querySelector('.ms-body');
    drawerFootEl = drawerEl.querySelector('.ms-foot');
  }

  function openDrawer() {
    ensureDrawer();
    backdropEl.classList.add('ms-open');
    drawerEl.classList.add('ms-open');
    renderListInto(drawerBodyEl, drawerFootEl);
  }

  function closeDrawer() {
    if (!drawerEl) return;
    backdropEl.classList.remove('ms-open');
    drawerEl.classList.remove('ms-open');
  }

  function toggleDrawer() {
    if (drawerEl && drawerEl.classList.contains('ms-open')) closeDrawer();
    else openDrawer();
  }

  // ---------------------------------------------------------------------
  // Full page (hub portal — reuses the exact same renderListInto)
  // ---------------------------------------------------------------------

  var pageEl, pageBodyEl, pageFootEl;

  function ensurePage() {
    if (pageEl) return;
    pageEl = document.createElement('div');
    pageEl.className = 'ms-page';
    pageEl.innerHTML = '<div class="ms-body-inner">'
      + '<div class="ms-page-header"><h2>Minha Seleção</h2><a href="#" class="ms-back">← Voltar aos catálogos</a></div>'
      + '<div class="ms-body"></div>'
      + '<div class="ms-foot"></div>'
      + '</div>';
    pageEl.querySelector('.ms-back').addEventListener('click', function (e) {
      e.preventDefault();
      location.hash = '';
    });
    document.body.appendChild(pageEl);
    pageBodyEl = pageEl.querySelector('.ms-body');
    pageFootEl = pageEl.querySelector('.ms-foot');
  }

  function checkHash() {
    if (location.hash === '#/minha-selecao') {
      ensurePage();
      pageEl.classList.add('ms-open');
      renderListInto(pageBodyEl, pageFootEl);
    } else if (pageEl) {
      pageEl.classList.remove('ms-open');
    }
  }

  // ---------------------------------------------------------------------
  // Render dispatch
  // ---------------------------------------------------------------------

  function renderAll() {
    renderBadge();
    if (drawerEl && drawerEl.classList.contains('ms-open')) renderListInto(drawerBodyEl, drawerFootEl);
    if (pageEl && pageEl.classList.contains('ms-open')) renderListInto(pageBodyEl, pageFootEl);
  }

  // ---------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------

  var toastEl, toastTimer;

  function showToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'ms-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('ms-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('ms-show'); }, 2200);
  }

  // ---------------------------------------------------------------------
  // WhatsApp message + send
  // ---------------------------------------------------------------------

  function buildMessage() {
    var groups = groupByCatalog(state.items);
    var lines = [];
    lines.push('Olá! Meu nome/loja: *' + (state.storeName || '(não informado)') + '*');
    lines.push('');
    lines.push('Segue minha Seleção de produtos Chumbada Oficial:');

    var total = 0;
    CATALOG_ORDER.forEach(function (cat) {
      var items = groups[cat];
      if (!items || !items.length) return;
      lines.push('');
      lines.push('*' + CATALOG_LABELS[cat].toUpperCase() + '*');
      var subtotal = 0;
      items.forEach(function (it, idx) {
        var lineTotal = it.qty * it.unitPrice;
        subtotal += lineTotal;
        var label = it.name + (it.variant ? ' — ' + it.variant : '');
        lines.push((idx + 1) + '. ' + label
          + ' | Qtd: ' + it.qty
          + (it.sku ? ' | SKU: ' + it.sku : '')
          + ' | ' + formatBRL(it.unitPrice) + ' un.'
          + ' | Subtotal: ' + formatBRL(lineTotal));
      });
      lines.push('Subtotal ' + CATALOG_LABELS[cat] + ': ' + formatBRL(subtotal));
      total += subtotal;
    });

    lines.push('');
    lines.push('*TOTAL GERAL: ' + formatBRL(total) + '*');
    if (total < MIN_ORDER) {
      lines.push('Pedido mínimo: ' + formatBRL(MIN_ORDER) + ' — faltam ' + formatBRL(MIN_ORDER - total));
    }
    lines.push('');
    lines.push('Pedido gerado via chumbada.com.br');
    return lines.join('\n');
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* no-op */ }
    document.body.removeChild(ta);
  }

  function openLink(url) {
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function sendOrder() {
    var text = buildMessage();
    var encoded = encodeURIComponent(text);
    var base = 'https://wa.me/' + WHATSAPP_NUMBER;
    var url;

    if (encoded.length > WHATSAPP_TEXT_LIMIT) {
      copyToClipboard(text);
      url = base;
      showToast('Lista copiada! Cole (Ctrl+V) na conversa que vai abrir.');
    } else {
      url = base + '?text=' + encoded;
    }

    openLink(url);
    call('CLEAR', {});
    closeDrawer();
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  window.MinhaSelecao = {
    addItem: function (item) {
      return call('ADD_ITEM', item).then(function () {
        showToast('Adicionado à Minha Seleção');
      });
    },
    openDrawer: openDrawer,
    closeDrawer: closeDrawer
  };

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  function boot() {
    injectStyles();
    initBridge();
    renderFab();
    checkHash();
    window.addEventListener('hashchange', checkHash);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
