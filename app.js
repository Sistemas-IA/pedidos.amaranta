(() => {
  const cfg = (window.APP_CONFIG || {});
  const API_BASE_URL = cfg.API_BASE_URL || "/api/pedidos";
  const API_KEY = cfg.API_KEY || "";

  const state = {
    config: null,
    viandas: [],
    cart: new Map(), // id -> { id, nombre, precio, qty }
    maxQty: 9,
    resumenMaxItems: 4
  };

  const els = {
    app: document.getElementById("app"),
    closed: document.getElementById("closed"),
    closedTitle: document.getElementById("closed-title"),
    closedMsg: document.getElementById("closed-msg"),
    closedWA: document.getElementById("closed-wa"),

    headerImg: document.getElementById("header-img"),
    headerImgSide: document.getElementById("header-img-side"),
    connStatus: document.getElementById("conn-status"),
    connStatusSide: document.getElementById("conn-status-side"),

    catalogo: document.getElementById("catalogo"),

    resumenList: document.getElementById("resumen-list"),
    resumenTotal: document.getElementById("resumen-total"),
    btnConfirmar: document.getElementById("btn-confirmar"),

    authSheet: document.getElementById("auth-sheet"),
    dni: document.getElementById("dni"),
    clave: document.getElementById("clave"),
    comentarios: document.getElementById("comentarios"),
    btnCancel: document.getElementById("btn-cancel"),
    btnSend: document.getElementById("btn-send"),
    authErr: document.getElementById("auth-err"),

    paybox: document.getElementById("paybox"),
    payAlias: document.getElementById("pay-alias"),
    payNote: document.getElementById("pay-note"),
    btnCopyAlias: document.getElementById("btn-copy-alias"),

    ticket: document.getElementById("ticket"),
    ticketCard: document.getElementById("ticket-card"),
    tktLogo: document.getElementById("tkt-logo"),
    tktId: document.getElementById("tkt-id"),
    tktItems: document.getElementById("tkt-items"),
    tktTotal: document.getElementById("tkt-total"),
    tktNote: document.getElementById("tkt-note"),
    btnDownload: document.getElementById("btn-download"),
    btnNew: document.getElementById("btn-new"),
    tktTitle: document.getElementById("tkt-title")
  };

  function setConn(msg) {
    if (els.connStatus) els.connStatus.textContent = msg;
    if (els.connStatusSide) els.connStatusSide.textContent = msg;
  }

  function normalizeDrive(u) {
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

  function applyTheme(cfg) {
    const root = document.documentElement.style;
    if (cfg.THEME_PRIMARY) root.setProperty("--primary", cfg.THEME_PRIMARY);
    if (cfg.THEME_SECONDARY) root.setProperty("--secondary", cfg.THEME_SECONDARY);
    if (cfg.THEME_BG) root.setProperty("--bg", cfg.THEME_BG);
    if (cfg.THEME_TEXT) root.setProperty("--text", cfg.THEME_TEXT);
    if (cfg.RADIUS) root.setProperty("--radius", `${parseInt(cfg.RADIUS, 10) || 16}px`);
    if (cfg.SPACING) root.setProperty("--spacing", `${parseInt(cfg.SPACING, 10) || 10}px`);
  }

  function shouldSplitLayout() {
    try {
      const on =
        window.matchMedia("(min-width: 960px) and (orientation: landscape)").matches;
      document.body.classList.toggle("split", on);
      return on;
    } catch {
      return false;
    }
  }

  function setupHeaderImages() {
    const u = normalizeDrive(state.config.ASSET_HEADER_URL || "");
    if (u) {
      if (els.headerImg) {
        els.headerImg.src = u;
        els.headerImg.style.display = "block";
      }
      if (els.headerImgSide) {
        els.headerImgSide.src = u;
        els.headerImgSide.style.display = "block";
      }
    } else {
      if (els.headerImg) els.headerImg.style.display = "none";
      if (els.headerImgSide) els.headerImgSide.style.display = "none";
    }

    // Ticket logo
    if (state.config.ASSET_LOGO_URL) {
      // Intentar CORS-friendly
      els.tktLogo.crossOrigin = "anonymous";
      els.tktLogo.referrerPolicy = "no-referrer";
      els.tktLogo.src = state.config.ASSET_LOGO_URL;
      els.tktLogo.style.display = "block";
    } else {
      els.tktLogo.style.display = "none";
    }
  }

  function setClosedScreen() {
    els.app.classList.add("hidden");
    els.ticket.classList.add("hidden");
    els.closed.classList.remove("hidden");

    els.closedTitle.textContent = state.config.FORM_CLOSED_TITLE || "Pedidos temporalmente cerrados";
    els.closedMsg.textContent = state.config.FORM_CLOSED_MESSAGE || "Estamos atendiendo por WhatsApp.";

    const waOn = String(state.config.WA_ENABLED || "").toLowerCase() === "true";
    const phone = (state.config.WA_PHONE_TARGET || "").trim();
    const template = (state.config.WA_TEMPLATE || "").trim();

    if (waOn && phone) {
      els.closedWA.classList.remove("hidden");
      els.closedWA.onclick = () => {
        const txt = template ? encodeURIComponent(template) : "";
        const url = `https://wa.me/${encodeURIComponent(phone)}${txt ? `?text=${txt}` : ""}`;
        window.open(url, "_blank", "noopener,noreferrer");
      };
    } else {
      els.closedWA.classList.add("hidden");
    }
  }

  function setOpenScreen() {
    els.closed.classList.add("hidden");
    els.ticket.classList.add("hidden");
    els.app.classList.remove("hidden");
  }

  function emptyStateCard() {
    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="body">
        <h3>${state.config.MSG_EMPTY || "No hay viandas disponibles por ahora."}</h3>
        <p>Volvé más tarde o consultanos por WhatsApp.</p>
      </div>
    `;
    return div;
  }

  function buildCard(v) {
    const card = document.createElement("article");
    card.className = "card";

    const imgWrap = document.createElement("div");
    imgWrap.className = "img";

    const img = document.createElement("img");
    const placeholder = normalizeDrive(state.config.ASSET_PLACEHOLDER_IMG_URL || "");
    const src = normalizeDrive(v.Imagen || "");
    img.alt = v.Nombre || "Vianda";

    if (src) {
      img.src = src;
    } else if (placeholder) {
      img.src = placeholder;
    }

    img.loading = "lazy";
    img.decoding = "async";
    imgWrap.appendChild(img);

    const body = document.createElement("div");
    body.className = "body";

    const h3 = document.createElement("h3");
    h3.textContent = v.Nombre || "";
    const p = document.createElement("p");
    p.textContent = v.Descripcion || "";

    const row = document.createElement("div");
    row.className = "row";

    const price = document.createElement("div");
    price.className = "price";
    price.textContent = `$ ${fmtMoney(v.Precio || 0)}`;

    const qty = document.createElement("div");
    qty.className = "qty";

    const btnMinus = document.createElement("button");
    btnMinus.type = "button";
    btnMinus.textContent = "−";

    const num = document.createElement("div");
    num.className = "num";
    num.textContent = String(getQty(v.IdVianda));

    const btnPlus = document.createElement("button");
    btnPlus.type = "button";
    btnPlus.textContent = "+";

    btnMinus.addEventListener("click", () => changeQty(v, -1));
    btnPlus.addEventListener("click", () => changeQty(v, +1));

    qty.appendChild(btnMinus);
    qty.appendChild(num);
    qty.appendChild(btnPlus);

    row.appendChild(price);
    row.appendChild(qty);

    body.appendChild(h3);
    body.appendChild(p);
    body.appendChild(row);

    card.appendChild(imgWrap);
    card.appendChild(body);

    card.__qtyEl = num;
    return card;
  }

  function getQty(id) {
    const it = state.cart.get(String(id));
    return it ? it.qty : 0;
  }

  function changeQty(v, delta) {
    const id = String(v.IdVianda);
    const cur = getQty(id);
    let next = cur + delta;
    if (next < 0) next = 0;
    if (next > state.maxQty) {
      toast(state.config.MSG_LIMIT || `Máximo ${state.maxQty} por vianda.`);
      next = state.maxQty;
    }

    if (next === 0) state.cart.delete(id);
    else state.cart.set(id, { id, nombre: v.Nombre, precio: v.Precio, qty: next });

    // actualizar num en card
    for (const child of els.catalogo.children) {
      if (child && child.__qtyEl && child.querySelector && child.querySelector("h3")?.textContent === v.Nombre) {
        // nada
      }
    }
    renderCatalogQuantities();
    renderResumen();
  }

  function renderCatalogQuantities() {
    // Recalcular numeritos en todas las cards
    const cards = els.catalogo.querySelectorAll(".card");
    cards.forEach((card) => {
      const name = card.querySelector("h3")?.textContent || "";
      const v = state.viandas.find(x => String(x.Nombre || "") === String(name));
      if (!v) return;
      const q = getQty(v.IdVianda);
      const num = card.querySelector(".num");
      if (num) num.textContent = String(q);
    });
  }

  function computeTotal() {
    let t = 0;
    for (const it of state.cart.values()) {
      t += (Number(it.precio) || 0) * (Number(it.qty) || 0);
    }
    return t;
  }

  function renderResumen() {
    els.resumenList.innerHTML = "";

    const arr = Array.from(state.cart.values());
    if (!arr.length) {
      const empty = document.createElement("div");
      empty.style.padding = "10px 12px";
      empty.style.color = "var(--muted)";
      empty.style.fontSize = "13px";
      empty.innerHTML = "Tu carrito está vacío.";
      els.resumenList.appendChild(empty);
      els.resumenTotal.textContent = "$ 0";
      els.btnConfirmar.disabled = true;
      return;
    }

    // Mostrar máximo N ítems en resumen (para que sea prolijo)
    const maxShow = state.resumenMaxItems || 4;
    const show = arr.slice(0, maxShow);

    show.forEach((it) => {
      const row = document.createElement("div");
      row.className = "res-item";

      const left = document.createElement("div");
      left.className = "left";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = it.nombre;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.textContent = `$ ${fmtMoney(it.precio)} c/u`;

      left.appendChild(name);
      left.appendChild(meta);

      const right = document.createElement("div");
      right.className = "right";

      const mini = document.createElement("div");
      mini.className = "mini";

      const bM = document.createElement("button");
      bM.type = "button";
      bM.textContent = "−";
      bM.addEventListener("click", () => {
        const v = state.viandas.find(x => String(x.IdVianda) === String(it.id));
        if (v) changeQty(v, -1);
      });

      const n = document.createElement("div");
      n.style.minWidth = "18px";
      n.style.textAlign = "center";
      n.style.fontWeight = "900";
      n.textContent = String(it.qty);

      const bP = document.createElement("button");
      bP.type = "button";
      bP.textContent = "+";
      bP.addEventListener("click", () => {
        const v = state.viandas.find(x => String(x.IdVianda) === String(it.id));
        if (v) changeQty(v, +1);
      });

      mini.appendChild(bM);
      mini.appendChild(n);
      mini.appendChild(bP);

      const sub = document.createElement("div");
      sub.className = "subtotal";
      sub.textContent = `$ ${fmtMoney((it.precio || 0) * (it.qty || 0))}`;

      right.appendChild(mini);
      right.appendChild(sub);

      row.appendChild(left);
      row.appendChild(right);
      els.resumenList.appendChild(row);
    });

    if (arr.length > maxShow) {
      const more = document.createElement("div");
      more.style.padding = "2px 12px 10px";
      more.style.color = "var(--muted)";
      more.style.fontSize = "12px";
      more.textContent = `+${arr.length - maxShow} item(s) más en el carrito`;
      els.resumenList.appendChild(more);
    }

    const total = computeTotal();
    els.resumenTotal.textContent = `$ ${fmtMoney(total)}`;
    els.btnConfirmar.disabled = false;
  }

  function renderCatalog() {
    els.catalogo.innerHTML = "";
    if (!state.viandas.length) {
      els.catalogo.appendChild(emptyStateCard());
      return;
    }
    state.viandas.forEach((v) => {
      els.catalogo.appendChild(buildCard(v));
    });
    renderCatalogQuantities();
  }

  function showAuthSheet() {
    els.authErr.classList.add("hidden");
    els.authErr.textContent = "";
    els.authSheet.classList.remove("hidden");
    setTimeout(() => els.dni?.focus(), 40);
  }
  function hideAuthSheet() {
    els.authSheet.classList.add("hidden");
  }

  function toast(msg) {
    // toast bien simple
    const t = document.createElement("div");
    t.style.position = "fixed";
    t.style.left = "50%";
    t.style.bottom = "18px";
    t.style.transform = "translateX(-50%)";
    t.style.background = "rgba(17,24,39,.95)";
    t.style.color = "#fff";
    t.style.padding = "10px 12px";
    t.style.borderRadius = "14px";
    t.style.fontSize = "13px";
    t.style.fontWeight = "800";
    t.style.zIndex = "999";
    t.style.maxWidth = "92vw";
    t.style.textAlign = "center";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  function fillPayBox() {
    const alias = (state.config.PAY_ALIAS || "").trim();
    const note = (state.config.PAY_NOTE || "").trim();

    if (!alias && !note) {
      els.paybox.classList.add("hidden");
      return;
    }
    els.paybox.classList.remove("hidden");
    els.payAlias.textContent = alias || "—";

    if (note) {
      els.payNote.textContent = note;
      els.payNote.classList.remove("hidden");
    } else {
      els.payNote.textContent = "";
      els.payNote.classList.add("hidden");
    }
  }

  async function copyText(txt) {
    try {
      await navigator.clipboard.writeText(txt);
      toast("Copiado");
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast("Copiado");
    }
  }

  function buildPayload() {
    const items = [];
    for (const it of state.cart.values()) {
      items.push({ idVianda: it.id, cantidad: it.qty });
    }
    return {
      dni: String(els.dni.value || "").trim(),
      clave: String(els.clave.value || "").trim(),
      comentarios: String(els.comentarios.value || "").trim(),
      items,
      ua: navigator.userAgent
    };
  }

  function showAuthError(msg) {
    els.authErr.textContent = msg;
    els.authErr.classList.remove("hidden");
  }

  function setTicket(data, comentarios) {
    els.app.classList.add("hidden");
    els.closed.classList.add("hidden");
    els.ticket.classList.remove("hidden");

    els.tktTitle.textContent = "Pedido confirmado";
    els.tktId.textContent = `#${data.idPedido}`;

    els.tktItems.innerHTML = "";
    const arr = Array.from(state.cart.values());

    arr.forEach((it) => {
      const row = document.createElement("div");
      row.className = "tkt-item";
      row.innerHTML = `<div>${it.qty}× ${it.nombre}</div><div>$ ${fmtMoney(it.precio * it.qty)}</div>`;
      els.tktItems.appendChild(row);
    });

    const total = computeTotal();
    els.tktTotal.textContent = `$ ${fmtMoney(total)}`;

    const note = (comentarios || "").trim();
    if (note) {
      els.tktNote.textContent = `Comentarios: ${note}`;
      els.tktNote.classList.remove("hidden");
    } else {
      els.tktNote.textContent = "";
      els.tktNote.classList.add("hidden");
    }
  }

  async function inlineImagesForTicket() {
    // Para evitar ticket “en blanco” por CORS: intentamos inlinear imágenes de Drive
    const imgs = els.ticketCard.querySelectorAll("img");
    for (const img of imgs) {
      if (!img || !img.src) continue;
      const src = img.src;
      if (!isGoogleDrive(src)) continue;

      try {
        const r = await fetch(src, { mode: "cors" });
        const blob = await r.blob();
        const fr = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          fr.onload = () => resolve(fr.result);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
        img.src = String(dataUrl);
      } catch {
        // si falla, dejamos el src original
      }
    }
  }

  async function downloadTicketPng() {
    try {
      await inlineImagesForTicket();
      const canvas = await window.html2canvas(els.ticketCard, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true
      });
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = `pedido-${els.tktId.textContent.replace("#", "")}.png`;
      a.click();
    } catch {
      toast("No se pudo generar la imagen");
    }
  }

  function resetForNew() {
    state.cart.clear();
    els.dni.value = "";
    els.clave.value = "";
    els.comentarios.value = "";

    els.ticket.classList.add("hidden");
    setOpenScreen();
    renderCatalog();
    renderResumen();
  }

  async function loadConfig() {
    setConn("Cargando configuración…");
    const url = `${API_BASE_URL}?route=ui-config`;
    const r = await fetch(url);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "CONFIG_FAIL");
    state.config = j;
    state.maxQty = parseInt(j.UI_MAX_QTY_POR_VIANDA || "9", 10) || 9;
    state.resumenMaxItems = parseInt(j.UI_RESUMEN_ITEMS_VISIBLES || "4", 10) || 4;

    applyTheme(j);
    setupHeaderImages();
    fillPayBox();

    const enabled = String(j.FORM_ENABLED || "true").toLowerCase() === "true";
    if (!enabled) setClosedScreen();
    else setOpenScreen();

    setConn("Listo");
  }

  async function loadViandas() {
    setConn("Cargando viandas…");
    const url = `${API_BASE_URL}?route=viandas`;
    const r = await fetch(url);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "VIANDAS_FAIL");
    state.viandas = (j.items || []).map((x) => ({
      ...x,
      Imagen: normalizeDrive(x.Imagen || "")
    }));
    setConn("Listo");
  }

  async function sendPedido() {
    els.btnSend.disabled = true;
    els.btnSend.textContent = "Enviando…";
    els.authErr.classList.add("hidden");

    const payload = buildPayload();
    const headers = { "Content-Type": "application/json" };
    if (API_KEY) headers["X-API-Key"] = API_KEY;

    try {
      const r = await fetch(`${API_BASE_URL}?route=pedido`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      });
      const j = await r.json().catch(() => ({}));

      if (!r.ok || !j.ok) {
        const code = j.error || "SERVER_FAIL";
        if (code === "AUTH_FAIL") {
          showAuthError(state.config.MSG_AUTH_FAIL || "DNI o clave incorrectos o cliente no validado.");
        } else if (code === "FORM_CLOSED") {
          showAuthError("Los pedidos están cerrados en este momento.");
        } else if (code === "NO_ITEMS") {
          showAuthError("Tu carrito quedó vacío. Revisá e intentá de nuevo.");
        } else {
          showAuthError(state.config.MSG_SERVER_FAIL || "No pudimos completar el pedido. Probá más tarde.");
        }
        return;
      }

      hideAuthSheet();
      setTicket(j, payload.comentarios);

    } catch {
      showAuthError(state.config.MSG_SERVER_FAIL || "No pudimos completar el pedido. Probá más tarde.");
    } finally {
      els.btnSend.disabled = false;
      els.btnSend.textContent = "Enviar pedido";
    }
  }

  function wireEvents() {
    els.btnConfirmar.addEventListener("click", () => {
      showAuthSheet();
    });
    els.btnCancel.addEventListener("click", () => hideAuthSheet());
    els.authSheet.addEventListener("click", (e) => {
      if (e.target === els.authSheet) hideAuthSheet();
    });
    els.btnSend.addEventListener("click", sendPedido);

    if (els.btnCopyAlias) {
      els.btnCopyAlias.addEventListener("click", () => {
        const alias = (state.config?.PAY_ALIAS || "").trim();
        if (!alias) return;
        copyText(alias);
      });
    }

    els.btnDownload.addEventListener("click", downloadTicketPng);
    els.btnNew.addEventListener("click", resetForNew);

    // Reaccionar a resize/orientation para activar body.split
    window.addEventListener("resize", () => shouldSplitLayout());
    window.addEventListener("orientationchange", () => shouldSplitLayout());
  }

  async function init() {
    try {
      shouldSplitLayout();
      wireEvents();
      await loadConfig();
      // Si está cerrado, no cargamos catálogo
      const enabled = String(state.config.FORM_ENABLED || "true").toLowerCase() === "true";
      if (!enabled) return;

      await loadViandas();
      renderCatalog();
      renderResumen();
    } catch (e) {
      console.error(e);
      setConn("Error");
      toast("Error cargando la app");
    }
  }

  init();
})();
