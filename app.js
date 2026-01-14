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
    // FormaPago (radio)
    fpTransf: document.getElementById("fp_transf"),
    fpEfect: document.getElementById("fp_efectivo"),
    // Ticket
    tkt: document.getElementById("ticket"),
    tktContent: document.getElementById("ticket-content"),
    tktLogo: document.getElementById("tkt-logo"),
    tktId: document.getElementById("tkt-id"),
    tktDate: document.getElementById("tkt-date"),
    tktAlias: document.getElementById("tkt-alias"),
    tktItems: document.getElementById("tkt-items"),
    tktTotal: document.getElementById("tkt-total"),
    tktNote: document.getElementById("tkt-note"),
    tktSave: document.getElementById("tkt-save"),
    tktClose: document.getElementById("tkt-close"),
  };

  const state = {
    config: {},
    formEnabled: true,
    catalogo: [],
    cart: new Map(),
    lastSendAt: 0,
  };

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
  function toast(msg, hold=false){
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    if (!hold) setTimeout(() => els.toast.classList.remove("show"), 2200);
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

      // si se cerró mientras estaban operando, limpiamos todo
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
      MSG_EMPTY: conf.MSG_EMPTY,
      MSG_AUTH_FAIL: conf.MSG_AUTH_FAIL,
      MSG_LIMIT: conf.MSG_LIMIT,
      MSG_SERVER_FAIL: conf.MSG_SERVER_FAIL,
      WA_ENABLED: String(conf.WA_ENABLED || "true").toLowerCase() === "true",
      WA_TEMPLATE: conf.WA_TEMPLATE || "",
      WA_PHONE_TARGET: conf.WA_PHONE_TARGET || "",
      PAY_ALIAS: conf.PAY_ALIAS || "",
      PAY_NOTE: conf.PAY_NOTE || "",
    };

    applyTheme();
    setClosedUI(!state.config.FORM_ENABLED);
  }

  // --- Reset fuerte post-envío ---
  function resetAfterSend(forceCloseTicket=false){
    if (els.dni) els.dni.value = "";
    if (els.clave) els.clave.value = "";
    if (els.comentarios) els.comentarios.value = "";

    if (els.fpTransf) els.fpTransf.checked = true;
    if (els.fpEfect) els.fpEfect.checked = false;

    if (els.sheet) els.sheet.classList.add("hidden");

    state.cart.clear();
    renderCatalogo();
    renderResumen();

    if (forceCloseTicket && els.tkt) els.tkt.classList.add("hidden");
  }

  function getFormaPagoSelected(){
    if (els.fpEfect && els.fpEfect.checked) return "efectivo";
    return "transferencia";
  }

  // -------- Catálogo / carrito --------
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

    patchCardControls(v.IdVianda, v, n);
    renderResumen();
  }

  // -------- Modales --------
  function openSheet(){
    if (!state.formEnabled) {
      toast("Pedidos cerrados.");
      return;
    }
    els.sheet.classList.remove("hidden");
  }
  function closeSheet(){ els.sheet.classList.add("hidden"); }
  function closeTicket(){
    els.tkt.classList.add("hidden");
    resetAfterSend(false);
  }

  async function waitForHtml2Canvas(){
    const start = Date.now();
    while (!window.html2canvas) {
      await new Promise(r => setTimeout(r, 100));
      if (Date.now() - start > 4000) break;
    }
    return !!window.html2canvas;
  }

  function openTicket(order){
    els.tktId.textContent = order.idPedido;
    els.tktDate.textContent = order.fecha;
    els.tktAlias.textContent = state.config.PAY_ALIAS || "—";

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

    const pm = order.formaPago || "Transferencia";
    const note = (state.config.PAY_NOTE || "").trim();
    els.tktNote.textContent = `Forma de pago: ${pm}${note ? " — " + note : ""}`;

    els.tkt.classList.remove("hidden");
    if (els.tktClose) els.tktClose.onclick = closeTicket;

    els.tktSave.onclick = async () => {
      els.tktSave.disabled = true;
      try {
        const ready = await waitForHtml2Canvas();
        if (!ready) { toast("No se pudo preparar el comprobante"); return; }

        const canvas = await window.html2canvas(els.tktContent, {
          backgroundColor:"#ffffff",
          scale:2,
          useCORS:true,
          allowTaint:false
        });

        const blob = await new Promise(r => canvas.toBlob(r, "image/png", 1));
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `pedido-${order.idPedido}.png`;
        a.click();
        URL.revokeObjectURL(url);

        toast("Imagen descargada ✓");
      } catch {
        toast("No se pudo guardar el comprobante");
      } finally {
        els.tktSave.disabled = false;
      }
    };
  }

  async function loadCatalogo(){
    setStatus("Cargando catálogo…");
    const data = await fetchJsonSafe(`${API}?route=viandas`);
    state.catalogo = Array.isArray(data.items) ? data.items.slice() : [];

    const toNum = (v) => {
      const s = String(v ?? "").trim().replace(",", ".");
      if (!s) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };
    state.catalogo.sort((a,b) => {
      const ao = toNum(a.Orden);
      const bo = toNum(b.Orden);
      if (ao != null && bo != null && ao !== bo) return ao - bo;
      if (ao != null && bo == null) return -1;
      if (ao == null && bo != null) return 1;
      return String(a.Nombre || "").localeCompare(String(b.Nombre || ""), "es", { sensitivity:"base" });
    });

    renderCatalogo();
    setStatus("Catálogo actualizado ✓");
  }

  async function enviarPedido(){
    try { await refreshConfigOnly(); } catch {}

    if (!state.formEnabled) {
      toast("Pedidos cerrados.");
      return;
    }

    const dni = els.dni.value.trim();
    const clave = els.clave.value.trim();
    const comentarios = els.comentarios.value.trim();
    const formaPago = getFormaPagoSelected();

    if (!/^\d{8}$/.test(dni) || dni.startsWith("0")) { toast("DNI inválido."); return; }
    if (!clave) { toast("Ingresá tu clave."); return; }

    const cartItems = Array.from(state.cart.values());
    if (!cartItems.length) { toast("Tu carrito está vacío."); return; }

    if (Date.now() - state.lastSendAt < 1200) { toast("Pará un toque…"); return; }
    state.lastSendAt = Date.now();

    els.btnEnviar.disabled = true;
    els.btnEnviar.textContent = "Enviando…";

    try {
      const payloadItems = cartItems.map(it => ({ idVianda: it.id, nombre: it.nombre, cantidad: it.cantidad }));

      const data = await fetchJsonSafe(`${API}?route=pedido`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({
          dni, clave, comentarios,
          formaPago,
          items: payloadItems,
          ua: navigator.userAgent
        })
      });

      const id = data.idPedido;
      const totalServer = Number(data.total);
      const total = Number.isFinite(totalServer)
        ? totalServer
        : cartItems.reduce((acc, it) => acc + it.precio * it.cantidad, 0);

      const formaPagoNice = data.formaPago || (formaPago === "efectivo" ? "Efectivo" : "Transferencia");

      resetAfterSend(false);

      const order = {
        idPedido: id,
        items: cartItems.map(x => ({ nombre:x.nombre, cantidad:x.cantidad, precio:x.precio })),
        total,
        formaPago: formaPagoNice,
        fecha: new Date().toLocaleString("es-AR", { hour:"2-digit", minute:"2-digit", day:"2-digit", month:"2-digit", year:"2-digit" })
      };

      openTicket(order);

    } catch (e) {
      if (e.code === "FORM_CLOSED") {
        toast("Pedidos cerrados.", true);
        try { await refreshConfigOnly(); } catch {}
        return;
      }
      toast(state.config.MSG_SERVER_FAIL || `No pudimos completar el pedido (${e.message}).`, true);
    } finally {
      els.btnEnviar.disabled = false;
      els.btnEnviar.textContent = "Enviar";
    }
  }

  // Events
  els.btnConfirmar.addEventListener("click", openSheet);
  els.btnCancelar.addEventListener("click", closeSheet);
  els.btnEnviar.addEventListener("click", enviarPedido);

  els.sheet.addEventListener("click", (e) => { if (e.target === els.sheet) closeSheet(); });
  els.tkt.addEventListener("click", (e) => { if (e.target === els.tkt) closeTicket(); });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!els.tkt.classList.contains("hidden")) closeTicket();
    if (!els.sheet.classList.contains("hidden")) closeSheet();
  });

  // Boot + polling de cierre (cada 30s)
  (async function boot(){
    try {
      await refreshConfigOnly();
      if (state.formEnabled) await loadCatalogo();
      renderResumen();
      setStatus("Listo ✓");
    } catch (e) {
      console.error("BOOT ERROR:", e);
      setStatus(`ERROR: ${e.message || "falló la carga"}`);
      toast(`No cargó: ${e.message || "revisar API"}`, true);
    }
  })();

  setInterval(() => {
    refreshConfigOnly().catch(() => {});
  }, 30000);
})();
