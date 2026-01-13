// /api/pedidos.js — Vercel Serverless
import { google } from "googleapis";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: SCOPES,
});
const sheets = google.sheets({ version: "v4", auth });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "https://pedidos.amaranta.ar";
const REQUIRED_API_KEY = process.env.API_KEY || "";

const SHEET_VIANDAS = "Viandas";
const SHEET_CLIENTES = "Clientes";
const SHEET_PEDIDOS = "Pedidos";
const SHEET_CONFIG = "Configuracion";

const UP_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

const MIN_START_ID = 10001;

// ---------- CORS / response ----------
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
}
function ok(res, data) {
  setCors(res);
  return res.status(200).json({ ok: true, ...data });
}
function err(res, code, error, extra = {}) {
  setCors(res);
  return res.status(code).json({ ok: false, error, ...extra });
}
function requireKey(req, res) {
  if (!REQUIRED_API_KEY) return true;
  const k = String(req.headers["x-api-key"] || "");
  if (k && k === REQUIRED_API_KEY) return true;
  err(res, 401, "UNAUTHORIZED");
  return false;
}

// ---------- Config ----------
async function readConfigKV() {
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CONFIG}!A:B`,
    });
    const rows = r.data.values || [];
    const kv = {};
    for (const row of rows) {
      const k = row?.[0];
      const v = row?.[1];
      if (!k) continue;
      kv[String(k).trim()] = v;
    }
    return kv;
  } catch {
    return {};
  }
}

// ---------- Helpers ----------
function normalizeImage(u) {
  if (!u) return "";
  u = String(u).trim();
  let m = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;
  m = u.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;
  return u;
}

function normStr(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findHeaderIndex(headers, candidates) {
  const H = (headers || []).map((h) => normStr(h));
  const C = candidates.map((c) => normStr(c));

  for (const cand of C) {
    const i = H.indexOf(cand);
    if (i >= 0) return i;
  }
  for (let i = 0; i < H.length; i++) {
    for (const cand of C) {
      if (cand && H[i].includes(cand)) return i;
    }
  }
  return -1;
}

function normDni(v) {
  return String(v ?? "").replace(/\D/g, "").trim();
}

// ✅ SOLO “Validado”
function isValidadoStrict(v) {
  return normStr(v) === "validado";
}

function toNumOrNull(v) {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------- Upstash ----------
const hasUpstash = () => !!(UP_URL && UP_TOKEN);

function upPath(cmd, ...parts) {
  return `${UP_URL}/${cmd}/${parts.map((p) => encodeURIComponent(String(p))).join("/")}`;
}
async function upCall(cmd, ...parts) {
  const r = await fetch(upPath(cmd, ...parts), {
    method: "POST",
    headers: { Authorization: `Bearer ${UP_TOKEN}` },
  });
  const j = await r.json().catch(() => ({}));
  return j.result;
}
async function upGet(key) { return upCall("get", key); }
async function upSet(key, value) { return upCall("set", key, value); }
async function upIncr(key) { return upCall("incr", key); }
async function upDel(key) { return upCall("del", key); }
async function upTtl(key) { return upCall("ttl", key); }
async function upExpire(key, sec) { return upCall("expire", key, sec); }
async function upSetEx(key, sec, value) { return upCall("setex", key, sec, value); }

// ---------- Rate limit (Upstash) ----------
const RL_DNI_FAILS = 5;
const RL_DNI_WINDOW_SEC = 10 * 60;
const RL_DNI_BLOCK_SEC = 15 * 60;

const RL_IP_FAILS = 25;
const RL_IP_WINDOW_SEC = 10 * 60;
const RL_IP_BLOCK_SEC = 15 * 60;

function rlKeys(dni, ip) {
  return {
    dniFail: `rl:ped:fail:dni:${dni}`,
    dniBlock: `rl:ped:block:dni:${dni}`,
    ipFail: `rl:ped:fail:ip:${ip}`,
    ipBlock: `rl:ped:block:ip:${ip}`,
  };
}

async function checkBlocked(dni, ip) {
  if (!hasUpstash()) return { blocked: false };

  const k = rlKeys(dni, ip);
  const [bDni, bIp] = await Promise.all([upGet(k.dniBlock), ip ? upGet(k.ipBlock) : null]);

  if (bDni != null) {
    let ttl = Number(await upTtl(k.dniBlock));
    if (!Number.isFinite(ttl) || ttl < 1) ttl = RL_DNI_BLOCK_SEC;
    return { blocked: true, retryAfterSeconds: ttl, scope: "dni" };
  }
  if (ip && bIp != null) {
    let ttl = Number(await upTtl(k.ipBlock));
    if (!Number.isFinite(ttl) || ttl < 1) ttl = RL_IP_BLOCK_SEC;
    return { blocked: true, retryAfterSeconds: ttl, scope: "ip" };
  }
  return { blocked: false };
}

async function registerFail(dni, ip) {
  if (!hasUpstash()) return;
  const k = rlKeys(dni, ip);

  const n = Number(await upIncr(k.dniFail));
  await upExpire(k.dniFail, RL_DNI_WINDOW_SEC);
  if (n >= RL_DNI_FAILS) {
    await upSetEx(k.dniBlock, RL_DNI_BLOCK_SEC, "1");
    await upDel(k.dniFail);
  }

  if (ip) {
    const m = Number(await upIncr(k.ipFail));
    await upExpire(k.ipFail, RL_IP_WINDOW_SEC);
    if (m >= RL_IP_FAILS) {
      await upSetEx(k.ipBlock, RL_IP_BLOCK_SEC, "1");
      await upDel(k.ipFail);
    }
  }
}

async function clearFails(dni, ip) {
  if (!hasUpstash()) return;
  const k = rlKeys(dni, ip);
  await Promise.all([upDel(k.dniFail), ip ? upDel(k.ipFail) : Promise.resolve()]);
}

// ---------- IdPedido con fallback J1 ----------
async function readPedidosJ1() {
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PEDIDOS}!J1`,
    });
    const v = r.data.values?.[0]?.[0];
    const n = Number(String(v ?? "").trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function updatePedidosJ1(lastId) {
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PEDIDOS}!J1`,
      valueInputOption: "RAW",
      requestBody: { values: [[String(lastId)]] },
    });
  } catch {
    // no frenamos el pedido por esto
  }
}

async function readLastIdFromSheetA() {
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PEDIDOS}!A:A`,
    });
    const values = r.data.values || [];
    if (!values.length) return null;

    for (let i = values.length - 1; i >= 0; i--) {
      const n = Number(String(values[i]?.[0] ?? "").trim());
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  } catch {
    return null;
  }
}

async function getNextIdPedido() {
  const key = "id:pedidos:last";

  if (hasUpstash()) {
    let current = await upGet(key);

    if (current == null) {
      // Inicializar desde hoja/J1 si es la primera vez
      const j1 = await readPedidosJ1();
      const lastSheet = await readLastIdFromSheetA();
      const base = Number.isFinite(lastSheet)
        ? lastSheet
        : Number.isFinite(j1)
          ? j1
          : (MIN_START_ID - 1);

      await upSet(key, String(base));
    }

    let n = Number(await upIncr(key));

    if (!Number.isFinite(n) || n < MIN_START_ID) {
      await upSet(key, String(MIN_START_ID - 1));
      n = Number(await upIncr(key));
    }

    return n;
  }

  // Sin Upstash: si hay registros, último + 1; si está vacío, J1 + 1
  const lastSheet = await readLastIdFromSheetA();
  if (Number.isFinite(lastSheet)) return lastSheet + 1;

  const j1 = await readPedidosJ1();
  if (Number.isFinite(j1)) return j1 + 1;

  return MIN_START_ID;
}

// ---------- Handler ----------
export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    setCors(res);
    return res.status(200).end();
  }
  if (!requireKey(req, res)) return;

  const route = String(req.query.route || "").toLowerCase();

  // GET ui-config
  if (req.method === "GET" && route === "ui-config") {
    const kv = await readConfigKV();
    return ok(res, {
      FORM_ENABLED: String(kv.FORM_ENABLED ?? "true"),
      FORM_CLOSED_TITLE: kv.FORM_CLOSED_TITLE ?? "Pedidos temporalmente cerrados",
      FORM_CLOSED_MESSAGE: kv.FORM_CLOSED_MESSAGE ?? "Estamos atendiendo por WhatsApp.",

      THEME_PRIMARY: kv.THEME_PRIMARY ?? "",
      THEME_SECONDARY: kv.THEME_SECONDARY ?? "",
      THEME_BG: kv.THEME_BG ?? "",
      THEME_TEXT: kv.THEME_TEXT ?? "",
      RADIUS: kv.RADIUS ?? "16",
      SPACING: kv.SPACING ?? "8",

      ASSET_HEADER_URL: normalizeImage(kv.ASSET_HEADER_URL ?? ""),
      ASSET_PLACEHOLDER_IMG_URL: normalizeImage(kv.ASSET_PLACEHOLDER_IMG_URL ?? ""),
      ASSET_LOGO_URL: normalizeImage(kv.ASSET_LOGO_URL ?? ""),

      UI_MAX_QTY_POR_VIANDA: kv.UI_MAX_QTY_POR_VIANDA ?? "9",
      UI_RESUMEN_ITEMS_VISIBLES: kv.UI_RESUMEN_ITEMS_VISIBLES ?? "4",

      MSG_EMPTY: kv.MSG_EMPTY ?? "No hay viandas disponibles por ahora.",
      MSG_AUTH_FAIL: kv.MSG_AUTH_FAIL ?? "DNI o clave incorrectos o cliente no validado.",
      MSG_LIMIT: kv.MSG_LIMIT ?? "Máximo 9 por vianda.",
      MSG_SERVER_FAIL: kv.MSG_SERVER_FAIL ?? "No pudimos completar el pedido. Probá más tarde.",

      WA_ENABLED: String(kv.WA_ENABLED ?? "true"),
      WA_TEMPLATE: kv.WA_TEMPLATE ?? "",
      WA_PHONE_TARGET: kv.WA_PHONE_TARGET ?? "",

      PAY_ALIAS: kv.PAY_ALIAS ?? "",
      PAY_NOTE: kv.PAY_NOTE ?? "",
    });
  }

  // GET viandas
  if (req.method === "GET" && route === "viandas") {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_VIANDAS}!A:G`,
    });

    const values = r.data.values || [];
    const items = [];

    for (let i = 1; i < values.length; i++) {
      const row = values[i] || [];
      const disponible = String(row[5]).toLowerCase() === "true";
      if (!disponible) continue;

      const precio = toNumOrNull(row[3]) ?? 0;

      items.push({
        IdVianda: row[0],
        Nombre: row[1],
        Descripcion: row[2],
        Precio: precio,
        Imagen: normalizeImage(row[4]),
        Orden: row[6] ?? "",
      });
    }

    items.sort((a, b) => {
      const ao = toNumOrNull(a.Orden);
      const bo = toNumOrNull(b.Orden);
      if (ao != null && bo != null && ao !== bo) return ao - bo;
      if (ao != null && bo == null) return -1;
      if (ao == null && bo != null) return 1;
      return String(a.Nombre || "").localeCompare(String(b.Nombre || ""), "es", { sensitivity: "base" });
    });

    return ok(res, { items });
  }

  // POST pedido
  if (req.method === "POST" && route === "pedido") {
    const MAX_COMENT = 400, MAX_IP = 128, MAX_UA = 256;

    const body = req.body || {};
    const dni = normDni(body.dni);
    const clave = String(body.clave || "").trim();

    const ipHeader = (req.headers["x-forwarded-for"] ?? "").toString().split(",")[0] || req.socket?.remoteAddress || "";
    const ip = normStr(body.ip || ipHeader || "").slice(0, MAX_IP);
    const ua = (body.ua || req.headers["user-agent"] || "").toString().slice(0, MAX_UA);

    let comentarios = (body.comentarios ?? "").toString();
    comentarios = comentarios.replace(/\s+/g, " ").trim().slice(0, MAX_COMENT);

    const items = Array.isArray(body.items) ? body.items : [];

    if (!/^\d{8}$/.test(dni) || dni.startsWith("0") || !clave || !items.length) {
      return err(res, 400, "BAD_REQUEST");
    }

    // rate limit
    const blk = await checkBlocked(dni, ip);
    if (blk.blocked) {
      return err(res, 429, "RATE_LIMIT", { retryAfterSeconds: blk.retryAfterSeconds, scope: blk.scope });
    }

    // validar cliente por encabezados
    const rc = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CLIENTES}!A:Z`,
    });

    const valuesC = rc.data.values || [];
    const headers = valuesC[0] || [];
    const rowsC = valuesC.slice(1);

    const iDNI = findHeaderIndex(headers, ["DNI", "Documento"]);
    const iClave = findHeaderIndex(headers, ["Clave", "Password", "Pass"]);
    const iEstado = findHeaderIndex(headers, ["Estado"]); // si existe, exigimos Validado

    if (iDNI < 0 || iClave < 0) return err(res, 500, "CONFIG_ERROR");

    const match = rowsC.find((r) => normDni(r?.[iDNI]) === dni);
    const claveSheet = match ? String(match[iClave] ?? "").trim() : "";
    const estadoSheet = match && iEstado >= 0 ? String(match[iEstado] ?? "") : "";

    const okEstado = (iEstado < 0) ? true : isValidadoStrict(estadoSheet);

    if (!match || claveSheet !== clave || !okEstado) {
      await registerFail(dni, ip);
      return err(res, 401, "AUTH_FAIL");
    }

    await clearFails(dni, ip);

    // mapa precios desde viandas
    const rv = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_VIANDAS}!A:D`,
    });
    const rowsV = rv.data.values?.slice(1) || [];
    const map = new Map();
    for (const row of rowsV) {
      if (!row || row.length < 4) continue;
      const id = String(row[0]);
      const precio = toNumOrNull(row[3]) ?? 0;
      map.set(id, { nombre: row[1], precio });
    }

    const idPedido = await getNextIdPedido();

    let total = 0;
    const toAppend = [];

    for (const it of items) {
      const id = String(it.idVianda || "");
      let qty = parseInt(it.cantidad || 0, 10);
      if (!id || !qty) continue;

      qty = Math.max(0, Math.min(9, qty));
      const v = map.get(id);
      if (!v) continue;

      const subtotal = v.precio * qty;
      total += subtotal;

      toAppend.push([
        idPedido,                 // A IdPedido
        String(dni),              // B DNI
        v.nombre,                 // C Nombre
        qty,                      // D Cantidad
        comentarios,              // E Comentarios
        subtotal,                 // F Subtotal
        new Date().toISOString(), // G Timestamp
        ip,                       // H IP
        ua,                       // I UA
      ]);
    }

    if (!toAppend.length) return err(res, 400, "NO_ITEMS");

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PEDIDOS}!A:I`,
      valueInputOption: "RAW",
      requestBody: { values: toAppend },
    });

    // ✅ Guardamos el último ID en J1 automáticamente
    await updatePedidosJ1(idPedido);

    return ok(res, { idPedido, total });
  }

  return err(res, 404, "ROUTE_NOT_FOUND");
}
