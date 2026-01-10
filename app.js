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
    catalogo: [],
    cart: new Map(),
    ip: null,
    lastSendAt: 0,
    lastOrder: null,
  };

  function setStatus(msg) {
    if (els.status) els.status.textContent = msg;
    if (els.statusSide) els.statusSide.textContent = msg;
  }

  function toast(msg, hold = false) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    if (!hold) setTimeout(() => els.toast.classList.remove("show"), 2400);
  }

  function fmtMoney(n) {
    try { return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n || 0); }
    catch { return String(n); }
  }

  // ---------- Fetch seguro (NO se cae si API devuelve HTML) ----------
  async function fetchJsonSafe(url, opts = {}) {
    const headers = Object.assign({}, opts.headers || {});
    if (API_KEY) headers["X-API-Key"] = API_KEY;

    let res;
    try {
      res = await fetch(url, Object.assign({}, opts, { headers }));
    } catch (e) {
      throw new Error(`No se pudo conectar con la API (${url}).`);
    }

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const text = await res.text();

    let json = null;
    if (ct.includes("application/json")) {
      try { json = JSON.parse(text); } catch {}
    }

    if (!res.ok) {
      const msg = (json && (json.error || json.message)) ? (json.error || json.message) : `HTTP ${res.status}`;
      const hint = ct.includes("application/json") ? "" : " (parece HTML/404/500)";
      const err = new Error(`${msg}${hint}`);
      err.status = res.status;
      err.body = text;
      err.json = json;
      throw err;
    }

    if (!json) {
      const err = new Error(`La API respondió algo que NO es JSON (revisar /api/pedidos).`);
      err.status = res.status;
      err.body = text;
      throw err;
    }

    return json;
  }

  // ---------- Helpers imágenes ----------
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

  function applyTheme() {
    const t = state.config.THEME || {};
    const root = document.documentElement;

    if (t.PRIMARY) root.style.setProperty("--primary", t.PRIMARY);
    if (t.SECONDARY) root.style.setProperty("--secondary", t.SECONDARY);
    if (t.BG) root.style.setProperty("--bg", t.BG);
    if (t.TEXT) root.style.setProperty("--text", t.TEXT);
    if (t.RADIUS != null) root.style.setProperty("--radius", t.RADIUS + "px");
    if (t.SPACING != null) root.style.setProperty("--space", t.SPACING + "px");

    // ✅ evitar “imagen rota”
    const headerUrl = state.config.ASSET_HEADER_URL ? String(state.config.ASSET_HEADER_URL).trim() : "";
    if (els.headerImg) {
      if (headerUrl) { els.headerImg.src = headerUrl; els.headerImg.style.display = "block"; }
      else { els.headerImg.src = ""; els.headerImg.style.display = "none"; }
    }
    if (els.headerImgSide) {
      if (headerUrl) { els.headerImgSide.src = headerUrl; els.headerImgSide.style.display = "block"; }
      else { els.headerImgSide.src = ""; els.headerImgSide.style.display = "none"; }
    }

    if (els.tktLogo) {
      const logoUrl = state.config.ASSET_LOGO_URL ? String(state.config.ASSET_LOGO_URL).trim() : "";
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

  // ---------- UI catálogo ----------
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
    img.src = placeholder;
    if (srcNorm) img.src = srcNorm;

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

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "resumen-empty";
      empty.textContent = "Carrito vacío";
      els.resumenList.appendChild(empty);
    } else {
      const max = state.config.UI_RESUMEN_ITEMS_VISIBLES || 4;
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

  // ---------- Cargar config / catálogo ----------
  async function loadConfig() {
    setStatus("Obteniendo configuración…");

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
      WA_PHONE_TARGET: conf.WA_PHONE_TARGET || "",
      PAY_ALIAS: conf.PAY_ALIAS || "",
      PAY_NOTE: conf.PAY_NOTE || "",
    };

    applyTheme();

    if (!state.config.FORM_ENABLED) {
      els.app.classList.add("hidden");
      els.closed.classList.remove("hidden");
      els.closedTitle.textContent = state.config.FORM_CLOSED_TITLE || "Pedidos temporalmente cerrados";
      els.closedMsg.textContent = state.config.FORM_CLOSED_MESSAGE || "Estamos atendiendo por WhatsApp.";
      setStatus("Formulario cerrado");
      return false;
    }

    els.closed.classList.add("hidden");
    els.app.classList.remove("hidden");
    setStatus("Configuración cargada ✓");
    return true;
  }

  async function loadCatalogo() {
    setStatus("Cargando catálogo…");
    const data = await fetchJsonSafe(`${API}?route=viandas`);
    state.catalogo = Array.isArray(data.items) ? data.items.slice() : [];
    renderCatalogo();
    setStatus("Catálogo actualizado ✓");
  }

  // ---------- Botones / modales (mínimo, para que no explote) ----------
  function openSheet() { els.sheet.classList.remove("hidden"); }
  function closeSheet() { els.sheet.classList.add("hidden"); }
  function closeTicket() { els.tkt.classList.add("hidden"); }

  if (els.btnConfirmar) els.btnConfirmar.addEventListener("click", openSheet);
  if (els.btnCancelar) els.btnCancelar.addEventListener("click", closeSheet);
  if (els.tktClose) els.tktClose.addEventListener("click", closeTicket);
  if (els.sheet) els.sheet.addEventListener("click", (e) => { if (e.target === els.sheet) closeSheet(); });
  if (els.tkt) els.tkt.addEventListener("click", (e) => { if (e.target === els.tkt) closeTicket(); });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (els.tkt && !els.tkt.classList.contains("hidden")) closeTicket();
    if (els.sheet && !els.sheet.classList.contains("hidden")) closeSheet();
  });

  // ---------- Boot (con manejo de errores visible) ----------
  (async function boot() {
    try {
      // si config.js no cargó, esto te lo deja claro
      if (!window.APP_CONFIG) {
        console.warn("APP_CONFIG no está definido: /config.js no cargó o está mal.");
      }

      const ok = await loadConfig();
      if (!ok) return;

      await loadCatalogo();
      renderResumen();
    } catch (e) {
      console.error("BOOT ERROR:", e);
      setStatus(`ERROR: ${e.message || "falló la carga"}`);
      toast(`No cargó: ${e.message || "revisar API"}`, true);
    }
  })();
})();
