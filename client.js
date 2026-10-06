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

  // 'whatsapp' (catálogos com preço) or 'pdf' (catálogos sem preço) — set
  // window.MINHA_SELECAO_MODE = 'pdf' before this script loads to switch.
  var MODE = window.MINHA_SELECAO_MODE || 'whatsapp';
  var SHOW_PRICE = MODE !== 'pdf';

  var WORKER_URL = (window.MINHA_SELECAO_WORKER_URL || 'https://chumbada-minha-selecao.chumbada-oficial.workers.dev').replace(/\/$/, '');
  // Separate cookie per mode so the com-preço (WhatsApp) list and the
  // sem-preço (PDF) list never mix, even though both share the same
  // .chumbada.com.br domain and the same Worker.
  var SID_COOKIE = MODE === 'pdf' ? 'chumbada_lista_sid' : 'chumbada_selecao_sid';
  var SID_DOMAIN = window.MINHA_SELECAO_COOKIE_DOMAIN !== undefined ? window.MINHA_SELECAO_COOKIE_DOMAIN : '.chumbada.com.br';
  var WHATSAPP_NUMBER = '5511941900602';
  var HUB_HOSTNAME = window.MINHA_SELECAO_HUB_HOSTNAME || 'catalogosdeprecos.chumbada.com.br';
  var JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js';

  var CATALOG_LABELS = {
    iscas: 'Iscas',
    anzois: 'Anzóis',
    chumbadas: 'Chumbadas',
    acessorios: 'Acessórios',
    oculos: 'Óculos'
  };
  var CATALOG_ORDER = ['iscas', 'anzois', 'chumbadas', 'acessorios', 'oculos'];

  var state = { storeName: '', items: [] };
  var sid = null;

  // ---------------------------------------------------------------------
  // Session id — a first-party, same-site cookie shared by every
  // *.chumbada.com.br subdomain. Unlike the old third-party iframe
  // approach, this is never partitioned or wiped by Safari's ITP, since
  // it's a normal cookie set directly by whichever catalog page the
  // customer is on, not by a cross-site iframe.
  // ---------------------------------------------------------------------

  function readCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getSid() {
    if (sid) return sid;
    sid = readCookie(SID_COOKIE);
    if (!sid) {
      sid = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : ('sid-' + Date.now() + '-' + Math.random().toString(36).slice(2));
      var cookieStr = SID_COOKIE + '=' + encodeURIComponent(sid) + '; path=/; max-age=' + (60 * 60 * 24 * 365) + '; samesite=lax';
      if (SID_DOMAIN) cookieStr += '; domain=' + SID_DOMAIN;
      if (location.protocol === 'https:') cookieStr += '; secure';
      document.cookie = cookieStr;
    }
    return sid;
  }

  // ---------------------------------------------------------------------
  // Worker API
  // ---------------------------------------------------------------------

  // Each request gets a sequence number, and a response only gets applied
  // if it's newer than whatever was last applied. Separate fetch() calls
  // aren't guaranteed to resolve in the order they were sent (e.g. a
  // GET_STATE refresh fired when the drawer opens can resolve after a
  // rapid ADJUST_QTY click that followed it) — without this guard, an
  // older response arriving late would silently overwrite the display
  // with stale data even though the server's own data is correct.
  var callSeq = 0;
  var appliedSeq = 0;

  function call(type, payload) {
    var thisSeq = ++callSeq;
    return fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: getSid(), type: type, payload: payload })
    })
      .then(function (r) { return r.json(); })
      .then(function (json) {
        if (json && json.ok && thisSeq > appliedSeq) {
          appliedSeq = thisSeq;
          state = json.state;
          renderAll();
        }
        return state;
      })
      .catch(function () {
        return state;
      });
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  function formatBRL(n) {
    return (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // O export do Shopify guarda SKUs numéricos com um apóstrofo na frente (truque do
  // Excel para não virar número); ele não faz parte do código.
  function cleanSku(sku) {
    return String(sku || '').replace(/^'+/, '').trim();
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
      + '.ms-qty button[disabled]{opacity:.4;cursor:not-allowed;}'
      + '.ms-qty span{min-width:18px;text-align:center;font-size:13px;}'
      + '.ms-remove{background:none;border:0;color:#c33;font-size:12px;cursor:pointer;padding:0;}'
      + '.ms-line-total{font-size:13px;font-weight:700;}'
      + '.ms-foot{flex:0 0 auto;border-top:1px solid #eee;padding:14px 18px 18px;}'
      + '.ms-total-row{display:flex;justify-content:space-between;font-size:15px;font-weight:700;margin-bottom:12px;}'
      + '.ms-send{width:100%;padding:12px;border:0;border-radius:8px;background:#25D366;color:#fff;'
      + 'font-size:15px;font-weight:700;cursor:pointer;font-family:Arial,sans-serif;}'
      + '.ms-send[disabled]{background:#ccc;cursor:not-allowed;}'
      + '.ms-actions{display:flex;gap:8px;}'
      + '.ms-actions .ms-send{flex:1 1 55%;padding:12px 8px;}'
      + '.ms-dl{flex:1 1 45%;padding:12px 8px;border:1.5px solid #25D366;border-radius:8px;background:#fff;'
      + 'color:#1a9c4a;font-size:15px;font-weight:700;cursor:pointer;font-family:Arial,sans-serif;}'
      + '.ms-dl[disabled]{border-color:#ccc;color:#aaa;cursor:not-allowed;}'
      + '.ms-toast{position:fixed;left:50%;bottom:92px;transform:translateX(-50%);background:#1a1a1a;color:#fff;'
      + 'padding:10px 16px;border-radius:8px;font-size:13px;font-family:Arial,sans-serif;z-index:9999999;'
      + 'opacity:0;transition:opacity .2s ease;pointer-events:none;}'
      + '.ms-toast.ms-show{opacity:1;}'
      + '.ms-page-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;}'
      + '.ms-back{color:#ff6a00;text-decoration:none;font-size:14px;font-weight:600;}'
      + '.ms-hub-link{position:fixed;left:16px;top:16px;z-index:999995;display:inline-flex;align-items:center;'
      + 'gap:6px;padding:9px 14px;border-radius:999px;background:#fff;color:#ff6a00;border:1.5px solid #ff6a00;'
      + 'font-family:Arial,sans-serif;font-size:13px;font-weight:700;text-decoration:none;'
      + 'box-shadow:0 2px 8px rgba(0,0,0,.15);}'
      + '.ms-hub-link:hover{background:#fff5ec;}'
      + '.ms-clear-all{width:100%;padding:9px;margin-bottom:8px;border:1px solid #ddd;background:#fff;'
      + 'color:#c33;border-radius:8px;font-size:13px;cursor:pointer;font-family:Arial,sans-serif;}'
      + '.ms-clear-all:hover{background:#fff5f5;}';
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
    var iconSvg = MODE === 'pdf'
      ? '<svg viewBox="0 0 24 24"><path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13zM7 12h10v2H7v-2zm0 4h7v2H7v-2z"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12L8.1 13h7.45c.75 0 1.41-.41 1.75-1.03L20.87 5H4.54l-.94-2H1zM17 18c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>';
    fabEl.innerHTML = iconSvg + '<span class="ms-badge" style="display:none">0</span>';
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
  // Back-to-hub link (every catalog except the hub itself)
  // ---------------------------------------------------------------------

  function renderBackToHub() {
    if (location.hostname === HUB_HOSTNAME) return;
    var a = document.createElement('a');
    a.className = 'ms-hub-link';
    a.href = 'https://' + HUB_HOSTNAME + '/';
    a.textContent = '← Voltar aos catálogos';
    document.body.appendChild(a);
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
            + (cleanSku(it.sku) ? '<p class="ms-row-sku">SKU: ' + escapeHTML(cleanSku(it.sku)) + '</p>' : '')
            + (SHOW_PRICE ? '<p class="ms-row-price">' + formatBRL(it.unitPrice) + ' un.</p>' : '')
            + '</div>'
            + '<div class="ms-row-controls">'
            + '<button class="ms-remove" data-action="remove">remover</button>'
            + '<div class="ms-qty">'
            + '<button data-action="dec"' + (it.qty <= 1 ? ' disabled' : '') + '>−</button>'
            + '<span>' + it.qty + '</span>'
            + '<button data-action="inc">+</button>'
            + '</div>'
            + (SHOW_PRICE ? '<div class="ms-line-total">' + formatBRL(it.qty * it.unitPrice) + '</div>' : '')
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

    var canSend = items.length > 0;
    var footHtml = '';

    if (SHOW_PRICE) {
      var subtotal = subtotalOf(items);
      footHtml += '<div class="ms-total-row"><span>Total</span><span>' + formatBRL(subtotal) + '</span></div>';
    }
    footHtml += '<button class="ms-clear-all"' + (canSend ? '' : ' disabled') + '>Limpar lista</button>';
    if (MODE === 'pdf') {
      footHtml += '<button class="ms-send"' + (canSend ? '' : ' disabled') + '>Salvar como PDF</button>';
    } else {
      footHtml += '<div class="ms-actions">'
        + '<button class="ms-send"' + (canSend ? '' : ' disabled') + '>Compartilhar PDF</button>'
        + '<button class="ms-dl"' + (canSend ? '' : ' disabled') + '>Baixar PDF</button>'
        + '</div>';
    }

    footEl.innerHTML = footHtml;

    footEl.querySelector('.ms-send').addEventListener('click', function () {
      if (!canSend) return;
      if (MODE === 'pdf') downloadPdf(); else sharePdf();
    });

    var dlBtn = footEl.querySelector('.ms-dl');
    if (dlBtn) {
      dlBtn.addEventListener('click', function () {
        if (canSend) downloadPdf();
      });
    }

    var clearBtn = footEl.querySelector('.ms-clear-all');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (!canSend) return;
        if (!confirm('Tem certeza que quer apagar toda a lista?')) return;
        call('CLEAR', {});
      });
    }
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
    call('GET_STATE', {});
    preloadJsPdf();
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
      call('GET_STATE', {});
      preloadJsPdf();
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

  function showToast(msg, ms) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'ms-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('ms-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('ms-show'); }, ms || 2200);
  }

  // ---------------------------------------------------------------------
  // PDF — build, download and share. A wa.me link can never carry a file,
  // so on phones we use the system share sheet, where the customer picks
  // WhatsApp and then the salesperson's contact.
  // ---------------------------------------------------------------------

  var jsPdfLoading = null;

  function loadJsPdf() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (jsPdfLoading) return jsPdfLoading;
    jsPdfLoading = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = JSPDF_URL;
      script.onload = function () { resolve(); };
      script.onerror = function () {
        jsPdfLoading = null;
        reject(new Error('failed to load jsPDF'));
      };
      document.head.appendChild(script);
    });
    return jsPdfLoading;
  }

  // Loaded ahead of time (when the list is opened) so the share button can
  // build the PDF synchronously inside the tap — Safari drops the share
  // permission if we wait on a network request first.
  function preloadJsPdf() {
    loadJsPdf().catch(function () { /* retried on demand */ });
  }

  function pdfMoney(n) {
    return formatBRL(n).replace(/ /g, ' ');
  }

  function pdfFileName() {
    var slug = (state.storeName || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var date = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    return (MODE === 'pdf' ? 'minha-selecao-chumbada' : 'pedido-chumbada')
      + (slug ? '-' + slug : '') + '-' + date + '.pdf';
  }

  function buildPdfDoc() {
    var doc = new window.jspdf.jsPDF();
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var left = 14;
    var right = pageW - 14;
    var top = 18;
    var bottom = pageH - 18;
    var y = top;

    function ensureSpace(h) {
      if (y + h > bottom) {
        doc.addPage();
        y = top;
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(0);
    doc.text(MODE === 'pdf' ? 'Minha Seleção — Chumbada Oficial' : 'Pedido — Chumbada Oficial', left, y);
    y += 8;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text('Gerado em ' + new Date().toLocaleDateString('pt-BR'), left, y);
    y += 6;
    if (state.storeName) {
      var nameLines = doc.splitTextToSize((MODE === 'pdf' ? 'Nome: ' : 'Cliente / loja: ') + state.storeName, right - left);
      doc.text(nameLines, left, y);
      y += nameLines.length * 5 + 1;
    }
    doc.setTextColor(0);
    y += 4;

    var total = 0;
    var groups = groupByCatalog(state.items);
    CATALOG_ORDER.forEach(function (cat) {
      var list = groups[cat];
      if (!list || !list.length) return;

      ensureSpace(16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(0);
      doc.text(CATALOG_LABELS[cat], left, y);
      y += 7;

      var subtotal = 0;
      list.forEach(function (it, idx) {
        var lineTotal = it.qty * it.unitPrice;
        subtotal += lineTotal;

        var title = (idx + 1) + '. ' + it.name + (it.variant ? ' — ' + it.variant : '');
        var maxW = right - (left + 2) - (SHOW_PRICE ? 34 : 0);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        var titleLines = doc.splitTextToSize(title, maxW);
        ensureSpace(titleLines.length * 5 + 9);

        doc.setTextColor(0);
        doc.text(titleLines, left + 2, y);
        if (SHOW_PRICE) {
          doc.setFont('helvetica', 'bold');
          doc.text(pdfMoney(lineTotal), right, y, { align: 'right' });
          doc.setFont('helvetica', 'normal');
        }
        y += titleLines.length * 5;

        var parts = ['Qtd: ' + it.qty];
        if (cleanSku(it.sku)) parts.push('SKU: ' + cleanSku(it.sku));
        if (SHOW_PRICE) parts.push(pdfMoney(it.unitPrice) + ' un.');
        doc.setTextColor(110);
        doc.text(parts.join('   |   '), left + 4, y);
        y += 7;
      });

      if (SHOW_PRICE) {
        ensureSpace(10);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(0);
        doc.text('Subtotal ' + CATALOG_LABELS[cat], left, y);
        doc.text(pdfMoney(subtotal), right, y, { align: 'right' });
        y += 9;
        total += subtotal;
      } else {
        y += 2;
      }
    });

    if (SHOW_PRICE) {
      ensureSpace(16);
      doc.setDrawColor(200);
      doc.line(left, y, right, y);
      y += 8;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(0);
      doc.text('TOTAL GERAL', left, y);
      doc.text(pdfMoney(total), right, y, { align: 'right' });
    }

    var pages = doc.getNumberOfPages();
    for (var p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(150);
      doc.text('chumbada.com.br', left, pageH - 10);
      doc.text('Página ' + p + ' de ' + pages, right, pageH - 10, { align: 'right' });
    }

    return doc;
  }

  function makePdf() {
    return { blob: buildPdfDoc().output('blob'), name: pdfFileName() };
  }

  function triggerDownload(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
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

  function pdfFailed() {
    showToast('Não deu pra gerar o PDF agora, tenta de novo.');
  }

  // Runs fn right away when jsPDF is already loaded (keeps the tap's share
  // permission intact); otherwise loads it first.
  function runWithJsPdf(fn) {
    function safe() {
      try { fn(); } catch (e) { pdfFailed(); }
    }
    if (window.jspdf && window.jspdf.jsPDF) safe();
    else loadJsPdf().then(safe).catch(pdfFailed);
  }

  function downloadPdf() {
    runWithJsPdf(function () {
      var pdf = makePdf();
      triggerDownload(pdf.blob, pdf.name);
      showToast('PDF baixado!');
    });
  }

  // No share sheet with file support (most desktop browsers): download the
  // PDF and open the salesperson's chat so the customer can attach it.
  function shareFallback(pdf) {
    triggerDownload(pdf.blob, pdf.name);
    showToast('PDF baixado! Anexe ele na conversa do WhatsApp que vai abrir.', 5000);
    openLink('https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent('Olá! Segue meu pedido em PDF (em anexo).'));
  }

  function sharePdf() {
    runWithJsPdf(function () {
      var pdf = makePdf();
      var data = null;
      try {
        data = { files: [new File([pdf.blob], pdf.name, { type: 'application/pdf' })], title: 'Pedido Chumbada Oficial' };
      } catch (e) { /* File constructor unavailable */ }

      if (data && navigator.share && navigator.canShare && navigator.canShare(data)) {
        navigator.share(data).catch(function (err) {
          if (err && err.name === 'AbortError') return; // customer closed the share sheet
          shareFallback(pdf);
        });
      } else {
        shareFallback(pdf);
      }
    });
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
    renderFab();
    renderBackToHub();
    call('GET_STATE', {});
    checkHash();
    window.addEventListener('hashchange', checkHash);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
