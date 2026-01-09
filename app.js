(() => {
  const cfg = window.APP_CONFIG || {};
  const API = cfg.API_BASE_URL || "/api/pedidos";
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
    tktWA: document.getElementById("tkt-wa"),
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

  function setStatus(msg){
    if (els.status) els.status.textContent = msg;
    if (els.statusSide) els.statusSide.textContent = msg;
  }

  function updateSplitMode(forceOff = false){
    const want = !forceOff && window.matchMedia && window.matchMedia("(min-width: 960px) and (orientation: landscape)").matches;
    document.body.classList.toggle("split", !!want);
  }

  // ===== Helpers imágenes (Drive + Blob) =====
  function normalizeImageUrl(u) {
    if (!u) return "";
    u = String(u).trim();
    let m = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;
    m = u.match(/drive\.google\.com\/open\?id=([^&]+)/);
    if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;
    return u;
  }
  function isGoogleDrive(u) { return /drive\.google\.com/.test(u || ""); }

  // ===== Helpers =====
  function fmtMoney(n) {
    try { return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(n || 0); }
    catch { return String(n); }
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(els.toast._t);
    els.toast._t = setTimeout(() => els.toast.classList.remove("show"), 1800);
  }

  // ===== Tema =====
  function applyTheme() {
    const t = state.config.THEME || {};
    const root = document.documentElement.style;
    if (t.PRIMARY) root.setProperty("--primary", t.PRIMARY);
    if (t.SECONDARY) root.setProperty("--secondary", t.SECONDARY);
    if (t.BG) root.setProperty("--bg", t.BG);
    if (t.TEXT) root.setProperty("--text", t.TEXT);
    if (t.RADIUS) root.setProperty("--radius", `${t.RADIUS}px`);
    if (t.SPACING) root.setProperty("--space", `${t.SPACING}px`);
  }

  // ===== Catálogo / Cards =====
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
        if (driveAlt) img.src = driveAlt;
        else img.src = placeholder;
      };
      probe.src = srcNorm;
    }
    imgBox.appendChild(img);

    // BODY
    const body = document.createElement("div");
    body.className = "card-body";

    const title = document.createElement("h3");
    title.className = "card-title";
    title.textContent = v.Nombre || "";

    const desc = document.createElement("p");
    desc.className = "card-desc";
    desc.textContent = v.Descripcion || "";

    const bottom = document.createElement("div");
    bottom.className = "card-bottom";

    const price = document.createElement("div");
    price.className = "price";
    price.textContent = "$ " + fmtMoney(v.Precio || 0);

    const controls = document.createElement("div");
    controls.className = "controls";

    const current = state.cart.get(v.IdVianda)?.cantidad || 0;
    controls.appendChild(buildControls(v, current));

    bottom.append(price, controls);

    body.append(title, desc, bottom);

    card.append(imgBox, body);
    return card;
  }

  function renderCatalogo() {
    els.catalogo.innerHTML = "";
    if (!state.catalogo.length) {
      const p = document.createElement("p");
      p.style.color = "#666";
      p.textContent = state.config.MSG_EMPTY || "No hay viandas disponibles por ahora.";
      els.catalogo.appendChild(p);
      return;
    }
    state.catalogo.forEach(v => els.catalogo.appendChild(buildCard(v)));
  }

  function patchCardControls(id, v, current) {
    const card = els.catalogo.querySelector(`[data-id="${id}"]`);
    if (!card) return;
    const controls = card.querySelector(".controls");
    if (!controls) return;
    controls.innerHTML = "";
    controls.appendChild(buildControls(v, current));
  }

  function updateQty(v, n) {
    const max = state.config.UI_MAX_QTY_POR_VIANDA || 9;
    if (n < 0) n = 0;
    if (n > max) { toast(state.config.MSG_LIMIT || `Máximo ${max} por vianda.`); n = max; }

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

  // ===== Config desde API =====
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
      WA_ENABLED: String(conf.WA_ENABLED || "true").toLowerCase() === "true",
      WA_TEMPLATE: conf.WA_TEMPLATE,
      WA_ITEMS_BULLET: conf.WA_ITEMS_BULLET,
      WA_PHONE_TARGET: conf.WA_PHONE_TARGET || "",
      PAY_ALIAS: conf.PAY_ALIAS || "",
      PAY_NOTE: conf.PAY_NOTE || "",
    };
    applyTheme();

    if (!state.config.FORM_ENABLED) {
      updateSplitMode(true);
      els.app.classList.add("hidden");
      els.closed.classList.remove("hidden");
      els.closedTitle.textContent = state.config.FORM_CLOSED_TITLE || "Pedidos temporalmente cerrados";
      els.closedMsg.textContent = state.config.FORM_CLOSED_MESSAGE || "Estamos atendiendo por WhatsApp. Volvé más tarde o escribinos.";
      if (state.config.WA_ENABLED) {
        els.closedWA.classList.remove("hidden");
        els.closedWA.addEventListener("click", () => shareWA({closed:true}));
      }
      setStatus("Formulario cerrado");
      return false;
    }

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
      els.tktLogo.src = state.config.ASSET_LOGO_URL;
      els.tktLogo.style.display = "block";
    } else {
      els.tktLogo.style.display = "none";
    }

    setStatus("Configuración cargada");
    updateSplitMode(false);
    return true;
  }

  async function loadCatalogo() {
    setStatus("Cargando catálogo…");
    const res = await fetch(API + "?route=viandas", { headers: API_KEY ? { "X-API-Key": API_KEY } : {} });
    const data = await res.json();
    if (data.closed) { setStatus("Formulario cerrado"); return; }
    state.catalogo = Array.isArray(data.items) ? data.items : [];
    renderCatalogo();
    setStatus("Catálogo actualizado ✓");
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
    if (!items.length) { toast("Carrito vacío"); return; }
    const msg = buildWA(items, payload.idPedido, payload.total);
    const url = "https://wa.me/" + (state.config.WA_PHONE_TARGET || "") + "?text=" + encodeURIComponent(msg);
    window.open(url, "_blank");
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
      right.textContent = "$ " + fmtMoney(it.precio * it.cantidad);
      row.append(left, right);
      els.resumenList.appendChild(row);
    });

    els.resumenTotal.textContent = "$ " + fmtMoney(total);
    els.btnConfirmar.disabled = total <= 0;
  }

  function showSheetError(msg) {
    const box = document.getElementById("sheet-error");
    box.textContent = msg;
    box.classList.remove("hidden");
  }
  function clearSheetError() {
    const box = document.getElementById("sheet-error");
    box.textContent = "";
    box.classList.add("hidden");
  }

  async function enviarPedido() {
    clearSheetError();

    const dni = String(els.dni.value || "").trim();
    const clave = String(els.clave.value || "").trim();
    const comentarios = String(els.comentarios.value || "").trim();

    const items = Array.from(state.cart.values()).map(it => ({
      idVianda: it.id,
      cantidad: it.cantidad
    }));

    if (!/^\d{8}$/.test(dni) || dni.startsWith('0') || !clave) {
      showSheetError("Completá DNI (8 dígitos) y Clave.");
      return;
    }
    if (!items.length) {
      showSheetError("Tu carrito está vacío.");
      return;
    }

    els.btnEnviar.disabled = true;
    els.btnEnviar.textContent = "Enviando…";

    try {
      const payload = {
        dni, clave, comentarios, items,
        ip: state.ip || null,
        ua: navigator.userAgent
      };

      const res = await fetch(API + "?route=pedido", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(API_KEY ? { "X-API-Key": API_KEY } : {})
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        const code = data.error || "SERVER_FAIL";
        if (code === "AUTH_FAIL") showSheetError(state.config.MSG_AUTH_FAIL || "DNI o clave incorrectos o cliente no validado.");
        else showSheetError(state.config.MSG_SERVER_FAIL || "No pudimos completar el pedido. Probá más tarde.");
        return;
      }

      closeSheet();

      const total = items.reduce((acc, it) => {
        const v = state.cart.get(it.idVianda);
        return acc + (v ? v.precio * v.cantidad : 0);
      }, 0);

      state.lastOrder = { idPedido: data.idPedido, total };

      // Ticket
      els.tktSub.textContent = "Pedido confirmado";
      els.tktId.textContent = "#" + data.idPedido;
      els.tktItems.innerHTML = "";
      Array.from(state.cart.values()).forEach(it => {
        const row = document.createElement("div");
        row.className = "ticket-item";
        row.innerHTML = `<div>${it.cantidad}× ${it.nombre}</div><div>$ ${fmtMoney(it.precio * it.cantidad)}</div>`;
        els.tktItems.appendChild(row);
      });
      els.tktTotal.textContent = "$ " + fmtMoney(total);

      if (comentarios) {
        els.tktNote.textContent = "Comentarios: " + comentarios;
        els.tktNote.classList.remove("hidden");
      } else {
        els.tktNote.textContent = "";
        els.tktNote.classList.add("hidden");
      }

      els.tkt.classList.remove("hidden");

      // Reset carrito (pero dejamos ticket visible)
      state.cart.clear();
      renderResumen();
      renderCatalogo();

      toast((state.config.MSG_SUCCESS || "¡Listo! Tu pedido es #{IDPEDIDO} por ${TOTAL}.")
        .replace("{IDPEDIDO}", data.idPedido)
        .replace("${TOTAL}", fmtMoney(total))
      );
    } catch {
      showSheetError(state.config.MSG_SERVER_FAIL || "No pudimos completar el pedido. Probá más tarde.");
    } finally {
      els.btnEnviar.disabled = false;
      els.btnEnviar.textContent = "Enviar pedido";
    }
  }

  function sameOrigin(url) {
    try {
      const u = new URL(url, window.location.href);
      return u.origin === window.location.origin;
    } catch { return false; }
  }

  async function urlToDataURL(url) {
    const res = await fetch(url, { mode: "cors" });
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  }

  async function exportTicket() {
    if (!window.html2canvas) { toast("Cargando… probá de nuevo"); return; }

    // Inline de imágenes externas para evitar CORS
    const imgs = els.tktContent.querySelectorAll("img");
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

    const canvas = await window.html2canvas(els.tktContent, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
    restores.forEach(fn => fn());

    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `pedido-${(state.lastOrder?.idPedido || "amaranta")}.png`;
    a.click();
  }

  // ===== Eventos UI =====
  els.btnConfirmar.addEventListener("click", () => openSheet());
  els.sheet.addEventListener("click", (e) => { if (e.target === els.sheet) closeSheet(); });
  document.getElementById("btn-cancelar").addEventListener("click", () => els.sheet.classList.add("hidden"));
  document.getElementById("btn-enviar").addEventListener("click", enviarPedido);

  els.tkt.addEventListener("click", (e) => { if (e.target === els.tkt) els.tkt.classList.add("hidden"); });
  els.tktWA.addEventListener("click", () => shareWA(state.lastOrder));
  els.tktSave.addEventListener("click", exportTicket);

  // Boot
  (async function boot(){
    await getIP();
    const ok = await loadConfig();
    if (!ok) return;
    updateSplitMode(false);
    window.addEventListener("resize", () => updateSplitMode(false));
    window.addEventListener("orientationchange", () => updateSplitMode(false));
    await loadCatalogo();
    renderResumen();
  })();
})();
