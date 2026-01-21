(() => {
  const cfg = window.APP_CONFIG || {};
  const API = (cfg.API_BASE_URL && String(cfg.API_BASE_URL).trim()) || "/api/pedidos";
  const API_KEY = (cfg.API_KEY && String(cfg.API_KEY).trim()) || "";

  const els = {
    headerImg: document.getElementById("header-img"),
    headerImgSide: document.getElementById("header-img-side"),
    status: document.getElementById("conn-status"),
    statusSide: document.getElementById("conn-status-side"),
    catalogo: document.getElementById("catalogo"),
    resumenList: document.getElementById("resumen-list"),
    resumenTotal: document.getElementById("resumen-total"),
    btnConfirmar: document.getElementById("btn-confirmar"),
    sheet: document.getElementById("auth-sheet"),
    btnCancelar: document.getElementById("btn-cancelar"),
    btnEnviar: document.getElementById("btn-enviar"),
    dni: document.getElementById("dni"),
    clave: document.getElementById("clave"),
    comentarios: document.getElementById("comentarios"),
    toast: document.getElementById("toast"),
    closed: document.getElementById("closed"),
    closedTitle: document.getElementById("closed-title"),
    closedMsg: document.getElementById("closed-msg"),
    closedWA: document.getElementById("closed-wa"),
    app: document.getElementById("app"),
    fpTransf: document.getElementById("fp_transf"),
    fpEfect: document.getElementById("fp_efectivo"),
    tkt: document.getElementById("ticket"),
    tktContent: document.getElementById("ticket-content"),
    tktLogo: document.getElementById("tkt-logo"),
    tktSub: document.getElementById("tkt-sub"),
    tktId: document.getElementById("tkt-id"),
    tktDate: document.getElementById("tkt-date"),
    tktAlias: document.getElementById("tkt-alias"),
    tktItems: document.getElementById("tkt-items"),
    tktTotal: document.getElementById("tkt-total"),
    tktNote: document.getElementById("tkt-note"),
    tktSave: document.getElementById("tkt-save"),
    tktPdf: document.getElementById("tkt-pdf"),
    tktClose: document.getElementById("tkt-close"),
    tktCopyAlias: document.getElementById("tkt-copy-alias"),
    tktZone: document.getElementById("tkt-zone"),

    alertModal: document.getElementById("alert-modal"),
    alertTitle: document.getElementById("alert-title"),
    alertMsg: document.getElementById("alert-msg"),
    alertClose: document.getElementById("alert-close"),
    alertWA: document.getElementById("alert-wa"),
  };

  const state = {
    config: {},
    formEnabled: true,
    catalogo: [],
    cart: new Map(),
    cartTouchedAt: 0,
    lastSendAt: 0,
    activeSendNonce: null,
  };

  // ---- blindaje: timeout de envío (evita 'Enviando…' infinito) ----
  const SEND_TIMEOUT_MS = 25000;

  // ---- reset diario (evita "carrito de ayer") ----
  const DAY_KEY = "amaranta:lastDay";
  function todayKey(){
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const day = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  }
  function ensureFreshDay(silent=false){
    try{
      const t = todayKey();
      const last = localStorage.getItem(DAY_KEY);
      if (last && last !== t){
        resetAfterSend(true);
        if (!silent) toast("Carrito reiniciado (nuevo día) ✓");
      }
      localStorage.setItem(DAY_KEY, t);
    } catch {}
  }



  // ---- expiración de carrito (evita que quede cargado horas) ----
  const CART_KEY = "amaranta:cart:v1";
  const CART_TS_KEY = "amaranta:cart_ts:v1";

  function getCartTtlMin(){
    // Default pedido por Iván: 5 minutos
    const v = Number(state.config.CART_TTL_MIN ?? 5);
    return Number.isFinite(v) && v > 0 ? v : 5;
  }

  function clearStoredCart(){
    try { localStorage.removeItem(CART_KEY); localStorage.removeItem(CART_TS_KEY); } catch {}
  }

  // ⚠️ IMPORTANTE: Iván pidió que el carrito NO persista al refrescar.
  // Por eso dejamos las keys solo para limpiar residuos de versiones anteriores,
  // pero NO guardamos ni re-cargamos carrito desde storage.
  function saveCart(){ /* no-op */ }
  function loadCartIfFresh(){ /* no-op */ }

  function touchCart(){
    state.cartTouchedAt = Date.now();
    saveCart();
  }

  function clearCart(reasonToast){
    if (state.cart.size === 0) return;
    state.cart.clear();
    clearStoredCart();
    renderCatalogo();
    renderResumen();
    if (reasonToast) toast(reasonToast);
  }

  function checkCartExpiry(silent=false){
    if (state.cart.size === 0) return;
    const ts = state.cartTouchedAt || 0;
    if (!ts) return;
    const age = Date.now() - ts;
    if (age > getCartTtlMin() * 60 * 1000) {
      closeSheet();
      clearCart(silent ? "" : "Carrito vencido. Armalo de nuevo 🙂");
    }
  }
  async function fetchJsonSafe(url, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (API_KEY) headers["X-API-Key"] = API_KEY;

    const res = await fetch(url, Object.assign({}, opts, { headers }));
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const text = await res.text();

    let json = null;
    if (ct.includes("application/json")) {
      try { json = JSON.parse(text); } catch {}
    }

    if (!res.ok) {
      const code = json?.error || `HTTP_${res.status}`;
      const msg = json?.message || json?.error || `HTTP ${res.status}`;
      const hint = ct.includes("application/json") ? "" : " (parece HTML/404/500)";
      const e = new Error(`${msg}${hint}`);
      e.code = code;
      e.status = res.status;
      e.data = json; // ✅ importante para leer existingOrder en duplicados
      throw e;
    }

    if (!json) {
      const e = new Error("La API respondió algo que NO es JSON.");
      e.code = "BAD_RESPONSE";
      throw e;
    }

    return json;
  }

  function setStatus(msg){
    if (els.status) els.status.textContent = msg;
    if (els.statusSide) els.statusSide.textContent = msg;
  }
  
  let _toastTimer = null;
  function toast(msg, hold=false){
    if (!els.toast) return;

    // compat: hold=true -> más tiempo, pero SIEMPRE se cierra solo
    let duration = 2600;
    if (typeof hold === "number") duration = hold;
    else if (hold === true) duration = 4200;

    els.toast.textContent = msg;
    els.toast.classList.add("show");

    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      els.toast.classList.remove("show");
    }, duration);
  }
  function fmtMoney(n){
    try { return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n || 0); }
    catch { return String(n); }
  }
  function normalizeImageUrl(u){
    if (!u) return "";
    u = String(u).trim();
    let m = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;
    m = u.match(/drive\.google\.com\/open\?id=([^&]+)/);
    if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;
    if (/drive\.google\.com\/uc\?/.test(u)) return u;
    return u;
  }

  function applyTheme(){
    const t = state.config.THEME || {};
    const root = document.documentElement;

    if (t.PRIMARY) root.style.setProperty("--primary", t.PRIMARY);
    if (t.SECONDARY) root.style.setProperty("--secondary", t.SECONDARY);
    if (t.BG) root.style.setProperty("--bg", t.BG);
    if (t.TEXT) root.style.setProperty("--text", t.TEXT);
    if (t.RADIUS != null) root.style.setProperty("--radius", t.RADIUS + "px");
    if (t.SPACING != null) root.style.setProperty("--space", t.SPACING + "px");

    const headerUrlMobile = state.config.ASSET_HEADER_URL ? String(state.config.ASSET_HEADER_URL).trim() : "";
    const headerUrlDesktop = state.config.ASSET_HEADER_DESKTOP_URL
      ? String(state.config.ASSET_HEADER_DESKTOP_URL).trim()
      : headerUrlMobile;

    if (els.headerImg) {
      if (headerUrlMobile) { els.headerImg.src = headerUrlMobile; els.headerImg.style.display = "block"; }
      else { els.headerImg.src = ""; els.headerImg.style.display = "none"; }
    }
    if (els.headerImgSide) {
      if (headerUrlDesktop) { els.headerImgSide.src = headerUrlDesktop; els.headerImgSide.style.display = "block"; }
      else { els.headerImgSide.src = ""; els.headerImgSide.style.display = "none"; }
    }

    const logoUrl = state.config.ASSET_LOGO_URL ? String(state.config.ASSET_LOGO_URL).trim() : "";
    if (els.tktLogo) {
      if (logoUrl) {
        els.tktLogo.crossOrigin = "anonymous";
        els.tktLogo.referrerPolicy = "no-referrer";
        els.tktLogo.src = logoUrl;
        els.tktLogo.style.display = "block";
      } else {
        els.tktLogo.src = "";
        els.tktLogo.style.display = "none";
      }
    }
  }

  function openWhatsApp(msg){
    const raw = String(state.config.WA_PHONE_TARGET || "").trim();
    const phone = raw.replace(/[^\d]/g, "");
    if (!phone) return;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
  }

  function applyCommentsPolicy(){
    const enabled = !!state.config.COMMENTS_ENABLED;
    const field = els.comentarios?.closest?.(".field");
    if (!field) return;
    field.style.display = enabled ? "flex" : "none";
    if (!enabled && els.comentarios) els.comentarios.value = "";
  }

  function openAlertModal({ title, msg, waMsg }){
    if (!els.alertModal) return;
    if (els.alertTitle) els.alertTitle.textContent = title || "Aviso";
    if (els.alertMsg) els.alertMsg.textContent = msg || "";

    const canWA = state.config.WA_ENABLED && String(state.config.WA_PHONE_TARGET || "").trim();
    if (els.alertWA) {
      if (canWA && waMsg) {
        els.alertWA.classList.remove("hidden");
        els.alertWA.onclick = () => openWhatsApp(waMsg);
      } else {
        els.alertWA.classList.add("hidden");
        els.alertWA.onclick = null;
      }
    }
    els.alertModal.classList.remove("hidden");
  }

  function closeAlertModal(){
    if (!els.alertModal) return;
    els.alertModal.classList.add("hidden");
  }

  function setClosedUI(isClosed){
    if (isClosed) {
      state.formEnabled = false;
      els.app.classList.add("hidden");
      els.closed.classList.remove("hidden");
      els.closedTitle.textContent = state.config.FORM_CLOSED_TITLE || "Pedidos temporalmente cerrados";
      els.closedMsg.textContent = state.config.FORM_CLOSED_MESSAGE || "Estamos atendiendo por WhatsApp.";
      setStatus("Formulario cerrado");

      const canWA = state.config.WA_ENABLED && String(state.config.WA_PHONE_TARGET || "").trim();
      if (canWA) {
        els.closedWA.classList.remove("hidden");
        els.closedWA.onclick = () => {
          const msg = `${els.closedTitle.textContent}\n${els.closedMsg.textContent}`;
          openWhatsApp(msg);
        };
      } else {
        els.closedWA.classList.add("hidden");
        els.closedWA.onclick = null;
      }

      resetAfterSend(true);
    } else {
      state.formEnabled = true;
      els.closed.classList.add("hidden");
      els.app.classList.remove("hidden");
    }
  }

  async function refreshConfigOnly(){
    const conf = await fetchJsonSafe(`${API}?route=ui-config`);
    state.config = {
      THEME: {
        PRIMARY: conf.THEME_PRIMARY,
        SECONDARY: conf.THEME_SECONDARY,
        BG: conf.THEME_BG,
        TEXT: conf.THEME_TEXT,
        RADIUS: Number(conf.RADIUS || 16),
        SPACING: Number(conf.SPACING || 8),
      },
      ASSET_HEADER_URL: conf.ASSET_HEADER_URL || "",
      ASSET_HEADER_DESKTOP_URL: conf.ASSET_HEADER_DESKTOP_URL || "",
      ASSET_LOGO_URL: conf.ASSET_LOGO_URL || "",
      ASSET_PLACEHOLDER_IMG_URL: conf.ASSET_PLACEHOLDER_IMG_URL || "",
      FORM_ENABLED: String(conf.FORM_ENABLED || "true").toLowerCase() === "true",
      FORM_CLOSED_TITLE: conf.FORM_CLOSED_TITLE,
      FORM_CLOSED_MESSAGE: conf.FORM_CLOSED_MESSAGE,
      UI_RESUMEN_ITEMS_VISIBLES: Number(conf.UI_RESUMEN_ITEMS_VISIBLES || 4),
      UI_MAX_QTY_POR_VIANDA: Number(conf.UI_MAX_QTY_POR_VIANDA || 9),
      // Default pedido por Iván: 5 minutos
      CART_TTL_MIN: Number(conf.CART_TTL_MIN || 5),
      MSG_EMPTY: conf.MSG_EMPTY,
      MSG_AUTH_FAIL: conf.MSG_AUTH_FAIL,
      MSG_LIMIT: conf.MSG_LIMIT,
      MSG_SERVER_FAIL: conf.MSG_SERVER_FAIL,
      WA_ENABLED: String(conf.WA_ENABLED || "true").toLowerCase() === "true",
      WA_TEMPLATE: conf.WA_TEMPLATE || "",
      WA_PHONE_TARGET: conf.WA_PHONE_TARGET || "",
      COMMENTS_ENABLED: String(conf.COMMENTS_ENABLED || "false").toLowerCase() === "true",
      PAY_ALIAS: conf.PAY_ALIAS || "",
      PAY_NOTE: conf.PAY_NOTE || "",
    };

    applyTheme();
    applyCommentsPolicy();
    setClosedUI(!state.config.FORM_ENABLED);
  }

  function resetAfterSend(forceCloseTicket=false){
    if (els.dni) els.dni.value = "";
    if (els.clave) els.clave.value = "";
    if (els.comentarios) els.comentarios.value = "";

    if (els.fpTransf) els.fpTransf.checked = true;
    if (els.fpEfect) els.fpEfect.checked = false;

    if (els.sheet) els.sheet.classList.add("hidden");

    state.cart.clear();
    state.cartTouchedAt = 0;
    clearStoredCart();
    renderCatalogo();
    renderResumen();

    if (forceCloseTicket && els.tkt) els.tkt.classList.add("hidden");

  }

  function getFormaPagoSelected(){
    if (els.fpEfect && els.fpEfect.checked) return "efectivo";
    return "transferencia";
  }

  function buildControls(v, current){
    const frag = document.createDocumentFragment();
    if (current === 0) {
      const plus = document.createElement("button");
      plus.className = "plus";
      plus.textContent = "+";
      plus.addEventListener("click", () => updateQty(v, 1));
      frag.appendChild(plus);
      return frag;
    }
    const pill = document.createElement("div");
    pill.className = "qty";

    const minusBtn = document.createElement("button"); minusBtn.textContent = "–";
    const n = document.createElement("span"); n.className = "n"; n.textContent = current;
    const plusBtn = document.createElement("button"); plusBtn.textContent = "+";

    minusBtn.addEventListener("click", () => updateQty(v, current - 1));
    plusBtn.addEventListener("click", () => updateQty(v, current + 1));

    pill.append(minusBtn, n, plusBtn);
    frag.appendChild(pill);
    return frag;
  }

  function buildCard(v){
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = v.IdVianda;

    const imgBox = document.createElement("div");
    imgBox.className = "card-img";

    const img = document.createElement("img");
    img.alt = v.Nombre;
    img.loading = "lazy";
    img.decoding = "async";

    const placeholder = state.config.ASSET_PLACEHOLDER_IMG_URL || (window.location.origin + "/assets/placeholder.png");
    const src = normalizeImageUrl(v.Imagen);
    img.src = src || placeholder;
    img.onerror = () => { img.src = placeholder; };
    imgBox.appendChild(img);

    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = v.Nombre;

    const desc = document.createElement("div");
    desc.className = "card-desc";
    desc.textContent = v.Descripcion || "";

    const bottom = document.createElement("div");
    bottom.className = "card-bottom";

    const price = document.createElement("div");
    price.className = "card-price";
    price.textContent = "$ " + fmtMoney(v.Precio);

    const controlsBox = document.createElement("div");
    const current = state.cart.get(v.IdVianda)?.cantidad || 0;
    controlsBox.appendChild(buildControls(v, current));

    bottom.append(price, controlsBox);
    body.append(title, desc, bottom);
    card.append(imgBox, body);
    return card;
  }

  function renderCatalogo(){
    els.catalogo.innerHTML = "";
    if (!state.catalogo.length) {
      const empty = document.createElement("div");
      empty.className = "resumen-empty";
      empty.textContent = state.config.MSG_EMPTY || "No hay viandas disponibles por ahora.";
      els.catalogo.appendChild(empty);
      return;
    }
    for (const v of state.catalogo) els.catalogo.appendChild(buildCard(v));
  }

  function renderResumen(){
    els.resumenList.innerHTML = "";
    let total = 0;
    const items = Array.from(state.cart.values());
    items.forEach(it => total += it.precio * it.cantidad);

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "resumen-empty";
      empty.textContent = "Carrito vacío";
      els.resumenList.appendChild(empty);
    } else {
      const max = Number(state.config.UI_RESUMEN_ITEMS_VISIBLES || 4);
      items.slice(0, max).forEach(it => {
        const row = document.createElement("div");
        row.className = "resumen-item";

        const left = document.createElement("div");
        left.className = "resumen-left";
        left.textContent = `${it.cantidad}× ${it.nombre}`;

        const right = document.createElement("div");
        right.className = "resumen-right";
        right.textContent = "$ " + fmtMoney(it.precio * it.cantidad);

        row.append(left, right);
        els.resumenList.appendChild(row);
      });
    }

    els.resumenTotal.textContent = "$ " + fmtMoney(total);
    els.btnConfirmar.disabled = total <= 0 || !state.formEnabled;
  }

  function patchCardControls(id, v, n){
    const card = els.catalogo.querySelector(`[data-id="${id}"]`);
    if (!card) return;
    const bottom = card.querySelector(".card-bottom");
    if (!bottom) return;

    const oldControls = bottom.lastElementChild;
    const newControls = buildControls(v, n);
    if (oldControls) bottom.replaceChild(newControls, oldControls);
    else bottom.appendChild(newControls);
  }

  function updateQty(v, n){
    const max = Number(state.config.UI_MAX_QTY_POR_VIANDA || 9);
    n = Math.max(0, Math.min(max, n));

    if (n === 0) state.cart.delete(v.IdVianda);
    else state.cart.set(v.IdVianda, { id: v.IdVianda, nombre: v.Nombre, precio: Number(v.Precio), cantidad: n });

    if (state.cart.size === 0) { state.cartTouchedAt = 0; clearStoredCart(); }
    else touchCart();

    patchCardControls(v.IdVianda, v, n);
    renderResumen();
  }

  function openSheet(){
    ensureFreshDay(true);
    checkCartExpiry(false);
    if (!state.formEnabled) {
      toast("Pedidos cerrados.");
      return;
    }
    els.sheet.classList.remove("hidden");
  }
  function closeSheet(){ els.sheet.classList.add("hidden"); }
  function resetSheetForm(opts={}){
    const { close = true } = opts;
    if (els.dni) els.dni.value = "";
    if (els.clave) els.clave.value = "";
    if (els.comentarios) els.comentarios.value = "";
    if (els.fpTransf) els.fpTransf.checked = true;
    if (els.fpEfect) els.fpEfect.checked = false;
    if (close) closeSheet();
  }
  function closeTicket(){
    els.tkt.classList.add("hidden");
    resetAfterSend(false);
  }

  function setAuthDisabled(disabled){
    // Evita que el usuario cambie DNI/clave mientras el request está en vuelo
    // (blindaje contra respuestas tardías que podrían mostrar un ticket equivocado).
    const list = [
      els.dni, els.clave, els.fpTransf, els.fpEfect, els.comentarios,
      els.btnCancelar, els.btnEnviar
    ];
    for (const el of list) {
      if (!el) continue;
      el.disabled = !!disabled;
    }
  }

  function buildReceiptText(order){
    const lines = [];
    lines.push("Pedido confirmado ✅");
    if (order.dni) lines.push(`DNI: ${order.dni}`);
    lines.push(`N° Pedido: ${order.idPedido}`);
    lines.push(`Fecha: ${order.fecha}`);
    if (order.formaPago) lines.push(`Pago: ${order.formaPago}`);
    if (order.zonaMensaje) lines.push(order.zonaMensaje);
    if (order.payAlias) lines.push(`Alias: ${order.payAlias}`);
    if (order.payNote) lines.push(String(order.payNote));
    lines.push("");
    lines.push("Detalle:");
    for (const it of (order.items || [])) {
      lines.push(`- ${it.cantidad}× ${it.nombre} ($ ${fmtMoney(it.precio * it.cantidad)})`);
    }
    lines.push("");
    lines.push(`Total: $ ${fmtMoney(order.total)}`);
    return lines.join("\n");
  }

  function openWhatsAppText(text){
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank", "noopener");
  }

  function openTicket(order){
    if (els.tktSub) {
      const dniLine = order.dni ? `DNI: ${order.dni}` : "";
      els.tktSub.textContent = dniLine;
    }
    els.tktId.textContent = order.idPedido;
    els.tktDate.textContent = order.fecha;

    const alias = String((order.payAlias || state.config.PAY_ALIAS || "—") ?? "—").trim() || "—";
    els.tktAlias.textContent = alias;

    if (els.tktCopyAlias) {
      const canCopy = alias && alias !== "—";
      els.tktCopyAlias.disabled = !canCopy;
      els.tktCopyAlias.onclick = () => {
        if (!canCopy) return;
        const cb = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText.bind(navigator.clipboard) : null;
        if (!cb) { toast("No se pudo copiar"); return; }
        cb(alias).then(() => toast("Alias copiado ✓"), () => toast("No se pudo copiar"));
      };
    }

    if (els.tktZone) {
      const z = String(order.zonaMensaje || "").trim();
      if (z) {
        els.tktZone.textContent = z;
        els.tktZone.classList.remove("hidden");
      } else {
        els.tktZone.textContent = "";
        els.tktZone.classList.add("hidden");
      }
    }
    els.tktItems.innerHTML = "";
    order.items.forEach(it => {
      const row = document.createElement("div");
      row.className = "tkt-row";

      const left = document.createElement("div");
      left.className = "tkt-left";
      left.textContent = `${it.cantidad}× ${it.nombre}`;

      const right = document.createElement("div");
      right.className = "tkt-right";
      right.textContent = "$ " + fmtMoney(it.precio * it.cantidad);

      row.append(left, right);
      els.tktItems.appendChild(row);
    });

    els.tktTotal.textContent = "$ " + fmtMoney(order.total);

    const note = (order.payNote || state.config.PAY_NOTE || "").trim();
    els.tktNote.textContent = note;

    els.tkt.classList.remove("hidden");
    if (els.tktClose) els.tktClose.onclick = closeTicket;

    if (els.tktSave) {
      els.tktSave.onclick = () => {
        try {
          const txt = buildReceiptText(order);
          openWhatsAppText(txt);
          toast("Abriendo WhatsApp…");
        } catch {
          toast("No se pudo abrir WhatsApp");
        }
      };
    }

    if (els.tktPdf) {
      els.tktPdf.onclick = () => {
        try {
          window.print();
        } catch {
          toast("No se pudo abrir 'Guardar PDF'");
        }
      };
    }
  }

  async function loadCatalogo(){
    setStatus("Cargando catálogo…");
    const data = await fetchJsonSafe(`${API}?route=viandas`);
    state.catalogo = Array.isArray(data.items) ? data.items.slice() : [];
    renderCatalogo();
    setStatus("Catálogo actualizado ✓");
  }

  async function enviarPedido(){
    try { await refreshConfigOnly(); } catch {}

    ensureFreshDay(true);
    checkCartExpiry(false);

    // Blindaje: si ya hay un envío en curso, no disparamos otro
    if (state.activeSendNonce) { toast("Ya estamos procesando tu pedido…", true); return; }

    if (!state.formEnabled) {
      toast("Pedidos cerrados.");
      return;
    }

    const dni = els.dni.value.trim();
    const clave = els.clave.value.trim();
    const comentarios = state.config.COMMENTS_ENABLED ? els.comentarios.value.trim() : "";
    const formaPago = getFormaPagoSelected();

    if (!/^\d{7,8}$/.test(dni)) { toast("DNI inválido."); resetSheetForm({ close:false }); if (els.dni) els.dni.focus(); return; }
    if (!clave) { toast("Ingresá tu clave."); if (els.clave) { els.clave.value = ""; els.clave.focus(); } return; }

    const cartItems = Array.from(state.cart.values());
    if (!cartItems.length) { toast("Tu carrito está vacío."); resetSheetForm(); return; }

    if (Date.now() - state.lastSendAt < 1200) { toast("Pará un toque…"); return; }
    state.lastSendAt = Date.now();

    const dniSent = dni;
    const nonce = (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function")
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    state.activeSendNonce = nonce;

    setAuthDisabled(true);
    els.btnEnviar.textContent = "Enviando…";

    let controller = null;
    let timeoutId = null;

    try {
      const payloadItems = cartItems.map(it => ({ idVianda: it.id, nombre: it.nombre, cantidad: it.cantidad }));

      // Timeout opcional: evita que el envío quede colgado indefinidamente
      if (typeof AbortController !== "undefined") {
        controller = new AbortController();
        timeoutId = setTimeout(() => {
          try { controller.abort(); } catch {}
        }, SEND_TIMEOUT_MS);
      }

      const data = await fetchJsonSafe(`${API}?route=pedido`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({
          dni, clave, comentarios,
          formaPago,
          items: payloadItems
        })
      });

      // Blindaje: si llega una respuesta tarde de un envío anterior, la ignoramos.
      if (state.activeSendNonce !== nonce) return;

      const id = data.idPedido;
      const totalServer = Number(data.total);
      const total = Number.isFinite(totalServer)
        ? totalServer
        : cartItems.reduce((acc, it) => acc + it.precio * it.cantidad, 0);

      const formaPagoNice = data.formaPago || (formaPago === "efectivo" ? "Efectivo" : "Transferencia");
      const zonaMensaje = (data.zonaMensaje || "").toString().trim();

      const payAlias = (data.payAlias || "").toString().trim();
      const payNote  = (data.payNote  || "").toString().trim();

      resetAfterSend(false);

      const order = {
        dni: dniSent,
        idPedido: id,
        items: cartItems.map(x => ({ nombre:x.nombre, cantidad:x.cantidad, precio:x.precio })),
        total,
        formaPago: formaPagoNice,
        zonaMensaje,
        payAlias,
        payNote,
        fecha: new Date().toLocaleString("es-AR", { hour:"2-digit", minute:"2-digit", day:"2-digit", month:"2-digit", year:"2-digit" })
      };

      openTicket(order);

    } catch (e) {
      if (state.activeSendNonce !== nonce) return;

      // Timeout / abort (red lenta, se queda 'Enviando…')
      if (e && (e.name === "AbortError" || e.code === "ABORTED")) {
        toast("La conexión tardó demasiado. Probá de nuevo.", true);
        resetSheetForm();
        return;
      }

      if (e.code === "FORM_CLOSED") {
        toast("Pedidos cerrados.", true);
        resetSheetForm();
        try { await refreshConfigOnly(); } catch {}
        return;
      }
      if (e.code === "ZONA_CERRADA") {
        toast("En tu zona ya cerró la toma de pedidos por hoy 🙂", true);
        resetSheetForm();
        return;
      }
      if (e.code === "AUTH_FAIL") {
        toast(state.config.MSG_AUTH_FAIL || "DNI o clave incorrectos.", true);
        resetSheetForm();
        return;
      }

      // ✅ Bloqueo por demasiados intentos con el mismo DNI
      if (e.code === "DNI_BLOCKED" || e.code === "RATE_LIMIT") {
        const sec = Number(e.data?.retryAfterSeconds || 0);
        const min = sec > 0 ? Math.ceil(sec / 60) : 15;
        toast(`Demasiados intentos. Esperá ${min} min y probá de nuevo 🙂`, true);
        resetSheetForm();
        return;
      }

      // ✅ DUPLICADO: ya hay pedido para ese DNI hoy -> no mostramos ticket (evita confusión)
      if (e.code === "DNI_ALREADY_ORDERED") {
        const msg = "Ya tenés un pedido en proceso o registrado hoy con este DNI.\n\nSi necesitás cambiarlo o consultar algo, escribinos por WhatsApp 🙂";
        const waMsg = `Hola! Quiero consultar/modificar un pedido. Me figura que ya tengo un pedido hoy. DNI: ${dni}`;
        openAlertModal({ title: "Ya tenés un pedido hoy", msg, waMsg });
        resetSheetForm();
        return;
      }

      // ✅ Procesando: la persona apretó varias veces / lock tomado
      if (e.code === "ORDER_PROCESSING") {
        const msg = "Ya estamos procesando tu pedido.\n\nEsperá unos segundos y revisá si te aparece el comprobante.\nSi no aparece, escribinos por WhatsApp.";
        const waMsg = `Hola! Intenté hacer un pedido y me figura "Procesando". DNI: ${dni}`;
        openAlertModal({ title: "Pedido en proceso", msg, waMsg });
        resetSheetForm();
        return;
      }

      // UX más amable si viene un HTTP crudo
      if (String(e.code || "").startsWith("HTTP_")) {
        toast("No pudimos conectar. Probá recargar en unos segundos.", true);
        resetSheetForm();
        return;
      }

      toast(state.config.MSG_SERVER_FAIL || `No pudimos completar el pedido (${e.message}).`, true);
      resetSheetForm();
    } finally {
      if (timeoutId) { try { clearTimeout(timeoutId); } catch {} timeoutId = null; }

      // Solo re-habilitamos si este envío sigue siendo el "activo".
      if (state.activeSendNonce === nonce) {
        state.activeSendNonce = null;
        setAuthDisabled(false);
        els.btnEnviar.disabled = false;
        els.btnEnviar.textContent = "Enviar";
      }
    }
  }

  // Events
  els.btnConfirmar.addEventListener("click", openSheet);
  els.btnCancelar.addEventListener("click", closeSheet);
  els.btnEnviar.addEventListener("click", enviarPedido);
  if (els.alertClose) els.alertClose.addEventListener("click", closeAlertModal);

  els.sheet.addEventListener("click", (e) => {
    if (state.activeSendNonce) return;
    if (e.target === els.sheet) closeSheet();
  });
  // Ticket NO se cierra tocando el fondo; solo con el botón "Cerrar".

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (els.alertModal && !els.alertModal.classList.contains("hidden")) return;
    if (state.activeSendNonce) return;
    if (!els.sheet.classList.contains("hidden")) closeSheet();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      ensureFreshDay(true);
      checkCartExpiry(false);
    }
  });

  // Boot
  (async function boot(){
    // Iván pidió que el carrito NO persista al refrescar
    clearStoredCart();
    ensureFreshDay(true);
    checkCartExpiry(false);
    renderResumen();

    if (els.toast) {
      els.toast.addEventListener("click", () => els.toast.classList.remove("show"));
    }

    try {
      await refreshConfigOnly();
      if (state.formEnabled) await loadCatalogo();
      renderResumen();
      setStatus("Listo ✓");
    } catch (e) {
      console.error("BOOT ERROR:", e);
      setStatus("Sin conexión");
      toast("No pudimos conectar. Probá recargar en unos segundos.", true);
    }
  })();

  setInterval(() => {
    refreshConfigOnly().catch(() => {});
  }, 30000);
  setInterval(() => {
    checkCartExpiry(true);
  }, 30000);
})();
