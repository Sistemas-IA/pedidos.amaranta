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
    tktClose: document.getElementById("tkt-close"),
    tktCopyAlias: document.getElementById("tkt-copy-alias"),
    tktZone: document.getElementById("tkt-zone"),
    tktPayHint: document.getElementById("tkt-pay-hint"),

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

  // ---- Envío: timeout para evitar "Enviando…" infinito ----
  const SEND_TIMEOUT_MS = 25000;

  // ---- Reset diario (evita residuos de días anteriores) ----
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

  // ---- Carrito NO persiste al refrescar ----
  const CART_KEY = "amaranta:cart:v1";
  const CART_TS_KEY = "amaranta:cart_ts:v1";
  function clearStoredCart(){
    try { localStorage.removeItem(CART_KEY); localStorage.removeItem(CART_TS_KEY); } catch {}
  }

  // ---- Expiración de carrito (5 min por defecto) ----
  function getCartTtlMin(){
    const v = Number(state.config.CART_TTL_MIN ?? 5);
    return Number.isFinite(v) && v > 0 ? v : 5;
  }
  function touchCart(){
    state.cartTouchedAt = Date.now();
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

  // ---- Persistencia del ticket (5 minutos) ----
  const TICKET_KEY = "amaranta:ticket:v1";
  const TICKET_TTL_MS = 5 * 60 * 1000;

  function clearStoredTicket(){
    try { localStorage.removeItem(TICKET_KEY); } catch {}
  }
  function storeTicket(order){
    try{
      const payload = {
        v: 1,
        savedAt: Date.now(),
        expiresAt: Date.now() + TICKET_TTL_MS,
        order,
      };
      localStorage.setItem(TICKET_KEY, JSON.stringify(payload));
    } catch {}
  }
  function loadStoredTicket(){
    try{
      const raw = localStorage.getItem(TICKET_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || !p.order || !p.expiresAt) { clearStoredTicket(); return null; }
      if (Date.now() > Number(p.expiresAt)) { clearStoredTicket(); return null; }
      return p.order;
    } catch {
      clearStoredTicket();
      return null;
    }
  }

  // ---- Fetch helper ----
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
      e.data = json;
      throw e;
    }

    if (!json) {
      const e = new Error("La API respondió algo que NO es JSON.");
      e.code = "BAD_RESPONSE";
      throw e;
    }

    return json;
  }

  // ---- UI helpers ----
  function setStatus(msg){
    if (els.status) els.status.textContent = msg;
    if (els.statusSide) els.statusSide.textContent = msg;
  }

  let _toastTimer = null;
  function toast(msg, hold=false){
    if (!els.toast) return;
    if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }

    els.toast.textContent = msg;
    els.toast.classList.add("show");

    if (!hold){
      _toastTimer = setTimeout(() => {
        els.toast.classList.remove("show");
      }, 2600);
    }
  }

  function fmtMoney(n){
    const v = Number(n || 0);
    return v.toLocaleString("es-AR");
  }

  function applyTheme(conf){
    const root = document.documentElement;
    const t = conf.THEME || {};
    if (t.PRIMARY) root.style.setProperty("--primary", t.PRIMARY);
    if (t.SECONDARY) root.style.setProperty("--secondary", t.SECONDARY);
    if (t.BG) root.style.setProperty("--bg", t.BG);
    if (t.TEXT) root.style.setProperty("--text", t.TEXT);
    if (t.RADIUS != null) root.style.setProperty("--radius", `${t.RADIUS}px`);
    if (t.SPACING != null) root.style.setProperty("--space", `${t.SPACING}px`);
  }

  function setHeaderImages(){
    const url = state.config.ASSET_HEADER_URL || "";
    const urlSide = state.config.ASSET_HEADER_DESKTOP_URL || url || "";
    if (els.headerImg && url) els.headerImg.src = url;
    if (els.headerImgSide && urlSide) els.headerImgSide.src = urlSide;
  }

  function setLogo(){
    const url = state.config.ASSET_LOGO_URL || "";
    if (els.tktLogo && url) els.tktLogo.src = url;
  }

  function openAlertModal({ title, msg, waMsg }){
    if (!els.alertModal) return;
    if (els.alertTitle) els.alertTitle.textContent = title || "Aviso";
    if (els.alertMsg) els.alertMsg.textContent = msg || "";
    if (els.alertClose) els.alertClose.onclick = closeAlertModal;

    if (els.alertWA) {
      const enabled = !!waMsg;
      if (enabled) {
        els.alertWA.classList.remove("hidden");
        els.alertWA.onclick = () => openWhatsAppTarget(waMsg);
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

  // WhatsApp:
  // - Guardar comprobante: wa.me/?text= (usuario elige chat / se lo manda a sí mismo)
  // - Contacto operativo (si hay WA_PHONE_TARGET): wa.me/<target>?text=
  function openWhatsAppText(text){
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    const w = window.open(url, "_blank", "noopener");
    return !!w;
  }
  function openWhatsAppTarget(text){
    const raw = String(state.config.WA_PHONE_TARGET || "").trim();
    const phone = raw.replace(/[^\d]/g, "");
    if (!phone) return openWhatsAppText(text);
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    const w = window.open(url, "_blank", "noopener");
    return !!w;
  }

  // ---- Config + Catálogo ----
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
      CART_TTL_MIN: Number(conf.CART_TTL_MIN || 5),

      MSG_EMPTY: conf.MSG_EMPTY,
      MSG_AUTH_FAIL: conf.MSG_AUTH_FAIL,
      MSG_LIMIT: conf.MSG_LIMIT,
      MSG_SERVER_FAIL: conf.MSG_SERVER_FAIL,

      WA_ENABLED: String(conf.WA_ENABLED || "true").toLowerCase() === "true",
      WA_TEMPLATE: conf.WA_TEMPLATE || "",
      WA_PHONE_TARGET: conf.WA_PHONE_TARGET || "",

      PAY_ALIAS: String(conf.PAY_ALIAS || "").trim(),
      PAY_NOTE: String(conf.PAY_NOTE || "").trim(),

      COMMENTS_ENABLED: String(conf.COMMENTS_ENABLED || "false").toLowerCase() === "true",
    };

    state.formEnabled = !!state.config.FORM_ENABLED;

    applyTheme(state.config);
    setHeaderImages();
    setLogo();

    if (!state.formEnabled){
      if (els.closedTitle) els.closedTitle.textContent = state.config.FORM_CLOSED_TITLE || "Pedidos temporalmente cerrados";
      if (els.closedMsg) els.closedMsg.textContent = state.config.FORM_CLOSED_MESSAGE || "Estamos atendiendo por WhatsApp.";
      if (els.closed) els.closed.classList.remove("hidden");
      if (els.app) els.app.classList.add("hidden");

      if (els.closedWA){
        const enabled = state.config.WA_ENABLED;
        els.closedWA.classList.toggle("hidden", !enabled);
        if (enabled){
          els.closedWA.onclick = () => {
            const msg = state.config.WA_TEMPLATE || "Hola! Quiero hacer un pedido.";
            openWhatsAppTarget(msg);
          };
        }
      }
    } else {
      if (els.closed) els.closed.classList.add("hidden");
      if (els.app) els.app.classList.remove("hidden");
    }

    // Comentarios: si están deshabilitados, ocultamos el textarea
    if (els.comentarios){
      const enabled = !!state.config.COMMENTS_ENABLED;
      const field = els.comentarios.closest(".field");
      if (field) field.style.display = enabled ? "" : "none";
    }
  }

  async function loadCatalogo(){
    setStatus("Cargando catálogo…");
    const data = await fetchJsonSafe(`${API}?route=viandas`);
    state.catalogo = Array.isArray(data.items) ? data.items.slice() : [];
    renderCatalogo();
    setStatus("Catálogo actualizado ✓");
  }

  // ---- Render catálogo ----
  function buildControls(v, qty){
    const wrap = document.createElement("div");
    wrap.className = "qty";

    const btnMinus = document.createElement("button");
    btnMinus.type = "button";
    btnMinus.textContent = "−";
    btnMinus.onclick = () => updateQty(v, qty - 1);

    const lbl = document.createElement("div");
    lbl.textContent = String(qty || 0);

    const btnPlus = document.createElement("button");
    btnPlus.type = "button";
    btnPlus.className = "plus";
    btnPlus.textContent = "+";
    btnPlus.onclick = () => updateQty(v, qty + 1);

    wrap.append(btnMinus, lbl, btnPlus);
    return wrap;
  }

  function renderCatalogo(){
    if (!els.catalogo) return;
    els.catalogo.innerHTML = "";

    const items = Array.isArray(state.catalogo) ? state.catalogo : [];
    if (!items.length){
      const p = document.createElement("p");
      p.textContent = state.config.MSG_EMPTY || "No hay viandas disponibles por ahora.";
      els.catalogo.appendChild(p);
      return;
    }

    const placeholder = state.config.ASSET_PLACEHOLDER_IMG_URL || "";

    items.forEach(v => {
      const card = document.createElement("article");
      card.className = "card";
      card.dataset.id = v.IdVianda;

      const imgWrap = document.createElement("div");
      imgWrap.className = "card-img";
      const img = document.createElement("img");
      img.alt = v.Nombre || "Vianda";
      img.loading = "lazy";
      img.src = v.Imagen || placeholder || "";
      img.onerror = () => {
        if (placeholder && img.src !== placeholder) img.src = placeholder;
      };
      imgWrap.appendChild(img);

      const body = document.createElement("div");
      body.className = "card-body";

      const h = document.createElement("h3");
      h.className = "card-title";
      h.textContent = v.Nombre || "";

      const d = document.createElement("div");
      d.className = "card-desc";
      d.textContent = v.Descripcion || "";

      const bottom = document.createElement("div");
      bottom.className = "card-bottom";

      const price = document.createElement("div");
      price.className = "card-price";
      price.textContent = "$ " + fmtMoney(v.Precio || 0);

      const current = state.cart.get(v.IdVianda);
      const qty = current ? current.cantidad : 0;

      bottom.append(price, buildControls(v, qty));
      body.append(h, d, bottom);
      card.append(imgWrap, body);

      els.catalogo.appendChild(card);
    });
  }

  function renderResumen(){
    if (!els.resumenList) return;
    els.resumenList.innerHTML = "";

    const list = Array.from(state.cart.values());
    const total = list.reduce((acc, it) => acc + it.precio * it.cantidad, 0);

    if (!list.length){
      const p = document.createElement("div");
      p.className = "resumen-empty";
      p.textContent = "Elegí tus viandas 🙂";
      els.resumenList.appendChild(p);
    } else {
      const max = Number(state.config.UI_RESUMEN_ITEMS_VISIBLES || 4);
      const shown = list.slice(0, Math.max(1, max));
      shown.forEach(it => {
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

    if (state.cart.size === 0) {
      state.cartTouchedAt = 0;
      clearStoredCart();
    } else {
      touchCart();
    }

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

  function resetAfterSend(silent){
    // Resetea solo el formulario + carrito.
    state.cart.clear();
    state.cartTouchedAt = 0;
    clearStoredCart();
    state.activeSendNonce = null;

    renderCatalogo();
    renderResumen();

    resetSheetForm({ close:true });

    if (!silent) toast("Listo ✓");
  }

  function closeTicket(){
    els.tkt.classList.add("hidden");
    clearStoredTicket();
    resetAfterSend(true);
  }

  function setAuthDisabled(disabled){
    const list = [els.dni, els.clave, els.fpTransf, els.fpEfect, els.comentarios, els.btnCancelar, els.btnEnviar];
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
    if (order.zonaMensaje) lines.push(String(order.zonaMensaje));
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

  function openTicket(order){
    if (els.tktSub) els.tktSub.textContent = order.dni ? `DNI: ${order.dni}` : "";
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

    // Mensaje debajo del alias (idealmente viene desde la planilla en PAY_NOTE)
    // ✅ con salto de renglón y con #<IdPedido> cuando existe.
    const id = String(order.idPedido || "").trim();
    const baseNote = (order.payNote || state.config.PAY_NOTE || "").trim();

    if (els.tktPayHint) {
      let hint = baseNote;

      if (hint) {
        if (id) {
          hint = hint
            .replace(/#\s*<\s*id\s*>/gi, `#${id}`)
            .replace(/#\s*pedido\b/gi, `#${id}`);
        }
        hint = hint.replace(/WhatsApp\s+con/gi, "WhatsApp\ncon");
      } else {
        hint = id
          ? `Envianos el comprobante de pago por WhatsApp\ncon #${id} en la referencia ✨`
          : "Envanos el comprobante de pago por WhatsApp\ncon #Pedido en la referencia ✨";
      }

      els.tktPayHint.textContent = hint;
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
    (order.items || []).forEach(it => {
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

    // Nota inferior del ticket:
    // - No repetimos el mensaje de WhatsApp si ya se muestra debajo del alias.
    // - Tip siempre visible.
    const tip = "Tip: sacale una captura de pantalla a este comprobante";
    const looksLikeWhatsAppInstruction = /comprobante\s+de\s+pago|whatsapp|referencia|#\s*pedido/i.test(baseNote);
    els.tktNote.textContent = (!baseNote || looksLikeWhatsAppInstruction)
      ? tip
      : `${baseNote}\n\n${tip}`;

    els.tkt.classList.remove("hidden");

    // persistimos ticket 5 min (blindaje refresh)
    storeTicket(order);

    if (els.tktClose) els.tktClose.onclick = closeTicket;

    if (els.tktSave) {
      els.tktSave.onclick = async () => {
        const texto = buildReceiptText(order);

        let copied = false;
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(texto);
            copied = true;
          }
        } catch {}

        const opened = openWhatsAppTarget(texto);

        if (opened) {
          toast(copied ? "Comprobante copiado ✓ Abriendo WhatsApp…" : "Abriendo WhatsApp…");
          return;
        }

        if (copied) toast("Comprobante copiado ✓", true);

        openAlertModal({
          title: "No se pudo abrir WhatsApp",
          msg:
            "No se pudo abrir WhatsApp desde el navegador.\n\n" +
            (copied ? "Ya copiamos el comprobante: abrí WhatsApp y pegalo.\n\n" : "Abrí WhatsApp y copialo manualmente.\n\n") +
            "Tip: sacale una captura de pantalla a este comprobante.",
        });
      };
    }
  }

  function getFormaPagoSelected(){
    if (els.fpEfect && els.fpEfect.checked) return "efectivo";
    return "transferencia";
  }

  // ---- Enviar pedido (blindaje anti respuesta tardía) ----
  async function enviarPedido(){
    try { await refreshConfigOnly(); } catch {}

    ensureFreshDay(true);
    checkCartExpiry(false);

    if (state.activeSendNonce) {
      toast("Ya estamos procesando tu pedido…", true);
      return;
    }

    if (!state.formEnabled) {
      toast("Pedidos cerrados.");
      return;
    }

    const dni = els.dni.value.trim();
    const clave = els.clave.value.trim();
    const comentarios = state.config.COMMENTS_ENABLED ? els.comentarios.value.trim() : "";
    const formaPago = getFormaPagoSelected();

    if (!/^\d{7,8}$/.test(dni)) { toast("DNI inválido."); resetSheetForm({ close:false }); els.dni?.focus?.(); return; }
    if (!clave) { toast("Ingresá tu clave."); if (els.clave) { els.clave.value = ""; els.clave.focus(); } return; }

    const cartItems = Array.from(state.cart.values());
    if (!cartItems.length) { toast("Tu carrito está vacío."); resetSheetForm(); return; }

    if (Date.now() - state.lastSendAt < 1200) { toast("Pará un toque…"); return; }
    state.lastSendAt = Date.now();

    const nonce = (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function")
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    state.activeSendNonce = nonce;

    setAuthDisabled(true);
    els.btnEnviar.textContent = "Enviando…";

    let timer = null;
    try {
      timer = setTimeout(() => {
        if (state.activeSendNonce === nonce) {
          state.activeSendNonce = null;
          setAuthDisabled(false);
          els.btnEnviar.textContent = "Enviar";
          toast("Está tardando… Probá de nuevo.", true);
        }
      }, SEND_TIMEOUT_MS);

      const payloadItems = cartItems.map(it => ({ idVianda: it.id, nombre: it.nombre, cantidad: it.cantidad }));

      const data = await fetchJsonSafe(`${API}?route=pedido`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          dni, clave, comentarios,
          formaPago,
          items: payloadItems
        })
      });

      if (state.activeSendNonce !== nonce) return;

      const totalServer = Number(data.total);
      const total = Number.isFinite(totalServer)
        ? totalServer
        : cartItems.reduce((acc, it) => acc + it.precio * it.cantidad, 0);

      const order = {
        dni,
        idPedido: String(data.idPedido),
        fecha: new Date().toLocaleString("es-AR"),
        formaPago: data.formaPago || (formaPago === "efectivo" ? "Efectivo" : "Transferencia"),
        zonaMensaje: data.zonaMensaje || "",
        payAlias: String((data.payAlias || state.config.PAY_ALIAS || "")).trim(),
        payNote: String((data.payNote || state.config.PAY_NOTE || "")).trim(),
        items: cartItems.map(it => ({ nombre: it.nombre, cantidad: it.cantidad, precio: it.precio })),
        total,
      };

      resetSheetForm({ close:true });
      openTicket(order);

    } catch (e) {
      if (state.activeSendNonce !== nonce) return;

      if (e?.code === "DNI_ALREADY_ORDERED" && e?.data?.existingOrder) {
        const ex = e.data.existingOrder;
        openAlertModal({
          title: "Ya tenés un pedido registrado",
          msg: "Ya tenés un pedido en proceso o registrado hoy con este DNI.\n\nSi necesitás cambiarlo o consultar algo, escribinos por WhatsApp 🙂",
          waMsg: state.config.WA_TEMPLATE || "Hola! Quiero consultar un pedido.",
        });

        if (ex && ex.idPedido){
          const order = {
            dni: ex.dni || dni,
            idPedido: String(ex.idPedido),
            fecha: ex.fecha || new Date().toLocaleString("es-AR"),
            formaPago: ex.formaPago || "",
            zonaMensaje: ex.zonaMensaje || "",
            payAlias: String(ex.payAlias || state.config.PAY_ALIAS || "").trim(),
            payNote: String(ex.payNote || state.config.PAY_NOTE || "").trim(),
            items: Array.isArray(ex.items) ? ex.items.map(it => ({ nombre: it.nombre, cantidad: it.cantidad, precio: it.precio })) : [],
            total: Number(ex.total) || 0,
          };
          openTicket(order);
        }
      } else if (e?.code === "ORDER_PROCESSING") {
        openAlertModal({
          title: "Pedido en proceso",
          msg: "Ya estamos procesando tu pedido.\n\nEsperá unos segundos y revisá si te aparece el comprobante.\nSi no aparece, escribinos por WhatsApp.",
          waMsg: state.config.WA_TEMPLATE || "Hola! No me apareció el comprobante del pedido.",
        });
      } else if (e?.code === "ZONA_CERRADA") {
        toast("En tu zona ya cerró la toma de pedidos por hoy 🙂");
        resetSheetForm();
      } else if (e?.code === "AUTH_FAIL") {
        toast(state.config.MSG_AUTH_FAIL || "DNI o clave incorrectos.");
      } else if (e?.code === "FORM_CLOSED") {
        toast("Pedidos cerrados.");
        await refreshConfigOnly();
      } else {
        toast(state.config.MSG_SERVER_FAIL || "No pudimos completar el pedido. Probá más tarde.");
      }
    } finally {
      if (timer) clearTimeout(timer);
      if (state.activeSendNonce === nonce) state.activeSendNonce = null;
      setAuthDisabled(false);
      els.btnEnviar.disabled = false;
      els.btnEnviar.textContent = "Enviar";
    }
  }

  // ---- Init ----
  async function init(){
    try{
      await refreshConfigOnly();
      await loadCatalogo();
      renderResumen();

      // Si hubiera ticket guardado (últimos 5 min), lo mostramos
      const t = loadStoredTicket();
      if (t) openTicket(t);

      // chequeo carrito
      setInterval(() => checkCartExpiry(true), 8000);
      ensureFreshDay(true);

      setStatus("Listo ✓");
    } catch (e) {
      console.error(e);
      setStatus("Error al cargar.");
      toast("Error al cargar. Probá refrescar.");
    }
  }

  if (els.btnConfirmar) els.btnConfirmar.addEventListener("click", openSheet);
  if (els.btnCancelar) els.btnCancelar.addEventListener("click", () => { resetSheetForm(); });
  if (els.btnEnviar) els.btnEnviar.addEventListener("click", enviarPedido);

  init();
})();
