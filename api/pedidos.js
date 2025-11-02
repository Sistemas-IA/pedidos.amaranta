// api/pedidos.js
//
// Etapa 1: CORS + antidoble envío + rate-limit + bloqueo por DNI + logs de intentos (separados para Pedidos)
//
// ENV requeridas en Vercel:
// - CORS_ORIGIN (ej: https://pedidos.amaranta.ar)
// - SPREADSHEET_ID
// - GOOGLE_SERVICE_ACCOUNT  (JSON con { client_email, private_key })
// - UPSTASH_REDIS_REST_URL  (opcional, recomendado)
// - UPSTASH_REDIS_REST_TOKEN (opcional, recomendado)
// - SHEET_VIANDAS=Viandas
// - SHEET_CLIENTES=Clientes
// - SHEET_PEDIDOS=Pedidos
// - SHEET_CONFIG=Configuracion
// - SHEET_INTENTOS_PEDIDOS=IntentosPedidos   <-- NUEVA (opcional, default)
//
// Hojas (columnas):
// Viandas:  A:IdVianda  B:Nombre  C:Descripcion  D:Precio(int)  E:Imagen  F:Disponible(TRUE/FALSE)
// Clientes: A:Nombre B:Apellido C:DNI D:Telefono E:Email F:Direccion G:Comentarios H:Zona
//           I:Estado J:Lista K:Timestamp L:IP M:Clave N:Grupo
// Pedidos:  A:IdPedido B:DNI C:Vianda D:Cantidad E:Comentarios F:Precio(subtotal) G:TimeStamp H:IP I:UserAgent
// Configuracion: A:Clave B:Valor
// IntentosPedidos: A:Timestamp(ISO) B:DNI C:IP D:Motivo E:UserAgent
//
// Notas:
// - “Precio” en Pedidos guarda el SUBTOTAL (cantidad*precio_unitario).
// - IdPedido incremental: base 10001 si no hay filas.
//

const SHEET_VIANDAS = process.env.SHEET_VIANDAS || "Viandas";
const SHEET_CLIENTES = process.env.SHEET_CLIENTES || "Clientes";
const SHEET_PEDIDOS  = process.env.SHEET_PEDIDOS  || "Pedidos";
const SHEET_CONFIG   = process.env.SHEET_CONFIG   || "Configuracion";
// Hoja exclusiva para logs de Pedidos (separada del formulario de registro)
const SHEET_INTENTOS_PEDIDOS = process.env.SHEET_INTENTOS_PEDIDOS || "IntentosPedidos";

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const SA = (() => {
  try { return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT || "{}"); }
  catch { return {}; }
})();

const UP_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UP_TKN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

// ---------- Utils

const okJSON = (res, data, status = 200, extraHeaders = {}) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  setCORS(res);
  Object.entries(extraHeaders).forEach(([k,v]) => res.setHeader(k, v));
  res.status(status).end(JSON.stringify(data));
};

const setCORS = (res) => {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  res.setHeader("Access-Control-Max-Age", "86400");
};

const handleOPTIONS = (req, res) => {
  setCORS(res);
  res.status(204).end();
};

const nowISO = () => new Date().toISOString();

const hashCart = (items) => {
  try { return require("crypto").createHash("sha1").update(JSON.stringify(items || [])).digest("hex"); }
  catch { return String(Math.random()); }
};

// ---------- Upstash (opcional)

async function upstash(cmd, ...args) {
  if (!UP_URL || !UP_TKN) return null;
  const body = { command: [cmd, ...args] };
  const r = await fetch(UP_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${UP_TKN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) return null;
  return (await r.json())?.result ?? null;
}

async function rlHit(key, limit, windowSec) {
  const val = await upstash("INCR", key);
  if (val === 1) await upstash("EXPIRE", key, windowSec);
  return Number(val || 0) <= limit;
}

async function setnxTTL(key, ttlSec) {
  if (!UP_URL) return false;
  const res = await upstash("SET", key, "1", "NX", "EX", ttlSec);
  return res === "OK";
}

// ---------- Google Sheets (JWT + fetch)

async function getAccessToken() {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: SA.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    exp, iat
  };
  const base64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const encHeader = base64url(header);
  const encClaim  = base64url(claim);
  const signingInput = `${encHeader}.${encClaim}`;
  const sign = require("crypto").createSign("RSA-SHA256").update(signingInput).sign(SA.private_key, "base64url");
  const jwt = `${signingInput}.${sign}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt })
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("No access token");
  return j.access_token;
}

async function sheetsGet(range) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error("Sheets GET fail");
  return (await r.json()).values || [];
}

async function sheetsAppend(range, rows) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows })
  });
  if (!r.ok) throw new Error("Sheets APPEND fail");
  return await r.json();
}

async function sheetsBatchGet(ranges) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchGet?${ranges.map(r => "ranges=" + encodeURIComponent(r)).join("&")}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error("Sheets BATCH fail");
  return (await r.json()).valueRanges || [];
}

// ---------- Helpers de Config/parseo

async function readConfig() {
  const rows = await sheetsGet(`${SHEET_CONFIG}!A:B`);
  const map = {};
  rows.forEach(([k, v]) => { if (k) map[String(k).trim()] = (v ?? "").toString().trim(); });
  return map;
}
const parseBool = (x, def=false) => {
  const s = String(x ?? "").toLowerCase();
  if (["true","1","si","sí","yes"].includes(s)) return true;
  if (["false","0","no"].includes(s)) return false;
  return def;
};
const toInt = (x, def=0) => {
  const n = parseInt(x, 10);
  return Number.isFinite(n) ? n : def;
};

// ---------- Rutas

async function routeUIConfig(req, res) {
  const conf = await readConfig();
  const out = {
    THEME_PRIMARY: conf.THEME_PRIMARY || "",
    THEME_SECONDARY: conf.THEME_SECONDARY || "",
    THEME_BG: conf.THEME_BG || "",
    THEME_TEXT: conf.THEME_TEXT || "",
    RADIUS: conf.RADIUS || "",
    SPACING: conf.SPACING || "",
    ASSET_HEADER_URL: conf.ASSET_HEADER_URL || "",
    ASSET_LOGO_URL: conf.ASSET_LOGO_URL || "",
    ASSET_PLACEHOLDER_IMG_URL: conf.ASSET_PLACEHOLDER_IMG_URL || "",
    FORM_ENABLED: conf.FORM_ENABLED || "TRUE",
    FORM_CLOSED_TITLE: conf.FORM_CLOSED_TITLE || "",
    FORM_CLOSED_MESSAGE: conf.FORM_CLOSED_MESSAGE || "",
    UI_RESUMEN_ITEMS_VISIBLES: conf.UI_RESUMEN_ITEMS_VISIBLES || "4",
    UI_MAX_QTY_POR_VIANDA: conf.UI_MAX_QTY_POR_VIANDA || "9",
    MSG_EMPTY: conf.MSG_EMPTY || "",
    MSG_AUTH_FAIL: conf.MSG_AUTH_FAIL || "",
    MSG_LIMIT: conf.MSG_LIMIT || "",
    MSG_SERVER_FAIL: conf.MSG_SERVER_FAIL || "",
    MSG_SUCCESS: conf.MSG_SUCCESS || "",
    WA_ENABLED: conf.WA_ENABLED || "TRUE",
    WA_TEMPLATE: conf.WA_TEMPLATE || "",
    WA_ITEMS_BULLET: conf.WA_ITEMS_BULLET || "",
    WA_PHONE_TARGET: conf.WA_PHONE_TARGET || "",
    PAY_ALIAS: conf.PAY_ALIAS || "",
    PAY_NOTE: conf.PAY_NOTE || "",
  };
  return okJSON(res, out);
}

async function routeViandas(req, res) {
  const [viandas, conf] = await Promise.all([
    sheetsGet(`${SHEET_VIANDAS}!A:F`),
    readConfig()
  ]);

  const items = [];
  for (let i=1; i<viandas.length; i++){
    const [IdVianda, Nombre, Descripcion, Precio, Imagen, Disponible] = viandas[i] || [];
    const disp = parseBool(Disponible, false);
    if (!disp) continue;
    items.push({
      IdVianda,
      Nombre,
      Descripcion: Descripcion || "",
      Precio: toInt(Precio, 0),
      Imagen: Imagen || ""
    });
  }
  const formEnabled = parseBool(conf.FORM_ENABLED, true);
  return okJSON(res, { ok:true, items, closed: !formEnabled });
}

// Log exclusivo de Pedidos (separado)
async function logIntentoPedidos({dni, ip, ua, motivo}) {
  try {
    await sheetsAppend(`${SHEET_INTENTOS_PEDIDOS}!A:E`, [[ nowISO(), dni || "", ip || "", motivo || "", (ua||"").slice(0,200) ]]);
  } catch { /* ignore */ }
}

async function routePedido(req, res) {
  if (req.method !== "POST") return okJSON(res, { error: "METHOD" }, 405);

  // JSON seguro
  let body = null;
  try {
    if ((req.headers["content-type"] || "").includes("application/json")) {
      body = req.body && typeof req.body === "object" ? req.body :
              await new Promise((resolve, reject) => {
                let data=""; req.on("data", ch => data += ch);
                req.on("end", () => { try { resolve(JSON.parse(data||"{}")); } catch(e){ reject(e);} });
              });
    } else {
      return okJSON(res, { error: "BAD_CONTENT_TYPE" }, 415);
    }
  } catch {
    return okJSON(res, { error: "BAD_JSON" }, 400);
  }

  const ip  = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "";
  const ua  = req.headers["user-agent"] || "";
  const dni = String(body?.dni || "").trim();
  const clave = String(body?.clave || "").trim();
  const comentarios = (body?.comentarios || "").toString().slice(0, 500);
  const items = Array.isArray(body?.items) ? body.items : [];

  if (!/^\d{8}$/.test(dni) || dni.startsWith("0")) {
    await logIntentoPedidos({ dni, ip, ua, motivo:"dni_invalido" });
    return okJSON(res, { error: "DNI" }, 400);
  }
  if (!clave) {
    await logIntentoPedidos({ dni, ip, ua, motivo:"clave_vacia" });
    return okJSON(res, { error: "CLAVE" }, 400);
  }
  if (!items.length) return okJSON(res, { error: "CART_EMPTY" }, 400);

  // Rate limit (10 min)
  const okIP  = await rlHit(`rl:ip:${ip}`, 20, 600);
  const okDNI = await rlHit(`rl:dni:${dni}`, 10, 600);
  if (!okIP)  { await logIntentoPedidos({ dni, ip, ua, motivo:"rate_ip" });  return okJSON(res, { error:"RATE_IP" }, 429); }
  if (!okDNI) { await logIntentoPedidos({ dni, ip, ua, motivo:"rate_dni" }); return okJSON(res, { error:"RATE_DNI" }, 429); }

  // Lock por fallas de clave (5 en 30 min)
  const locked = await upstash("GET", `lock:dni:${dni}`);
  if (locked === "1") {
    await logIntentoPedidos({ dni, ip, ua, motivo:"dni_bloqueado" });
    return okJSON(res, { error:"DNI_LOCKED" }, 423);
  }

  const conf = await readConfig();
  if (!parseBool(conf.FORM_ENABLED, true)) {
    return okJSON(res, { error: "FORM_CLOSED" }, 403);
  }
  const MAX_QTY = toInt(conf.UI_MAX_QTY_POR_VIANDA, 9);

  const [rClientes, rViandas, rPedidos] = await sheetsBatchGet([
    `${SHEET_CLIENTES}!A:N`,
    `${SHEET_VIANDAS}!A:F`,
    `${SHEET_PEDIDOS}!A:A`
  ]);

  const clientes = rClientes?.values || [];
  const viandas  = rViandas?.values || [];
  const pedidosColA = rPedidos?.values || [];

  // Buscar cliente
  let cliente = null;
  for (let i=1; i<clientes.length; i++){
    const row = clientes[i];
    const cDNI   = (row[2]||"").trim();
    const cEstado= (row[8]||"").trim();
    const cClave = (row[12]||"").trim();
    if (cDNI === dni) {
      cliente = { estado:cEstado, clave:cClave };
      break;
    }
  }
  if (!cliente) {
    await logIntentoPedidos({ dni, ip, ua, motivo:"dni_no_registrado" });
    return okJSON(res, { error:"NO_CLIENTE" }, 403);
  }

  // Validar clave
  if (cliente.clave !== clave) {
    const fails = await upstash("INCR", `fail:dni:${dni}`);
    if (Number(fails || 0) === 1) await upstash("EXPIRE", `fail:dni:${dni}`, 1800);
    if (Number(fails || 0) >= 5) await upstash("SET", `lock:dni:${dni}`, "1", "EX", 1800);
    await logIntentoPedidos({ dni, ip, ua, motivo:"clave_incorrecta" });
    return okJSON(res, { error:"BAD_KEY" }, 403);
  }

  // Validar estado
  if ((cliente.estado || "").toLowerCase() !== "validado") {
    await logIntentoPedidos({ dni, ip, ua, motivo:"estado_no_validado" });
    return okJSON(res, { error:"NO_VALIDADO" }, 403);
  }

  // Map de viandas habilitadas
  const mapVianda = new Map();
  for (let i=1; i<viandas.length; i++){
    const [IdVianda, Nombre, Descripcion, Precio, Imagen, Disponible] = viandas[i] || [];
    if (parseBool(Disponible, false)) {
      mapVianda.set(String(IdVianda), { IdVianda, Nombre, Precio: toInt(Precio, 0) });
    }
  }

  // Normalizar carrito y total
  const normItems = [];
  let total = 0;
  for (const it of items) {
    const id = String(it?.idVianda || it?.id || "").trim();
    const qty = toInt(it?.cantidad, 0);
    const info = mapVianda.get(id);
    if (!info) continue;
    if (qty <= 0) continue;
    if (qty > MAX_QTY) return okJSON(res, { error:"QTY_LIMIT", id }, 400);
    const sub = qty * info.Precio;
    total += sub;
    normItems.push({ id: info.IdVianda, nombre: info.Nombre, cantidad: qty, precio: info.Precio, subtotal: sub });
  }
  if (!normItems.length) return okJSON(res, { error:"CART_EMPTY" }, 400);

  // Antidoble envío (10s) DNI+IP+carrito
  const fingerprint = `${dni}:${ip}:${hashCart(normItems.map(x => ({id:x.id, c:x.cantidad})) )}`;
  const keyDouble = `dup:${fingerprint}`;
  const first = await setnxTTL(keyDouble, 10);
  if (!first) return okJSON(res, { error:"DUP_CLICK" }, 409);

  // Nuevo IdPedido
  let maxId = 10000;
  for (let i=1; i<pedidosColA.length; i++){
    const v = toInt(pedidosColA[i][0], 0);
    if (v > maxId) maxId = v;
  }
  const IdPedido = maxId + 1;

  // Escribir filas
  const ts = nowISO();
  const uaStr = (req.headers["user-agent"] || "").slice(0, 500);
  const rows = normItems.map(it => ([
    IdPedido,             // A
    dni,                  // B
    it.nombre,            // C (Nombre vianda)
    it.cantidad,          // D
    comentarios,          // E
    it.subtotal,          // F (SUBTOTAL)
    ts,                   // G
    ip,                   // H
    uaStr                 // I
  ]));
  await sheetsAppend(`${SHEET_PEDIDOS}!A:I`, rows);

  return okJSON(res, { ok:true, idPedido: IdPedido, total });
}

// ---------- Handler principal

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") return handleOPTIONS(req, res);
    setCORS(res);

    if (!SPREADSHEET_ID || !SA.client_email || !SA.private_key) {
      return okJSON(res, { error:"MISCONFIG" }, 500);
    }

    const route = (req.query?.route || req.query?.r || "").toString();
    if (req.method === "GET"  && route === "ui-config") return routeUIConfig(req, res);
    if (req.method === "GET"  && route === "viandas")   return routeViandas(req, res);
    if (req.method === "POST" && route === "pedido")     return routePedido(req, res);

    return okJSON(res, { error:"NOT_FOUND" }, 404);
  } catch (e) {
    console.error("API error:", e);
    return okJSON(res, { error:"SERVER" }, 500);
  }
}
