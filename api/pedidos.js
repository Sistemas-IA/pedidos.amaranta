// /api/pedidos.js
import { google } from "googleapis";
import { createHmac } from "crypto";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: SCOPES,
});
const sheets = google.sheets({ version: "v4", auth });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "https://pedidos.amaranta.ar";
const REQUIRED_API_KEY = process.env.API_KEY || "";
const RECEIPT_SIGNING_SECRET = String(
  process.env.RECEIPT_SIGNING_SECRET ||
  process.env.RECEIPT_SECRET ||
  REQUIRED_API_KEY ||
  SPREADSHEET_ID ||
  "amaranta-receipt-secret"
).trim();

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

// ✅ Operadores: DNIs que pueden cargar múltiples pedidos e ignorar zonas cerradas y bloqueo diario
// Ej: OPERATOR_DNI_LIST="12345678,23456789"
const OPERATOR_DNI_LIST = String(process.env.OPERATOR_DNI_LIST || "").trim();
function isOperatorDni(dni) {
  if (!OPERATOR_DNI_LIST) return false;
  const d = String(dni || "").trim();
  const set = new Set(
    OPERATOR_DNI_LIST
      .split(/[,\s;]+/g)
      .map(x => x.trim())
      .filter(Boolean)
  );
  return set.has(d);
}

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
    const tsBA = formatTimestampBA(now);
    const day = buenosAiresDayKey(now);
    const row = [
      tsBA,
      day,
      String(dni ?? ""),
      String(clave ?? ""),
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

function isEfectivoFormaPago(v) {
  return normStr(v) === "efectivo";
}
function maskSecretForLog(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const n = Math.min(12, s.length);
  return "*".repeat(n);
}
function formatTimestampBA(d = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  }).format(d);
}
function formatReceiptDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) {
    return new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  }
  return d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
}
function normalizeReceiptItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((it) => {
      const cantidad = Math.max(0, parseInt(String(it?.cantidad ?? "0"), 10) || 0);
      const precio = Math.max(0, toNumOrNull(it?.precio) ?? 0);
      const subtotalRaw = toNumOrNull(it?.subtotal);
      const subtotal = subtotalRaw != null ? Math.max(0, subtotalRaw) : (precio * cantidad);
      const nombre = String(it?.nombre ?? "").trim();
      if (!nombre || cantidad <= 0) return null;
      return { nombre, cantidad, precio, subtotal };
    })
    .filter(Boolean);
}
function buildReceiptPayload({ idPedido, dni, fechaIso, formaPago, total, items }) {
  return {
    v: 1,
    idPedido: String(idPedido ?? "").trim(),
    dni: normDni(dni),
    fechaIso: String(fechaIso ?? "").trim(),
    formaPago: normalizeFormaPago(formaPago),
    total: Number(total || 0),
    items: normalizeReceiptItems(items).map((it) => ({
      nombre: it.nombre,
      cantidad: it.cantidad,
      precio: it.precio,
      subtotal: it.subtotal,
    })),
  };
}
function signReceiptPayload(payload) {
  return createHmac("sha256", RECEIPT_SIGNING_SECRET)
    .update(JSON.stringify(payload))
    .digest("hex");
}
function makeReceiptCode(sig) {
  const s = String(sig || "").replace(/[^a-f0-9]/gi, "").toUpperCase();
  const short = (s || "00000000").slice(0, 8).padEnd(8, "0");
  return `AMA-${short.slice(0, 4)}-${short.slice(4, 8)}`;
}
function buildReceiptTextServer(order) {
  const efectivo = isEfectivoFormaPago(order?.formaPago);
  const lines = [];
  lines.push("Pedido confirmado ✅");
  if (order?.dni) lines.push(`DNI: ${order.dni}`);
  if (order?.idPedido) lines.push(`N° Pedido: ${order.idPedido}`);
  if (order?.fecha) lines.push(`Fecha: ${order.fecha}`);
  if (order?.formaPago) lines.push(`Pago: ${order.formaPago}`);
  if (order?.receiptCode) lines.push(`Código verificación: ${order.receiptCode}`);
  if (order?.zonaMensaje) lines.push(String(order.zonaMensaje).trim());

  if (!efectivo) {
    if (order?.payAlias) lines.push(`Alias: ${order.payAlias}`);
    if (order?.payNote) lines.push(String(order.payNote).trim());
  } else {
    lines.push("Pago en efectivo al recibir.");
  }

  lines.push("");
  lines.push("Detalle:");
  for (const it of normalizeReceiptItems(order?.items || [])) {
    lines.push(`- ${it.cantidad}× ${it.nombre} ($ ${Number(it.subtotal || (it.precio * it.cantidad)).toLocaleString("es-AR")})`);
  }

  lines.push("");
  lines.push(`Total: $ ${Number(order?.total || 0).toLocaleString("es-AR")}`);

  return lines.join("
");
}
function buildCanonicalReceipt({ idPedido, dni, fechaIso, formaPago, total, items, zonaMensaje = "", payAlias = "", payNote = "" }) {
  const payload = buildReceiptPayload({ idPedido, dni, fechaIso, formaPago, total, items });
  const receiptSig = signReceiptPayload(payload);
  const receiptCode = makeReceiptCode(receiptSig);
  const efectivo = isEfectivoFormaPago(payload.formaPago);

  const order = {
    dni: payload.dni,
    idPedido: payload.idPedido,
    fecha: formatReceiptDate(payload.fechaIso),
    fechaIso: payload.fechaIso,
    formaPago: payload.formaPago,
    zonaMensaje: String(zonaMensaje || "").trim(),
    payAlias: efectivo ? "" : String(payAlias || "").trim(),
    payNote: efectivo ? "" : String(payNote || "").trim(),
    items: payload.items,
    total: payload.total,
    receiptCode,
    receiptSig,
  };

  order.waText = buildReceiptTextServer(order);
  return order;
}
function isReceiptMatch(receipt, codeOrSig) {
  const probe = String(codeOrSig || "").trim();
  if (!probe || !receipt) return false;
  return probe === String(receipt.receiptCode || "") || probe === String(receipt.receiptSig || "");
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


// Lee Pedidos y devuelve filas + índices resueltos
async function readPedidosSheetData() {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PEDIDOS}!A:J`,
  });

  const values = r.data.values || [];
  const headers = values[0] || [];
  const rows = values.slice(1);

  let iId = findHeaderIndex(headers, ["IdPedido","IDPedido","Pedido"]);
  let iDni = findHeaderIndex(headers, ["DNI","Documento"]);
  let iV = findHeaderIndex(headers, ["Vianda","Producto","Item"]);
  let iQ = findHeaderIndex(headers, ["Cantidad","Qty"]);
  let iSub = findHeaderIndex(headers, ["Precio","Importe","Subtotal"]);
  let iFP = findHeaderIndex(headers, ["FormaPago","Forma de pago","Pago"]);
  let iTS = findHeaderIndex(headers, ["TimeStamp","Timestamp","Fecha"]);

  if (iId < 0) iId = 0;
  if (iDni < 0) iDni = 1;
  if (iV < 0) iV = 2;
  if (iQ < 0) iQ = 3;
  if (iSub < 0) iSub = 5;
  if (iFP < 0) iFP = 6;
  if (iTS < 0) iTS = 7;

  return { rows, idx: { iId, iDni, iV, iQ, iSub, iFP, iTS } };
}
function buildOrderFromPedidoRows(rows, idx) {
  const matches = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (!matches.length) return null;

  const idPedido = String(matches[0]?.[idx.iId] ?? "").trim();
  const dni = normDni(matches[0]?.[idx.iDni]);
  const formaPago = String(matches.find((row) => String(row?.[idx.iFP] ?? "").trim())?.[idx.iFP] ?? "").trim();
  const tsFound = String(matches.find((row) => String(row?.[idx.iTS] ?? "").trim())?.[idx.iTS] ?? "").trim();

  let total = 0;
  const items = [];

  for (const row of matches) {
    const nombre = String(row?.[idx.iV] ?? "").trim();
    const cantidad = parseInt(String(row?.[idx.iQ] ?? "0"), 10) || 0;
    const sub = Math.max(0, toNumOrNull(row?.[idx.iSub]) ?? 0);
    if (!nombre || cantidad <= 0) continue;
    const precio = cantidad ? Math.round(sub / cantidad) : sub;
    items.push({ nombre, cantidad, precio, subtotal: sub });
    total += sub;
  }

  if (!idPedido || !dni || !items.length) return null;

  const fechaIso = Number.isFinite(new Date(tsFound).getTime()) ? new Date(tsFound).toISOString() : new Date().toISOString();
  return {
    dni,
    idPedido,
    items,
    total,
    fechaIso,
    fecha: formatReceiptDate(fechaIso),
    formaPago: String(formaPago || "").trim(),
  };
}
// Busca pedido existente HOY por DNI
async function findExistingOrderTodayByDni(dni){
  const today = buenosAiresDayKey();
  const dniN = normDni(dni);
  const { rows, idx } = await readPedidosSheetData();
  if (!rows.length) return null;

  let latestId = "";
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i] || [];
    if (normDni(row?.[idx.iDni]) !== dniN) continue;
    const ts = String(row?.[idx.iTS] ?? "").trim();
    const dt = new Date(ts);
    if (!Number.isFinite(dt.getTime())) continue;
    if (buenosAiresDayKey(dt) !== today) continue;
    latestId = String(row?.[idx.iId] ?? "").trim();
    if (latestId) break;
  }
  if (!latestId) return null;

  const rowsById = rows.filter((row) =>
    String(row?.[idx.iId] ?? "").trim() === latestId &&
    normDni(row?.[idx.iDni]) === dniN
  );

  return buildOrderFromPedidoRows(rowsById, idx);
}
async function findOrderByIdPedido(idPedido) {
  const id = String(idPedido ?? "").trim();
  if (!id) return null;
  const { rows, idx } = await readPedidosSheetData();
  if (!rows.length) return null;

  const rowsById = rows.filter((row) => String(row?.[idx.iId] ?? "").trim() === id);
  return buildOrderFromPedidoRows(rowsById, idx);
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
        range: `${SHEET_VIANDAS}!A:H`,
      });

      const values = r.data.values || [];
      const items = [];

      for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        const disponible = String(row[5]).toLowerCase() === "true";
        if (!disponible) continue;

        const precio = toNumOrNull(row[3]) ?? 0;
        const precioEfectivo = (toNumOrNull(row[7]) ?? precio);


        items.push({
          IdVianda: row[0],
          Nombre: row[1],
          Descripcion: row[2],
          Precio: precio,
          PrecioEfectivo: precioEfectivo,
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


    if (req.method === "GET" && route === "verify-ticket") {
      const kv = await readConfigKV();
      const idPedido = String(req.query.idPedido || req.query.id || "").trim();
      const dni = normDni(req.query.dni || "");
      const code = String(req.query.code || req.query.receiptCode || req.query.sig || "").trim();

      if (!idPedido) return err(res, 400, "BAD_REQUEST", { message: "Falta idPedido." });

      const base = await findOrderByIdPedido(idPedido);
      if (!base) return err(res, 404, "ORDER_NOT_FOUND", { valid: false, message: "No encontramos ese pedido." });

      const payAlias = String((kv.PAY_ALIAS || "") || DEFAULT_PAY_ALIAS || "").trim();
      const payNote = String((kv.PAY_NOTE || "") || DEFAULT_PAY_NOTE || "").trim();
      const receipt = buildCanonicalReceipt({
        idPedido: base.idPedido,
        dni: base.dni,
        fechaIso: base.fechaIso,
        formaPago: base.formaPago,
        total: base.total,
        items: base.items,
        payAlias,
        payNote,
      });

      const dniMatches = !dni || normDni(receipt.dni) === dni;
      const signatureMatches = !code || isReceiptMatch(receipt, code);

      return ok(res, {
        valid: !!(dniMatches && signatureMatches),
        reason: !dniMatches ? "DNI_MISMATCH" : (!signatureMatches ? "SIGNATURE_MISMATCH" : "OK"),
        receipt,
      });
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
      const ip = String(ipHeader || "").trim().slice(0, MAX_IP);
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

      // ✅ Operador (por env var OPERATOR_DNI_LIST): ignora zona cerrada y bloqueo diario
      const isOperator = isOperatorDni(dni);
      let zonaMensaje = "";

      // ✅ validación de zona habilitada en pestaña Zonas (solo si NO es operador)
      if (!isOperator) {
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
        zonaMensaje = String(zInfo.mensaje || "").trim().slice(0, 400);
      } else {
        // operador: no aplica zona cerrada
        zonaMensaje = "";
      }

      // ✅ Anti-duplicados (1 por día) — solo si NO es operador
      let lockKey = null;

      if (!isOperator) {
        // - Si hay Upstash: lock atómico por DNI+día
        // - Si no hay Upstash: chequeamos sheet (no es atómico, pero evita el 99% de duplicados)
        if (hasUpstash()) {
          const lock = await acquireDniDayLock(dni);

          if (!lock.ok) {
            // Si ya existe pedido hoy, devolvemos el existente
            const existing = await findExistingOrderTodayByDni(dni);

            const payAlias = String((kv.PAY_ALIAS || "") || DEFAULT_PAY_ALIAS || "").trim();
            const payNote = String((kv.PAY_NOTE || "") || DEFAULT_PAY_NOTE || "").trim();

            if (existing) {
              await logIntento({ dni, clave, evento: "DNI_ALREADY_ORDERED", message: "Duplicado del día", ip, ua });
              const receipt = buildCanonicalReceipt({
                idPedido: existing.idPedido,
                dni: existing.dni,
                fechaIso: existing.fechaIso || new Date().toISOString(),
                formaPago: existing.formaPago || "",
                total: existing.total,
                items: existing.items,
                zonaMensaje,
                payAlias,
                payNote,
              });
              return err(res, 409, "DNI_ALREADY_ORDERED", {
                message: "Ese DNI ya tiene un pedido registrado hoy.",
                existingOrder: receipt,
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
            const receipt = buildCanonicalReceipt({
              idPedido: existingPre.idPedido,
              dni: existingPre.dni,
              fechaIso: existingPre.fechaIso || new Date().toISOString(),
              formaPago: existingPre.formaPago || "",
              total: existingPre.total,
              items: existingPre.items,
              zonaMensaje,
              payAlias,
              payNote,
            });

            await finalizeDniDayLock(lockKey, existingPre.idPedido, dni);
            return err(res, 409, "DNI_ALREADY_ORDERED", {
              message: "Ese DNI ya tiene un pedido registrado hoy.",
              existingOrder: receipt,
            });
          }
        } else {
          const existing = await findExistingOrderTodayByDni(dni);
          if (existing) {
            const payAlias = String((kv.PAY_ALIAS || "") || DEFAULT_PAY_ALIAS || "").trim();
            const payNote = String((kv.PAY_NOTE || "") || DEFAULT_PAY_NOTE || "").trim();
            const receipt = buildCanonicalReceipt({
              idPedido: existing.idPedido,
              dni: existing.dni,
              fechaIso: existing.fechaIso || new Date().toISOString(),
              formaPago: existing.formaPago || "",
              total: existing.total,
              items: existing.items,
              zonaMensaje,
              payAlias,
              payNote,
            });

            return err(res, 409, "DNI_ALREADY_ORDERED", {
              message: "Ese DNI ya tiene un pedido registrado hoy.",
              existingOrder: receipt,
            });
          }
        }
      }


      // ---- si llegamos acá, se puede crear pedido ----
      try {
        const rv = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_VIANDAS}!A:H`,
        });
        const rowsV = rv.data.values?.slice(1) || [];
        const map = new Map();
        for (const row of rowsV) {
          if (!row || row.length < 4) continue;
          const id = String(row[0] || "").trim();
          const nombre = String(row[1] || "").trim();
          const precioTransf = toNumOrNull(row[3]) ?? 0;
          const disponible = isTrueSheet(row[5]);
          const precioEfectivo = (toNumOrNull(row[7]) ?? precioTransf);
          if (!id || !nombre) continue;
          map.set(id, { nombre, precioTransf, precioEfectivo, disponible });
        }

        const isEfectivo = formaPago === "Efectivo";
        const idPedido = await getNextIdPedido();
        const fechaIso = new Date().toISOString();

        let total = 0;
        const toAppend = [];
        const canonicalItems = [];
        const grouped = new Map();

        for (const raw of items) {
          const id = String(raw?.idVianda || "").trim();
          const qty = parseInt(String(raw?.cantidad || "0"), 10) || 0;
          if (!id || qty <= 0) continue;
          grouped.set(id, (grouped.get(id) || 0) + qty);
        }

        for (const [id, qtyRaw] of grouped.entries()) {
          const qty = Math.max(0, Math.min(9, qtyRaw));
          const v = map.get(id);
          if (!v || !v.disponible) continue;

          const unit = isEfectivo ? (v.precioEfectivo ?? v.precioTransf) : v.precioTransf;
          const subtotal = unit * qty;
          total += subtotal;

          canonicalItems.push({
            nombre: v.nombre,
            cantidad: qty,
            precio: unit,
            subtotal,
          });

          toAppend.push([
            idPedido,
            String(dni),
            v.nombre,
            qty,
            comentarios,
            subtotal,
            formaPago,
            fechaIso,
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
        await finalizeDniDayLock(lockKey, idPedido, dni);

        const payAlias = String((kv.PAY_ALIAS || "") || DEFAULT_PAY_ALIAS || "").trim();
        const payNote = String((kv.PAY_NOTE || "") || DEFAULT_PAY_NOTE || "").trim();

        const receipt = buildCanonicalReceipt({
          idPedido,
          dni,
          fechaIso,
          formaPago,
          total,
          items: canonicalItems,
          zonaMensaje,
          payAlias,
          payNote,
        });

        return ok(res, {
          idPedido: receipt.idPedido,
          total: receipt.total,
          formaPago: receipt.formaPago,
          zonaMensaje: receipt.zonaMensaje,
          payAlias: receipt.payAlias,
          payNote: receipt.payNote,
          receipt,
          waText: receipt.waText,
          receiptCode: receipt.receiptCode,
        });
      } catch (e) {
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
