// /api/pedidos.js
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

// Bloqueo por DNI (para frenar brute force / claves equivocadas)
// Por defecto: ACTIVADO. Podés apagarlo con DNI_BLOCK_ENABLED="false".
const DNI_BLOCK_ENABLED = String(process.env.DNI_BLOCK_ENABLED || "true").toLowerCase() === "true";
const DNI_FAIL_MAX = Number(process.env.DNI_FAIL_MAX || 15);                  // a partir de cuántos fails bloquea
const DNI_FAIL_WINDOW_SECONDS = Number(process.env.DNI_FAIL_WINDOW_SECONDS || 1800); // ventana para contar fails (30 min)
const DNI_BLOCK_SECONDS = Number(process.env.DNI_BLOCK_SECONDS || 900);       // bloqueo (15 min)

const SHEET_VIANDAS = "Viandas";
const SHEET_CLIENTES = "Clientes";
const SHEET_PEDIDOS = "Pedidos";
const SHEET_CONFIG = "Configuracion";
const SHEET_ZONAS = "Zonas";

// ✅ Hoja para contador atómico (IDs únicos aun sin Upstash)
const SHEET_COUNTERS = "Counters";
const COUNTERS_BASE_CELL = `${SHEET_COUNTERS}!D2`;
const COUNTERS_HEADER_CELL = `${SHEET_COUNTERS}!A1`;

// ✅ Hoja para auditar intentos y eventos (append, no frena el pedido si falla)
const SHEET_INTENTOS = "Intentos";

// ✅ Fallbacks (para que nunca falte alias / nota si Sheets falla)
const DEFAULT_PAY_ALIAS = String(process.env.DEFAULT_PAY_ALIAS || process.env.PAY_ALIAS_DEFAULT || "").trim();
const DEFAULT_PAY_NOTE  = String(process.env.DEFAULT_PAY_NOTE  || process.env.PAY_NOTE_DEFAULT  || "").trim();

// ✅ Comentarios (por defecto apagados; se puede prender desde Configuracion: COMMENTS_ENABLED=true)
const COMMENTS_ENABLED_DEFAULT = String(process.env.COMMENTS_ENABLED_DEFAULT || "false").toLowerCase() === "true";


// Guardamos último IdPedido en K1 (como venías usando)
const LAST_ID_CELL = `${SHEET_PEDIDOS}!K1`;

const UP_URL = (process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
const UP_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";

// Prefijo opcional para evitar colisiones de keys en Upstash (recomendado si compartis Redis con otros modulos)
const UPSTASH_KEY_PREFIX = String(process.env.UPSTASH_KEY_PREFIX || "").trim();

// Guardar User-Agent en Sheets (Pedidos/Intentos). Por defecto: false
const STORE_UA = String(process.env.STORE_UA || process.env.STORE_USER_AGENT || "false").toLowerCase() === "true";

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
function isFormEnabled(kv) {
  return String(kv?.FORM_ENABLED ?? "true").trim().toLowerCase() === "true";
}

// ---------- Auditoría Intentos ----------
async function logIntento({ dni, clave, evento, attempts = "", blocked = "", message = "", ip = "", ua = "" }) {
  try {
    const now = new Date();
    const tsBA = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    }).format(now); // YYYY-MM-DD HH:mm:ss
    const day = buenosAiresDayKey(now);
    const row = [
      tsBA,
      day,
      String(dni ?? ""),
      String(clave ?? ""), // ⚠️ pedido del usuario: texto plano
      String(evento ?? ""),
      String(attempts ?? ""),
      String(blocked ?? ""),
      String(ip ?? ""),
      String(ua ?? ""),
      String(message ?? ""),
    ];
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_INTENTOS}!A:J`,
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  } catch {}
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
function isValidadoStrict(v) {
  return normStr(v) === "validado";
}
function toNumOrNull(v) {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function normalizeFormaPago(v) {
  const s = normStr(v);
  if (s === "efectivo") return "Efectivo";
  if (s === "transferencia") return "Transferencia";
  return "Transferencia";
}
function isTrueSheet(v) {
  return String(v ?? "").trim().toLowerCase() === "true";
}

// ✅ Zonas: valida habilitación + devuelve mensaje (por Zona del cliente)
async function getZonaInfoByNombre(zonaNombre) {
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_ZONAS}!A:Z`,
    });

    const values = r.data.values || [];
    if (!values.length) return { found: false, enabled: false, mensaje: "" };

    const headers = values[0] || [];
    const rows = values.slice(1);

    let iZona = findHeaderIndex(headers, ["Zona"]);
    let iEstado = findHeaderIndex(headers, ["Estado"]);
    let iMensaje = findHeaderIndex(headers, ["Mensaje"]);

    if (iZona < 0) iZona = 0;       // A
    if (iEstado < 0) iEstado = 1;   // B
    if (iMensaje < 0) iMensaje = 3; // D (hoy D2:D)

    const target = normStr(zonaNombre);

    for (const row of rows) {
      const z = String(row?.[iZona] ?? "").trim();
      if (!z) continue;
      if (normStr(z) !== target) continue;

      const enabled = isTrueSheet(row?.[iEstado]);
      const mensaje = String(row?.[iMensaje] ?? "").trim();
      return { found: true, enabled, mensaje };
    }

    return { found: false, enabled: false, mensaje: "" };
  } catch {
    return { found: false, enabled: false, mensaje: "" };
  }
}

// ---------- Upstash ----------
const hasUpstash = () => !!(UP_URL && UP_TOKEN);

function upKey(key){
  return UPSTASH_KEY_PREFIX ? `${UPSTASH_KEY_PREFIX}:${key}` : String(key);
}

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
async function upGet(key) { return upCall("get", upKey(key)); }
async function upSet(key, value, ...opts) { return upCall("set", upKey(key), value, ...opts); }
async function upIncr(key) { return upCall("incr", upKey(key)); }
async function upDel(key) { return upCall("del", upKey(key)); }

// helpers
async function upExpire(key, seconds) { return upCall("expire", upKey(key), seconds); }
async function upTtl(key) { return upCall("ttl", upKey(key)); }

// (bloqueo DNI) — cuenta intentos fallidos y bloquea
function dniFailKey(dni){
  return `authfail:v2:${buenosAiresDayKey()}:dni:${dni}`;
}
function dniBlockKey(dni){
  return `authblock:v2:${buenosAiresDayKey()}:dni:${dni}`;
}

async function checkBlockedDni(dni){
  if (!DNI_BLOCK_ENABLED || !hasUpstash()) return { blocked:false };
  const k = dniBlockKey(dni);
  const v = await upGet(k);
  if (v == null) return { blocked:false };
  let ttl = Number(await upTtl(k));
  if (!Number.isFinite(ttl) || ttl <= 0) ttl = DNI_BLOCK_SECONDS;
  return { blocked:true, retryAfterSeconds: ttl };
}

async function registerFailDni(dni){
  if (!DNI_BLOCK_ENABLED || !hasUpstash()) return { blocked:false };
  const k = dniFailKey(dni);
  let n = Number(await upIncr(k));
  if (n === 1) {
    // ventana para contar intentos
    await upExpire(k, DNI_FAIL_WINDOW_SECONDS);
  }
  if (!Number.isFinite(n)) n = DNI_FAIL_MAX; // por las dudas
  if (n >= DNI_FAIL_MAX) {
    const bk = dniBlockKey(dni);
    await upSet(bk, "1", "EX", String(DNI_BLOCK_SECONDS));
    let ttl = Number(await upTtl(bk));
    if (!Number.isFinite(ttl) || ttl <= 0) ttl = DNI_BLOCK_SECONDS;
    return { blocked:true, retryAfterSeconds: ttl, attempts: n };
  }
  return { blocked:false, attempts: n };
}

async function clearFailDni(dni){
  if (!DNI_BLOCK_ENABLED || !hasUpstash()) return;
  await upDel(dniFailKey(dni));
  await upDel(dniBlockKey(dni));
}

// ---------- IdPedido (blindado) ----------
async function readLastIdCell() {
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: LAST_ID_CELL,
    });
    const v = r.data.values?.[0]?.[0];
    const n = Number(String(v ?? "").trim());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
async function updateLastIdCell(lastId) {
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: LAST_ID_CELL,
      valueInputOption: "RAW",
      requestBody: { values: [[String(lastId)]] },
    });
  } catch {}
}
// ⚠️ viejo: leer columna A desde abajo puede mentir si hay residuos; lo dejamos solo como último recurso
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

async function ensureCountersBaseInitialized() {
  // Devuelve el BASE (último id ya usado) almacenado en Counters!D2.
  // Si no existe, lo inicializa usando K1 (preferido) y la cantidad de filas ya existentes en Counters.
  const rBase = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: COUNTERS_BASE_CELL });
  const baseCell = rBase.data.values?.[0]?.[0];
  let base = Number(String(baseCell ?? "").trim());
  if (Number.isFinite(base) && base >= (MIN_START_ID - 1)) return base;

  // Asegurar header en A1 (no rompe si ya está)
  try {
    const rh = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: COUNTERS_HEADER_CELL });
    const hv = rh.data.values?.[0]?.[0];
    if (!hv) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: COUNTERS_HEADER_CELL,
        valueInputOption: "RAW",
        requestBody: { values: [["TS"]] },
      });
    }
  } catch {}

  // Contar filas ya existentes (por si Counters ya estaba en uso)
  let existing = 0;
  try {
    const rA = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${SHEET_COUNTERS}!A:A` });
    const vals = rA.data.values || [];
    if (vals.length > 1) existing = vals.length - 1;
  } catch {}

  const k1 = await readLastIdCell();
  const lastSheet = await readLastIdFromSheetA();
  const lastKnown = Number.isFinite(k1) ? k1 : (Number.isFinite(lastSheet) ? lastSheet : (MIN_START_ID - 1));
  base = Math.max(MIN_START_ID - 1, lastKnown - existing);

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: COUNTERS_BASE_CELL,
      valueInputOption: "RAW",
      requestBody: { values: [[String(base)]] },
    });
  } catch {}
  return base;
}

async function getNextIdPedidoFromCounters() {
  const base = await ensureCountersBaseInitialized();
  const r = await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_COUNTERS}!A:A`,
    valueInputOption: "RAW",
    requestBody: { values: [[new Date().toISOString()]] },
  });
  const updated = r.data?.updates?.updatedRange || "";
  const m = updated.match(/!A(\d+)/);
  const rowNum = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(rowNum) || rowNum < 2) throw new Error('COUNTERS_RANGE_PARSE');
  const seq = rowNum - 1; // fila 2 => seq 1
  const id = base + seq;
  if (!Number.isFinite(id) || id < MIN_START_ID) throw new Error('COUNTERS_ID_BAD');
  return id;
}

async function getNextIdPedido() {
  // 1) Preferimos Counters (atómico, no depende de Upstash)
  try {
    return await getNextIdPedidoFromCounters();
  } catch {
    // si no existe Counters (o falla), caemos a modo legacy
  }

  const key = "id:pedidos:last";
  if (hasUpstash()) {
    let current = await upGet(key);
    if (current == null) {
      const k1 = await readLastIdCell();
      const lastSheet = await readLastIdFromSheetA();
      const base = Math.max(
        MIN_START_ID - 1,
        Number.isFinite(k1) ? k1 : (MIN_START_ID - 1),
        Number.isFinite(lastSheet) ? lastSheet : (MIN_START_ID - 1)
      );
      // NX: evita que dos pedidos simultáneos reinicialicen el contador
      await upSet(key, String(base), "NX");
    }
    let n = Number(await upIncr(key));
    if (!Number.isFinite(n) || n < MIN_START_ID) {
      await upSet(key, String(MIN_START_ID - 1));
      n = Number(await upIncr(key));
    }
    return n;
  }

  // Legacy sin Upstash: K1 manda (y A:A solo de respaldo)
  const k1 = await readLastIdCell();
  if (Number.isFinite(k1)) return k1 + 1;
  const lastSheet = await readLastIdFromSheetA();
  if (Number.isFinite(lastSheet)) return lastSheet + 1;
  return MIN_START_ID;
}

// ---------- Anti-duplicados (1 pedido por DNI por día) ----------
function buenosAiresDayKey(d = new Date()){
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // YYYY-MM-DD
}

async function acquireDniDayLock(dni){
  // Si hay Upstash: lock atómico. Si no: lo manejamos con check en sheet.
  if (!hasUpstash()) return { ok:true, key:null };

  const day = buenosAiresDayKey();
  // v2: así evitamos cualquier residuo de keys viejas
  const key = `order:v2:${day}:dni:${dni}`;

  // SET key LOCKED EX 93600 NX (26h), atómico
  const r = await upSet(key, `LOCKED|${dni}`, "EX", "93600", "NX");
  if (r === "OK") return { ok:true, key };

  const current = await upGet(key); // "LOCKED" o un idPedido ya finalizado
  return { ok:false, key, current };
}

async function finalizeDniDayLock(key, idPedido, dni){
  if (!key || !hasUpstash()) return;
  // Setea el idPedido conservando TTL
  await upSet(key, `${String(idPedido)}|${String(dni)}`, "XX", "KEEPTTL");
}

async function releaseDniDayLock(key){
  if (!key || !hasUpstash()) return;
  await upDel(key);
}

// Busca pedido existente HOY por DNI y arma ticket (más eficiente: contiguo por IdPedido)
async function findExistingOrderTodayByDni(dni){
  const today = buenosAiresDayKey();
  const dniN = normDni(dni);

  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PEDIDOS}!A:J`,
  });

  const values = r.data.values || [];
  if (values.length < 2) return null;

  const headers = values[0] || [];
  const rows = values.slice(1);

  let iId = findHeaderIndex(headers, ["IdPedido","IDPedido","Pedido"]);
  let iDni = findHeaderIndex(headers, ["DNI","Documento"]);
  let iV = findHeaderIndex(headers, ["Vianda","Producto","Item"]);
  let iQ = findHeaderIndex(headers, ["Cantidad","Qty"]);
  let iSub = findHeaderIndex(headers, ["Precio","Importe","Subtotal"]);
  let iFP = findHeaderIndex(headers, ["FormaPago","Forma de pago","Pago"]);
  let iTS = findHeaderIndex(headers, ["TimeStamp","Timestamp","Fecha"]);

  // fallback fijo A:J
  if (iId < 0) iId = 0;
  if (iDni < 0) iDni = 1;
  if (iV < 0) iV = 2;
  if (iQ < 0) iQ = 3;
  if (iSub < 0) iSub = 5;
  if (iFP < 0) iFP = 6;
  if (iTS < 0) iTS = 7;

  // 1) encontrar el idPedido más reciente de HOY para ese DNI
  let foundIndex = -1;
  let idPedido = "";
  let tsFound = "";
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i] || [];
    if (normDni(row?.[iDni]) !== dniN) continue;

    const ts = String(row?.[iTS] ?? "").trim();
    const dt = new Date(ts);
    if (!Number.isFinite(dt.getTime())) continue;

    const dayKey = buenosAiresDayKey(dt);
    if (dayKey !== today) continue;

    idPedido = String(row?.[iId] ?? "").trim();
    if (!idPedido) continue;

    foundIndex = i;
    tsFound = ts;
    break;
  }

  if (foundIndex < 0 || !idPedido) return null;

  // 2) juntar filas contiguas con ese idPedido
  const items = [];
  let total = 0;
  let formaPago = "";

  // hacia arriba
  for (let i = foundIndex; i >= 0; i--) {
    const row = rows[i] || [];
    if (String(row?.[iId] ?? "").trim() !== idPedido) break;
    if (normDni(row?.[iDni]) !== dniN) continue;

    const nombre = String(row?.[iV] ?? "").trim();
    const cantidad = parseInt(String(row?.[iQ] ?? "0"), 10) || 0;
    const sub = toNumOrNull(row?.[iSub]) ?? 0;

    if (!formaPago) formaPago = String(row?.[iFP] ?? "").trim();

    if (nombre && cantidad > 0) {
      const unit = cantidad ? Math.round(sub / cantidad) : sub;
      items.unshift({ nombre, cantidad, precio: unit });
      total += sub;
    }
  }
  // hacia abajo
  for (let i = foundIndex + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (String(row?.[iId] ?? "").trim() !== idPedido) break;
    if (normDni(row?.[iDni]) !== dniN) continue;

    const nombre = String(row?.[iV] ?? "").trim();
    const cantidad = parseInt(String(row?.[iQ] ?? "0"), 10) || 0;
    const sub = toNumOrNull(row?.[iSub]) ?? 0;

    if (!formaPago) formaPago = String(row?.[iFP] ?? "").trim();

    if (nombre && cantidad > 0) {
      const unit = cantidad ? Math.round(sub / cantidad) : sub;
      items.push({ nombre, cantidad, precio: unit });
      total += sub;
    }
  }

  const fecha = tsFound
    ? new Date(tsFound).toLocaleString("es-AR", { timeZone:"America/Argentina/Buenos_Aires" })
    : new Date().toLocaleString("es-AR", { timeZone:"America/Argentina/Buenos_Aires" });

  return { dni: dniN, idPedido, items, total, fecha, formaPago: String(formaPago || "").trim() };
}

// ---------- Handler ----------
export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      setCors(res);
      return res.status(200).end();
    }
    if (!requireKey(req, res)) return;

    const route = String(req.query.route || "").toLowerCase();

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
        ASSET_HEADER_DESKTOP_URL: normalizeImage(kv.ASSET_HEADER_DESKTOP_URL ?? ""),

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

        PAY_ALIAS: String((kv.PAY_ALIAS ?? DEFAULT_PAY_ALIAS) ?? "").trim(),
        PAY_NOTE: String((kv.PAY_NOTE ?? DEFAULT_PAY_NOTE) ?? "").trim(),

        COMMENTS_ENABLED: String(kv.COMMENTS_ENABLED ?? (COMMENTS_ENABLED_DEFAULT ? "true" : "false")),
      });
    }

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

    if (req.method === "POST" && route === "pedido") {
      const kv = await readConfigKV();
      if (!isFormEnabled(kv)) {
        return err(res, 403, "FORM_CLOSED");
      }

      const MAX_COMENT = 400, MAX_IP = 128, MAX_UA = 256;

      const commentsEnabled = String(kv.COMMENTS_ENABLED ?? (COMMENTS_ENABLED_DEFAULT ? "true" : "false")).trim().toLowerCase() === "true";

      const body = req.body || {};
      const dni = String(body.dni || "").trim();
      const clave = String(body.clave || "").trim();

      const ipHeader = (req.headers["x-forwarded-for"] ?? "").toString().split(",")[0] || req.socket?.remoteAddress || "";
      const ip = normStr(body.ip || ipHeader || "").slice(0, MAX_IP);
      const ua = STORE_UA ? (body.ua || req.headers["user-agent"] || "").toString().slice(0, MAX_UA) : "";

      let comentarios = commentsEnabled ? (body.comentarios ?? "").toString() : "";
      comentarios = comentarios.replace(/\s+/g, " ").trim().slice(0, MAX_COMENT);

      const formaPago = normalizeFormaPago(body.formaPago);

      const items = Array.isArray(body.items) ? body.items : [];

      // ✅ DNI 7 u 8 dígitos
      if (!/^\d{7,8}$/.test(dni) || !clave || !items.length) {
        return err(res, 400, "BAD_REQUEST");
      }

      // Bloqueo DNI (para frenar brute force / insistencia)
      const blk = await checkBlockedDni(dni);
      if (blk.blocked) {
        await logIntento({ dni, clave, evento: "DNI_BLOCKED", blocked: "true", message: "Bloqueado por demasiados intentos", ip, ua });
        return err(res, 429, "DNI_BLOCKED", { retryAfterSeconds: blk.retryAfterSeconds || DNI_BLOCK_SECONDS });
      }

      // --- validar cliente ---
      const rc = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_CLIENTES}!A:Z`,
      });

      const valuesC = rc.data.values || [];
      const headers = valuesC[0] || [];
      const rowsC = valuesC.slice(1);

      const iDNI = findHeaderIndex(headers, ["DNI", "Documento"]);
      const iClave = findHeaderIndex(headers, ["Clave", "Password", "Pass"]);
      const iEstado = findHeaderIndex(headers, ["Estado"]);
      const iZona = findHeaderIndex(headers, ["Zona"]);

      if (iDNI < 0 || iClave < 0) return err(res, 500, "CONFIG_ERROR");

      const match = rowsC.find((r) => normDni(r?.[iDNI]) === dni);
      const claveSheet = match ? String(match[iClave] ?? "").trim() : "";
      const estadoSheet = match && iEstado >= 0 ? String(match[iEstado] ?? "") : "";
      const okEstado = (iEstado < 0) ? true : isValidadoStrict(estadoSheet);

      if (!match || claveSheet !== clave || !okEstado) {
        const f = await registerFailDni(dni);
        await logIntento({ dni, clave, evento: "AUTH_FAIL", attempts: String(f?.attempts ?? ""), blocked: String(!!f?.blocked), message: "Credenciales inválidas o no validado", ip, ua });
        if (f?.blocked) {
          return err(res, 429, "DNI_BLOCKED", {
            retryAfterSeconds: f.retryAfterSeconds || DNI_BLOCK_SECONDS,
            message: "Demasiados intentos. Esperá un rato y probá de nuevo.",
          });
        }
        return err(res, 401, "AUTH_FAIL", { message: kv.MSG_AUTH_FAIL || "DNI o clave incorrectos." });
      }

      await clearFailDni(dni);

      // ✅ validación de zona habilitada en pestaña Zonas
      if (iZona < 0) {
        return err(res, 500, "CONFIG_ERROR", { message: "Falta la columna Zona en Clientes." });
      }
      const zonaCliente = String(match?.[iZona] ?? "").trim();
      if (!zonaCliente) {
        return err(res, 403, "ZONA_NO_ASIGNADA", { message: "Tu zona no está asignada. Escribinos por WhatsApp." });
      }

      const zInfo = await getZonaInfoByNombre(zonaCliente);
      if (!zInfo.found) {
        return err(res, 403, "ZONA_NO_CONFIG", { message: "Tu zona no está configurada. Escribinos por WhatsApp." });
      }
      if (!zInfo.enabled) {
        await logIntento({ dni, clave, evento: "ZONA_CERRADA", message: "Zona cerrada", ip, ua });
        return err(res, 403, "ZONA_CERRADA", {
          message: "En tu zona ya cerró la toma de pedidos por hoy 🙂",
        });
      }
      const zonaMensaje = String(zInfo.mensaje || "").trim().slice(0, 400);

      // ✅ Anti-duplicados:
      // - Si hay Upstash: lock atómico por DNI+día
      // - Si no hay Upstash: chequeamos sheet (no es atómico, pero evita el 99% de duplicados)
      let lockKey = null;

      if (hasUpstash()) {
        const lock = await acquireDniDayLock(dni);

        if (!lock.ok) {
          // Si ya existe pedido hoy, devolvemos el existente
          const existing = await findExistingOrderTodayByDni(dni);

          const payAlias = String((kv.PAY_ALIAS || "") || DEFAULT_PAY_ALIAS || "").trim();
          const payNote = String((kv.PAY_NOTE || "") || DEFAULT_PAY_NOTE || "").trim();

          if (existing) {
            await logIntento({ dni, clave, evento: "DNI_ALREADY_ORDERED", message: "Duplicado del día", ip, ua });
            return err(res, 409, "DNI_ALREADY_ORDERED", {
              message: "Ese DNI ya tiene un pedido registrado hoy.",
              existingOrder: {
                dni: existing.dni,
                idPedido: existing.idPedido,
                items: existing.items,
                total: existing.total,
                fecha: existing.fecha,
                formaPago: existing.formaPago || "",
                zonaMensaje,
                payAlias,
                payNote,
              },
            });
          }

          // lockeado pero todavía no terminó de grabarse
          await logIntento({ dni, clave, evento: "ORDER_PROCESSING", message: "Pedido en proceso (lock ya tomado)", ip, ua });
          return err(res, 409, "ORDER_PROCESSING", {
            message: "Ya estamos procesando tu pedido. Esperá unos segundos 🙂",
          });
        }

        lockKey = lock.key;

        // ✅ Compat/Blindaje: aunque hayamos tomado el lock, chequeamos la sheet
        // por si ya había un pedido HOY para este DNI (p.ej. venías de una versión vieja sin v2).
        const existingPre = await findExistingOrderTodayByDni(dni);
        if (existingPre) {
          const payAlias = String((kv.PAY_ALIAS || "") || DEFAULT_PAY_ALIAS || "").trim();
          const payNote = String((kv.PAY_NOTE || "") || DEFAULT_PAY_NOTE || "").trim();

          await finalizeDniDayLock(lockKey, existingPre.idPedido, dni);
          return err(res, 409, "DNI_ALREADY_ORDERED", {
            message: "Ese DNI ya tiene un pedido registrado hoy.",
            existingOrder: {
              dni: existingPre.dni,
              idPedido: existingPre.idPedido,
              items: existingPre.items,
              total: existingPre.total,
              fecha: existingPre.fecha,
              formaPago: existingPre.formaPago || "",
              zonaMensaje,
              payAlias,
              payNote,
            },
          });
        }
      } else {
        const existing = await findExistingOrderTodayByDni(dni);
        if (existing) {
          const payAlias = String((kv.PAY_ALIAS || "") || DEFAULT_PAY_ALIAS || "").trim();
          const payNote = String((kv.PAY_NOTE || "") || DEFAULT_PAY_NOTE || "").trim();

          return err(res, 409, "DNI_ALREADY_ORDERED", {
            message: "Ese DNI ya tiene un pedido registrado hoy.",
            existingOrder: {
              dni: existing.dni,
              idPedido: existing.idPedido,
              items: existing.items,
              total: existing.total,
              fecha: existing.fecha,
              formaPago: existing.formaPago || "",
              zonaMensaje,
              payAlias,
              payNote,
            },
          });
        }
      }

      // ---- si llegamos acá, se puede crear pedido ----
      try {
        // catálogo (nombre + precio)
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

          // A:J (10 cols)
          toAppend.push([
            idPedido,
            String(dni),
            v.nombre,
            qty,
            comentarios,
            subtotal,
            formaPago,
            new Date().toISOString(),
            ip,
            ua,
          ]);
        }

        if (!toAppend.length) return err(res, 400, "NO_ITEMS");

        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_PEDIDOS}!A:J`,
          valueInputOption: "RAW",
          requestBody: { values: toAppend },
        });

        await updateLastIdCell(idPedido);

        // ✅ finalizamos lock guardando el idPedido (evita que el próximo lo meta de nuevo)
        await finalizeDniDayLock(lockKey, idPedido, dni);

        // ✅ garantizamos alias/nota en la respuesta (evita "—" intermitente)
        const payAlias = String((kv.PAY_ALIAS || "") || DEFAULT_PAY_ALIAS || "").trim();
        const payNote = String((kv.PAY_NOTE || "") || DEFAULT_PAY_NOTE || "").trim();

        return ok(res, { idPedido, total, formaPago, zonaMensaje, payAlias, payNote });
      } catch (e) {
        // si falló en medio, liberamos lock (si había)
        await releaseDniDayLock(lockKey);
        throw e;
      }
    }

    return err(res, 404, "ROUTE_NOT_FOUND");
  } catch (e) {
    console.error("API ERROR:", e);
    return err(res, 500, "SERVER_ERROR", { message: "Error interno. Probá de nuevo." });
  }
}
