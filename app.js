(() => {
  const cfg = window.APP_CONFIG || {};
  const API = cfg.API_BASE_URL;
  const API_KEY = cfg.API_KEY || "";

  const els = {
    headerImg: document.getElementById("header-img"),
    status: document.getElementById("conn-status"),
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
    cart: new Map(), // idVianda -> { id, nombre, precio, cantidad }
    ip: null,
    lastOrder: null, // { idPedido, items:[{nombre, cantidad, precio}], total, fecha }
  };

  // ===== Helpers de imágenes (Drive + Blob) =====
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

  function toast(msg, hold=false) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    if (!hold) setTimeout(() => els.toast.classList.remove("show"), 2000);
  }

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
    } else {
      els.headerImg.style.display = "none";
    }

    // Ticket logo (si tenés logo en Config)
    if (state.config.ASSET_LOGO_URL) {
      els.tktLogo.src = state.config.ASSET_LOGO_URL;
      els.tktLogo.style.display = "block";
    }
  }

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

    // IMG
    const imgBox = document.createElement("div");
    imgBox.className = "card-img";
    const img = document.createElement("img");
    img.alt = v.Nombre; img.loading = "lazy"; img.decoding = "async";

    const placeholder = state.config.ASSET_PLACEHOLDER_IMG_URL ||
      (window.location.origin + "/assets/placeholder.png");
    const srcNorm = normalizeImageUrl(v.Imagen);
    const driveAlt = srcNorm && isGoogleDrive(srcNorm)
      ? srcNorm.replace("export=view", "export=download") : "";
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
        } else { img.src = placeholder; }
      };
      probe.src = srcNorm;
    }
    imgBox.appendChild(img);

    // BODY
    const body = document.createElement("div");
    body.className = "card-body";
    const title = document.createElement("h3");
    title.className = "card-title"; title.textContent = v.Nombre;
    const desc = document.createElement("div");
    desc.className = "card-desc"; desc.textContent = v.Descripcion || "";

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

  function renderCatalogo() {
    els.catalogo.innerHTML = "";
    if (!state.catalogo.length) {
      const empty = document.createElement("div");
      empty.textContent = state.config.MSG_EMPTY || "No hay viandas disponibles por ahora.";
      empty.className = "card";
      els.catalogo.appendChild(empty);
      return;
    }
    for (const v of state.catalogo) els.catalogo.appendChild(buildCard(v));
  }

  function renderResumen() {
    els.resumenList.innerHTML = "";
    let total = 0;
    const items = Array.from(state.cart.values());
    items.forEach(it => total += (it.precio * it.cantidad));

    items.slice(0, (state.config.UI_RESUMEN_ITEMS_VISIBLES || 4)).forEach(it => {
      const row = document.createElement("div");
      row.className = "resumen-item";
      const left = document.createElement("div");
      left.className = "resumen-left";
      left.textContent = `${it.cantidad}× ${it.nombre}`;
      const right = document.createElement("div");
      right.className = "resumen-right";
      right.textContent = "$ " + fmtMoney(it.precio * it.cantidad); // SUBTOTAL
      row.append(left, right);
      els.resumenList.appendChild(row);
    });

    els.resumenTotal.textContent = "$ " + fmtMoney(total);
    els.btnConfirmar.disabled = total <= 0;
  }

  function patchCardControls(id, v, n) {
    const card = els.catalogo.querySelector(`[data-id="${id}"]`);
    if (!card) return;
    const bottom = card.querySelector(".card-bottom");
    if (!bottom) return;
    const newControls = buildControls(v, n);
    const oldControls = bottom.lastElementChild;
    if (oldControls) bottom.replaceChild(newControls, oldControls);
    else bottom.appendChild(newControls);
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

  async function getIP() {
    try {
      const res = await fetch("https://api.ipify.org?format=json");
      const j = await res.json(); state.ip = j.ip;
    } catch {}
  }

  async function loadConfig() {
    els.status.textContent = "Obteniendo configuración…";
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
      WA_ENABLED: String(conf.WA_ENABLED || "true").toLowerCase() === "true",
      WA_TEMPLATE: conf.WA_TEMPLATE,
      WA_ITEMS_BULLET: conf.WA_ITEMS_BULLET,
      WA_PHONE_TARGET: conf.WA_PHONE_TARGET || "",
      PAY_ALIAS: conf.PAY_ALIAS || "", // alias de pago
      PAY_NOTE: conf.PAY_NOTE || "",   // nota opcional
    };
    applyTheme();

    if (!state.config.FORM_ENABLED) {
      els.app.classList.add("hidden");
      els.closed.classList.remove("hidden");
      els.closedTitle.textContent = state.config.FORM_CLOSED_TITLE || "Pedidos temporalmente cerrados";
      els.closedMsg.textContent = state.config.FORM_CLOSED_MESSAGE || "Estamos atendiendo por WhatsApp. Volvé más tarde o escribinos.";
      if (state.config.WA_ENABLED) {
        els.closedWA.classList.remove("hidden");
        els.closedWA.addEventListener("click", () => shareWA({closed:true}));
      }
      els.status.textContent = "Formulario cerrado";
      return false;
    }
    els.status.textContent = "Configuración cargada";
    return true;
  }

  async function loadCatalogo() {
    els.status.textContent = "Cargando catálogo…";
    const res = await fetch(API + "?route=viandas", { headers: API_KEY ? { "X-API-Key": API_KEY } : {} });
    const data = await res.json();
    if (data.closed) { els.status.textContent = "Formulario cerrado"; return; }
    state.catalogo = Array.isArray(data.items) ? data.items : [];
    renderCatalogo();
    els.status.textContent = "Catálogo actualizado ✓";
  }

  function openSheet() { els.sheet.classList.remove("hidden"); }
  function closeSheet() { els.sheet.classList.add("hidden"); }

  function buildWA(items, idPedido, total) {
    const tmpl = state.config.WA_TEMPLATE || "Pedido #{IDPEDIDO} por ${TOTAL}\n{ITEMS}\nAlias: {ALIAS}";
    const line = state.config.WA_ITEMS_BULLET || "- {CANT}× {NOMBRE} — ${SUBTOTAL}";
    const itemsStr = items.map(it => line
      .replace("{CANT}", it.cantidad)
      .replace("{NOMBRE}", it.nombre)
      .replace("${SUBTOTAL}", fmtMoney(it.precio * it.cantidad))
    ).join("\n");
    return tmpl
      .replace("{IDPEDIDO}", idPedido)
      .replace("${TOTAL}", fmtMoney(total))
      .replace("{ITEMS}", itemsStr)
      .replace("{ALIAS}", state.config.PAY_ALIAS || "")
      .replace("{FECHA}", new Date().toLocaleDateString("es-AR"))
      .replace("{HORA}", new Date().toLocaleTimeString("es-AR", {hour: "2-digit", minute:"2-digit"}));
  }

  function shareWA(payload) {
    if (payload?.closed) {
      const msg = (state.config.FORM_CLOSED_TITLE || "") + "\n" + (state.config.FORM_CLOSED_MESSAGE || "");
      const url = "https://wa.me/" + (state.config.WA_PHONE_TARGET || "") + "?text=" + encodeURIComponent(msg);
      window.open(url, "_blank"); return;
    }
    const items = Array.from(state.cart.values());
    let total = 0; items.forEach(it => total += (it.precio * it.cantidad));
    const text = buildWA(items, payload.idPedido, total);
    const url = "https://wa.me/" + (state.config.WA_PHONE_TARGET || "") + "?text=" + encodeURIComponent(text);
    window.open(url, "_blank");
  }

  // ---- Ticket helpers ----
  function openTicket(order) {
    els.tktSub.textContent = state.config.PAY_NOTE || "";
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

    // Un solo botón: Guardar…  (share con imagen si se puede; fallback: descarga)
    els.tktSave.onclick = async () => {
      // cerrar primero como pediste
      els.tkt.classList.add("hidden");

      const run = async () => {
        try {
          if (!window.html2canvas) { toast("Cargando capturador… probá de nuevo en 1 segundo"); return; }
          const canvas = await window.html2canvas(els.tktContent, { backgroundColor: "#ffffff", scale: 2 });
          const blob = await new Promise(res => canvas.toBlob(res, "image/png", 1));
          const file = new File([blob], `pedido-${order.idPedido}.png`, { type: "image/png" });

          // Web Share con archivos (si está disponible)
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: `Pedido #${order.idPedido}` });
          } else {
            // Fallback: descarga local
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = `pedido-${order.idPedido}.png`; a.click();
            URL.revokeObjectURL(url);
            toast("Imagen descargada ✓");
          }
        } catch {
          toast("No se pudo guardar el comprobante");
        }
      };

      // pequeña espera para que se cierre visualmente y no corte el gesto
      setTimeout(run, 50);
    };
  }

  async function enviarPedido() {
    const dni = els.dni.value.trim();
    const clave = els.clave.value.trim();
    const comentarios = els.comentarios.value.trim();

    if (!/^\d{8}$/.test(dni) || dni.startsWith("0")) {
      toast("DNI inválido (8 dígitos, no comienza con 0)."); return;
    }
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
        if (data && data.error === "FORM_CLOSED") toast(state.config.FORM_CLOSED_MESSAGE || "Formulario cerrado.");
        else toast(state.config.MSG_AUTH_FAIL || "No se pudo procesar.");
        els.btnEnviar.disabled = false; els.btnEnviar.textContent = "Enviar"; return;
      }
      // Éxito → construir order antes de limpiar carrito
      const id = data.idPedido;
      let total = 0; cartItems.forEach(it => total += (it.precio * it.cantidad));
      const order = {
        idPedido: id,
        items: cartItems.map(x => ({ nombre: x.nombre, cantidad: x.cantidad, precio: x.precio })),
        total,
        fecha: new Date().toLocaleString("es-AR", { hour: "2-digit", minute:"2-digit", day:"2-digit", month:"2-digit", year:"2-digit" })
      };
      state.lastOrder = order;

      closeSheet();
      openTicket(order);

      state.cart.clear();
      renderCatalogo();
      renderResumen();

    } catch (e) {
      toast(state.config.MSG_SERVER_FAIL || "No pudimos completar el pedido.");
    } finally {
      els.btnEnviar.disabled = false; els.btnEnviar.textContent = "Enviar";
    }
  }

  // Events
  document.getElementById("btn-confirmar").addEventListener("click", () => els.sheet.classList.remove("hidden"));
  document.getElementById("btn-cancelar").addEventListener("click", () => els.sheet.classList.add("hidden"));
  document.getElementById("btn-enviar").addEventListener("click", enviarPedido);

  // Boot
  (async function boot(){
    await getIP();
    const ok = await loadConfig();
    if (!ok) return;
    await loadCatalogo();
    renderResumen();
  })();
})();
