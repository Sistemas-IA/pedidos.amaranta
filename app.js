(() => {
  const cfg = window.APP_CONFIG || {};
  const API = cfg.API_BASE_URL;
  const API_KEY = cfg.API_KEY || "";

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
    // Ticket
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
  };

  const state = {
    config: {},
    catalogo: [],
    cart: new Map(),
    ip: null,
    lastOrder: null,
  };

  function setStatus(msg) {
    if (els.status) els.status.textContent = msg;
    if (els.statusSide) els.statusSide.textContent = msg;
  }

  // ✅ Split robusto: si el formulario está habilitado y la media query matchea, aplico split.
  function updateSplitMode() {
    const enabled = !!state.config?.FORM_ENABLED;
    const mq = window.matchMedia && window.matchMedia('(min-width: 960px) and (orientation: landscape)').matches;
    document.body.classList.toggle('split', enabled && mq);
  }

  // ===== Helpers imágenes (Drive + Blob) =====
  function normalizeImageUrl(u) {
    if (!u) return "";
    u = String(u).trim();
    let m = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;
    m = u.match(/drive\.google\.com\/open\?id=([^&]+)/);
    if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;
    if (/drive\.google\.com\/uc\?/.test(u)) return u;
    return u;
  }
  function isGoogleDrive(u) { return /drive\.google\.com/.test(u || ""); }

  function fmtMoney(n) {
    try { return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n || 0); }
    catch { return String(n); }
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    setTimeout(() => els.toast.classList.remove("show"), 2000);
  }

  // ===== THEME / Assets =====
  function applyTheme() {
    const t = state.config.THEME || {};
    const root = document.documentElement;
    if (t.PRIMARY) root.style.setProperty("--primary", t.PRIMARY);
    if (t.SECONDARY) root.style.setProperty("--secondary", t.SECONDARY);
    if (t.BG) root.style.setProperty("--bg", t.BG);
    if (t.TEXT) root.style.setProperty("--text", t.TEXT);
    if (t.RADIUS != null) root.style.setProperty("--radius", t.RADIUS + "px");
    if (t.SPACING != null) root.style.setProperty("--space", t.SPACING + "px");

    // Banner
    if (state.config.ASSET_HEADER_URL) {
      els.headerImg.src = state.config.ASSET_HEADER_URL;
      els.headerImg.style.display = "block";
      if (els.headerImgSide) {
        els.headerImgSide.src = state.config.ASSET_HEADER_URL;
        els.headerImgSide.style.display = "block";
      }
    } else {
      els.headerImg.style.display = "none";
      if (els.headerImgSide) els.headerImgSide.style.display = "none";
    }

    // Ticket logo
    if (state.config.ASSET_LOGO_URL) {
      els.tktLogo.crossOrigin = "anonymous";
      els.tktLogo.referrerPolicy = "no-referrer";
      els.tktLogo.src = state.config.ASSET_LOGO_URL;
      els.tktLogo.style.display = "block";
    } else {
      els.tktLogo.style.display = "none";
    }
  }

  // ===== Catálogo / Cards (tu UX: “+” se expande) =====
  function buildControls(v, current) {
    const frag = document.createDocumentFragment();
    if (current === 0) {
      const plus = document.createElement("button");
      plus.className = "plus";
      plus.textContent = "+";
      plus.addEventListener("click", () => updateQty(v, 1));
      frag.appendChild(plus);
    } else {
      const pill = document.createElement("div");
      pill.className = "qty";
      const minusBtn = document.createElement("button"); minusBtn.textContent = "–";
      const n = document.createElement("span"); n.className = "n"; n.textContent = current;
      const plusBtn = document.createElement("button"); plusBtn.textContent = "+";
      minusBtn.addEventListener("click", () => updateQty(v, current - 1));
      plusBtn.addEventListener("click", () => updateQty(v, current + 1));
      pill.append(minusBtn, n, plusBtn);
      frag.appendChild(pill);
    }
    return frag;
  }

  function buildCard(v) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = v.IdVianda;

    const imgBox = document.createElement("div");
    imgBox.className = "card-img";
    const img = document.createElement("img");
    img.alt = v.Nombre; img.loading = "lazy"; img.decoding = "async";

    const placeholder = state.config.ASSET_PLACEHOLDER_IMG_URL ||
      (window.location.origin + "/assets/placeholder.png");

    const srcNorm = normalizeImageUrl(v.Imagen);
    const driveAlt = srcNorm && isGoogleDrive(srcNorm) ? srcNorm.replace("export=view", "export=download") : "";

    img.src = placeholder;

    if (srcNorm) {
      const probe = new Image();
      if (isGoogleDrive(srcNorm)) probe.referrerPolicy = "no-referrer";
      probe.onload = () => { img.src = srcNorm; };
      probe.onerror = () => {
        if (driveAlt) {
          const probe2 = new Image();
          probe2.referrerPolicy = "no-referrer";
          probe2.onload = () => { img.src = driveAlt; };
          probe2.onerror = () => { img.src = placeholder; };
          probe2.src = driveAlt;
        } else img.src = placeholder;
      };
      probe.src = srcNorm;
    }

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

    const current = state.cart.get(v.IdVianda)?.cantidad || 0;
    const controls = document.createElement("div");
    controls.appendChild(buildControls(v, current));

    bottom.append(price, controls);
    body.append(title, desc, bottom);
    card.append(imgBox, body);

    return card;
  }

  function renderCatalogo() {
    els.catalogo.innerHTML = "";
    if (!state.catalogo.length) return;
    for (const v of state.catalogo) els.catalogo.appendChild(buildCard(v));
  }

  function patchCardControls(id, v, n) {
    const card = els.catalogo.querySelector(`[data-id="${id}"]`);
    if (!card) return;
    const bottom = card.querySelector(".card-bottom");
    if (!bottom) return;
    const controlsHolder = bottom.lastElementChild;
    if (!controlsHolder) return;
    controlsHolder.innerHTML = "";
    controlsHolder.appendChild(buildControls(v, n));
  }

  function updateQty(v, n) {
    const max = Number(state.config.UI_MAX_QTY_POR_VIANDA || 9);
    if (n < 0) n = 0;
    if (n > max) { toast(state.config.MSG_LIMIT || "Máximo 9 por vianda."); n = max; }

    if (n === 0) state.cart.delete(v.IdVianda);
    else state.cart.set(v.IdVianda, { id: v.IdVianda, nombre: v.Nombre, precio: Number(v.Precio), cantidad: n });

    patchCardControls(v.IdVianda, v, n);
    renderResumen();
  }

  // ✅ “carrito vacío” para que la columna izquierda no quede muerta
  function renderResumen() {
    els.resumenList.innerHTML = "";
    let total = 0;
    const items = Array.from(state.cart.values());
    items.forEach(it => total += (it.precio * it.cantidad));

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "resumen-empty";
      empty.textContent = "Carrito vacío";
      els.resumenList.appendChild(empty);
    } else {
      items.slice(0, (state.config.UI_RESUMEN_ITEMS_VISIBLES || 4)).forEach(it => {
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
    els.btnConfirmar.disabled = total <= 0;
  }

  async function getIP() {
    try {
      const res = await fetch("https://api.ipify.org?format=json");
      const j = await res.json(); state.ip = j.ip;
    } catch {}
  }

  async function loadConfig() {
    setStatus("Obteniendo configuración…");
    const res = await fetch(API + "?route=ui-config", { headers: API_KEY ? { "X-API-Key": API_KEY } : {} });
    const conf = await res.json();

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
      MSG_SUCCESS: conf.MSG_SUCCESS,
      PAY_ALIAS: conf.PAY_ALIAS || "",
      PAY_NOTE: conf.PAY_NOTE || "",
    };

    applyTheme();

    if (!state.config.FORM_ENABLED) {
      document.body.classList.remove('split');
      els.app.classList.add("hidden");
      els.closed.classList.remove("hidden");
      els.closedTitle.textContent = state.config.FORM_CLOSED_TITLE || "Pedidos temporalmente cerrados";
      els.closedMsg.textContent = state.config.FORM_CLOSED_MESSAGE || "Estamos atendiendo por WhatsApp.";
      setStatus("Formulario cerrado");
      return false;
    }

    setStatus("Catálogo actualizado ✓");
    updateSplitMode();
    return true;
  }

  async function loadCatalogo() {
    setStatus("Cargando catálogo…");
    const res = await fetch(API + "?route=viandas", { headers: API_KEY ? { "X-API-Key": API_KEY } : {} });
    const data = await res.json();
    state.catalogo = Array.isArray(data.items) ? data.items : [];
    renderCatalogo();
    setStatus("Catálogo actualizado ✓");
  }

  function openSheet() { els.sheet.classList.remove("hidden"); }
  function closeSheet() { els.sheet.classList.add("hidden"); }

  // Ticket y envío: dejo tu flujo (no te lo cambio acá)
  async function waitForHtml2Canvas() {
    const start = Date.now();
    while (!window.html2canvas) {
      await new Promise(r => setTimeout(r, 100));
      if (Date.now() - start > 4000) break;
    }
    return !!window.html2canvas;
  }

  function sameOrigin(url) {
    try {
      const u = new URL(url, window.location.href);
      return u.origin === window.location.origin;
    } catch { return false; }
  }

  async function urlToDataURL(url) {
    const resp = await fetch(url, { mode: 'cors', cache: 'no-store' });
    if (!resp.ok) throw new Error('fetch-failed');
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function inlineTicketImages(rootEl) {
    const imgs = Array.from(rootEl.querySelectorAll('img'));
    const restores = [];
    for (const img of imgs) {
      const src = img.getAttribute('src') || '';
      if (!src) continue;
      if (src.startsWith('data:')) continue;
      if (sameOrigin(src) || src.startsWith('/')) continue;
      try {
        const dataURL = await urlToDataURL(src);
        const old = img.src;
        img.src = dataURL;
        restores.push(() => { img.src = old; });
      } catch {}
    }
    return () => { restores.forEach(fn => fn()); };
  }

  function openTicket(order) {
    els.tktSub.textContent = "";
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
    els.tktNote.textContent = state.config.PAY_NOTE || "";

    els.tkt.classList.remove("hidden");

    els.tktSave.onclick = async () => {
      els.tktSave.disabled = true;
      try {
        const ready = await waitForHtml2Canvas();
        if (!ready) { toast("No se pudo preparar el comprobante"); return; }

        const restore = await inlineTicketImages(els.tktContent);

        const canvas = await window.html2canvas(els.tktContent, {
          backgroundColor: "#ffffff",
          scale: 2,
          useCORS: true,
          allowTaint: false,
        });

        restore();

        const blob = await new Promise(res => canvas.toBlob(res, "image/png", 1));
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `pedido-${order.idPedido}.png`;
        a.click();
        URL.revokeObjectURL(url);
        toast("Imagen descargada ✓");
      } catch {
        toast("No se pudo guardar el comprobante");
      } finally {
        els.tktSave.disabled = false;
        els.tkt.classList.add("hidden");
      }
    };
  }

  async function enviarPedido() {
    const dni = els.dni.value.trim();
    const clave = els.clave.value.trim();
    const comentarios = els.comentarios.value.trim();

    if (!/^\d{8}$/.test(dni) || dni.startsWith("0")) { toast("DNI inválido."); return; }
    if (!clave) { toast("Ingresá tu clave."); return; }

    const cartItems = Array.from(state.cart.values());
    if (!cartItems.length) { toast("Tu carrito está vacío."); return; }

    els.btnEnviar.disabled = true;
    els.btnEnviar.textContent = "Enviando…";

    try {
      const payloadItems = cartItems.map(it => ({ idVianda: it.id, nombre: it.nombre, cantidad: it.cantidad }));
      const res = await fetch(API + "?route=pedido", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, API_KEY ? { "X-API-Key": API_KEY } : {}),
        body: JSON.stringify({ dni, clave, comentarios, items: payloadItems, ip: state.ip, ua: navigator.userAgent })
      });

      const data = await res.json();

      if (!res.ok) {
        if (data && data.error === "FORM_CLOSED") toast("Pedidos cerrados.");
        else if (data && data.error === "AUTH_FAIL") toast(state.config.MSG_AUTH_FAIL || "Clave incorrecta.");
        else toast(state.config.MSG_SERVER_FAIL || "No pudimos completar el pedido.");
        return;
      }

      const id = data.idPedido;
      let total = 0; cartItems.forEach(it => total += (it.precio * it.cantidad));

      const order = {
        idPedido: id,
        items: cartItems.map(x => ({ nombre: x.nombre, cantidad: x.cantidad, precio: x.precio })),
        total,
        fecha: new Date().toLocaleString("es-AR", { hour: "2-digit", minute:"2-digit", day:"2-digit", month:"2-digit", year:"2-digit" })
      };

      closeSheet();
      openTicket(order);

      state.cart.clear();
      renderCatalogo();
      renderResumen();

    } catch {
      toast(state.config.MSG_SERVER_FAIL || "No pudimos completar el pedido.");
    } finally {
      els.btnEnviar.disabled = false;
      els.btnEnviar.textContent = "Enviar";
    }
  }

  // Events
  document.getElementById("btn-confirmar").addEventListener("click", openSheet);
  document.getElementById("btn-cancelar").addEventListener("click", closeSheet);
  document.getElementById("btn-enviar").addEventListener("click", enviarPedido);

  // Boot
  (async function boot(){
    await getIP();
    const ok = await loadConfig();
    if (!ok) return;

    updateSplitMode();
    window.addEventListener('resize', updateSplitMode);
    window.addEventListener('orientationchange', updateSplitMode);

    await loadCatalogo();
    renderResumen();
  })();
})();
