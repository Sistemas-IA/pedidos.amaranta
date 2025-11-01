(() => {
  const cfg = window.APP_CONFIG || {};
  const API = cfg.API_BASE_URL;
  const API_KEY = cfg.API_KEY || "";

  const els = {
    logo: document.getElementById("logo"),
    status: document.getElementById("conn-status"),
    catalogo: document.getElementById("catalogo"),
    resumen: document.getElementById("resumen"),
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
  };

  const state = {
    config: {},
    catalogo: [],
    cart: new Map(), // idVianda -> { id, nombre, precio, cantidad }
    ip: null,
  };

  // ===== Helpers de imágenes (Drive + Blob) =====
  function normalizeImageUrl(u) {
    if (!u) return "";
    u = String(u).trim();

    // Google Drive: /file/d/ID/view  →  uc?export=view&id=ID
    let m = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;

    // Google Drive: /open?id=ID
    m = u.match(/drive\.google\.com\/open\?id=([^&]+)/);
    if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;

    // Ya era uc?export=view&id=...
    if (/drive\.google\.com\/uc\?/.test(u)) return u;

    // Cualquier otra (Vercel Blob, CDN, etc.)
    return u;
  }
  function isGoogleDrive(u) {
    return /drive\.google\.com/.test(u || "");
  }

  function fmtMoney(n) {
    try {
      return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n || 0);
    } catch { return String(n); }
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    setTimeout(() => els.toast.classList.remove("show"), 2000);
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
    if (state.config.ASSET_LOGO_URL) {
      els.logo.src = state.config.ASSET_LOGO_URL;
      els.logo.style.display = "block";
    }
  }

  function buildCard(v) {
    const card = document.createElement("article");
    card.className = "card";

    const imgBox = document.createElement("div");
    imgBox.className = "card-img";
    const img = document.createElement("img");
    img.alt = v.Nombre;
    img.loading = "lazy";
    img.decoding = "async";

    // --- Imagen robusta (Drive + Blob + genérico) ---
    const placeholder = state.config.ASSET_PLACEHOLDER_IMG_URL || "./assets/placeholder.svg";
    const srcNorm = normalizeImageUrl(v.Imagen);
    const driveAlt = srcNorm && isGoogleDrive(srcNorm)
      ? srcNorm.replace("export=view", "export=download")
      : "";

    if (isGoogleDrive(srcNorm)) img.referrerPolicy = "no-referrer"; // evita bloqueo por referrer
    img.src = srcNorm || placeholder;

    // Si falla: 1) probá variante de Drive  2) caé al placeholder (sin loop)
    img.addEventListener("error", () => {
      if (driveAlt && img.src !== driveAlt) { img.src = driveAlt; return; }
      if (img.src !== placeholder) { img.src = placeholder; }
    }, { once: true });

    imgBox.appendChild(img);

    const body = document.createElement("div");
    body.className = "card-body";
    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = v.Nombre;
    const desc = document.createElement("div");
    desc.className = "card-desc";
    desc.textContent = v.Descripcion || "";
    const price = document.createElement("div");
    price.className = "card-price";
    price.textContent = "$ " + fmtMoney(v.Precio);

    const controls = document.createElement("div");

    const current = state.cart.get(v.IdVianda)?.cantidad || 0;
    if (current === 0) {
      const plus = document.createElement("button");
      plus.className = "plus";
      plus.textContent = "+";
      plus.addEventListener("click", () => updateQty(v, 1));
      controls.appendChild(plus);
    } else {
      const pill = document.createElement("div");
      pill.className = "qty";
      const minusBtn = document.createElement("button");
      minusBtn.textContent = "–";
      const n = document.createElement("span"); n.className = "n"; n.textContent = current;
      const plusBtn = document.createElement("button"); plusBtn.textContent = "+";
      minusBtn.addEventListener("click", () => updateQty(v, current - 1));
      plusBtn.addEventListener("click", () => updateQty(v, current + 1));
      pill.append(minusBtn, n, plusBtn);
      controls.appendChild(pill);
    }

    body.append(title, desc, price, controls);
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
    for (const v of state.catalogo) {
      els.catalogo.appendChild(buildCard(v));
    }
  }

  function renderResumen() {
    els.resumenList.innerHTML = "";
    let total = 0;
    const items = Array.from(state.cart.values());
    items.forEach(it => total += (it.precio * it.cantidad));
    items.slice(0, (state.config.UI_RESUMEN_ITEMS_VISIBLES || 4)).forEach(it => {
      const row = document.createElement("div");
      row.className = "resumen-item";
      row.textContent = `${it.cantidad}× ${it.nombre} — $ ${fmtMoney(it.precio)}`;
      els.resumenList.appendChild(row);
    });
    els.resumenTotal.textContent = "$ " + fmtMoney(total);
    els.btnConfirmar.disabled = total <= 0;
  }

  function updateQty(v, n) {
    const max = Number(state.config.UI_MAX_QTY_POR_VIANDA || 9);
    if (n < 0) n = 0;
    if (n > max) { toast(state.config.MSG_LIMIT || "Máximo 9 por vianda."); n = max; }
    if (n === 0) state.cart.delete(v.IdVianda);
    else state.cart.set(v.IdVianda, { id: v.IdVianda, nombre: v.Nombre, precio: Number(v.Precio), cantidad: n });
    renderCatalogo();
    renderResumen();
  }

  async function getIP() {
    try {
      const res = await fetch("https://api.ipify.org?format=json");
      const j = await res.json();
      state.ip = j.ip;
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
    };
    applyTheme();

    if (!state.config.FORM_ENABLED) {
      document.getElementById("app").classList.add("hidden");
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
    if (data.closed) {
      els.status.textContent = "Formulario cerrado";
      return;
    }
    state.catalogo = Array.isArray(data.items) ? data.items : [];
    // Respetar orden tal cual viene (planilla)
    renderCatalogo();
    els.status.textContent = "Catálogo actualizado ✓";
  }

  function openSheet() { els.sheet.classList.remove("hidden"); }
  function closeSheet() { els.sheet.classList.add("hidden"); }

  function buildWA(items, idPedido, total) {
    const tmpl = state.config.WA_TEMPLATE || "Pedido #{IDPEDIDO} por ${TOTAL}\n{ITEMS}";
    const line = state.config.WA_ITEMS_BULLET || "- {CANT}× {NOMBRE} — ${PRECIO}";
    const itemsStr = items.map(it => line
      .replace("{CANT}", it.cantidad)
      .replace("{NOMBRE}", it.nombre)
      .replace("{PRECIO}", fmtMoney(it.precio))
      .replace("{SUBTOTAL}", fmtMoney(it.precio * it.cantidad))
    ).join("\n");
    return tmpl
      .replace("{IDPEDIDO}", idPedido)
      .replace("${TOTAL}", fmtMoney(total))
      .replace("{ITEMS}", itemsStr)
      .replace("{FECHA}", new Date().toLocaleDateString("es-AR"))
      .replace("{HORA}", new Date().toLocaleTimeString("es-AR", {hour: "2-digit", minute:"2-digit"}));
  }

  function shareWA(payload) {
    if (payload?.closed) {
      const msg = (state.config.FORM_CLOSED_TITLE || "") + "\n" + (state.config.FORM_CLOSED_MESSAGE || "");
      const url = "https://wa.me/" + (state.config.WA_PHONE_TARGET || "") + "?text=" + encodeURIComponent(msg);
      window.open(url, "_blank");
      return;
    }
    const items = Array.from(state.cart.values());
    let total = 0; items.forEach(it => total += (it.precio * it.cantidad));
    const text = buildWA(items, payload.idPedido, total);
    const url = "https://wa.me/" + (state.config.WA_PHONE_TARGET || "") + "?text=" + encodeURIComponent(text);
    window.open(url, "_blank");
  }

  async function enviarPedido() {
    const dni = els.dni.value.trim();
    const clave = els.clave.value.trim();
    const comentarios = els.comentarios.value.trim();

    if (!/^\d{8}$/.test(dni) || dni.startsWith("0")) {
      toast("DNI inválido (8 dígitos, no comienza con 0).");
      return;
    }
    if (!clave) { toast("Ingresá tu clave."); return; }

    const items = Array.from(state.cart.values()).map(it => ({
      idVianda: it.id,
      nombre: it.nombre,
      cantidad: it.cantidad
    }));
    if (!items.length) { toast("Tu carrito está vacío."); return; }

    els.btnEnviar.disabled = true;
    els.btnEnviar.textContent = "Enviando…";

    try {
      const res = await fetch(API + "?route=pedido", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, API_KEY ? { "X-API-Key": API_KEY } : {}),
        body: JSON.stringify({ dni, clave, comentarios, items, ip: state.ip, ua: navigator.userAgent })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data && data.error === "FORM_CLOSED") {
          toast(state.config.FORM_CLOSED_MESSAGE || "Formulario cerrado.");
        } else {
          toast(state.config.MSG_AUTH_FAIL || "No se pudo procesar.");
        }
        els.btnEnviar.disabled = false; els.btnEnviar.textContent = "Enviar";
        return;
      }
      // Éxito
      const id = data.idPedido;
      const total = data.total;
      toast((state.config.MSG_SUCCESS || "¡Listo! Tu pedido es #{IDPEDIDO} por ${TOTAL}.")
        .replace("{IDPEDIDO}", id)
        .replace("${TOTAL}", fmtMoney(total))
      );
      closeSheet();
      if (state.config.WA_ENABLED) {
        setTimeout(() => shareWA({ idPedido: id }), 500);
      }
      // reset
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
  els.btnConfirmar.addEventListener("click", openSheet);
  els.btnCancelar.addEventListener("click", closeSheet);
  els.btnEnviar.addEventListener("click", enviarPedido);

  // Boot
  (async function boot(){
    await getIP();
    const ok = await loadConfig();
    if (!ok) return;
    await loadCatalogo();
    renderResumen();
  })();
})();
