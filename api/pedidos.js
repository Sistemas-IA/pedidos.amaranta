// /api/pedidos.js — API independiente para Pedidos (Vercel Serverless)
import { google } from 'googleapis';

// ----------------- Constantes / Env -----------------
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://pedidos.amaranta.ar';

// Si seteás esta env var, el POST exige el header X-API-Key
const REQUIRED_API_KEY = process.env.PEDIDOS_API_KEY || process.env.API_KEY || '';

const SHEET_VIANDAS  = 'Viandas';
const SHEET_CLIENTES = 'Clientes';
const SHEET_PEDIDOS  = 'Pedidos';
const SHEET_CONFIG   = 'Configuracion';

// ----------------- Sheets (lazy init) -----------------
let _sheets = null;
function getSheets() {
  if (_sheets) return _sheets;

  const sa = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!sa) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT');

  let credentials;
  try {
    credentials = JSON.parse(sa);
  } catch {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT JSON');
  }

  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
  _sheets = google.sheets({ version: 'v4', auth });
  return _sheets;
}

// ----------------- Utils CORS/Res -----------------
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
}
function ok(res, data) {
  setCors(res);
  return res.status(200).json({ ok: true, ...data });
}
function err(res, code, msg, extra = undefined) {
  setCors(res);
  return res.status(code).json({ ok: false, error: msg, ...(extra ? extra : {}) });
}

function requireApiKeyIfConfigured(req, res) {
  if (!REQUIRED_API_KEY) return true; // no cambia nada si no lo seteás
  const got = String(req.headers['x-api-key'] || '').trim();
  if (got !== REQUIRED_API_KEY) {
    err(res, 401, 'API_KEY_REQUIRED');
    return false;
  }
  return true;
}

// ----------------- Helpers -----------------
function asBool(v, def = true) {
  if (v === undefined || v === null) return def;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'si', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  return def;
}

function clampInt(n, min, max, def) {
  const x = parseInt(n, 10);
  if (!Number.isFinite(x)) return def;
  return Math.max(min, Math.min(max, x));
}

function sanitizeForSheetText(s) {
  let out = (s ?? '').toString();
  out = out.replace(/\s+/g, ' ').trim();
  if (!out) return '';
  // Anti formula-injection (Sheets): si arranca con = + - @ lo convertimos a texto
  if (/^[=+\-@]/.test(out)) out = "'" + out;
  return out;
}

// ---------- Normalización mínima de imagen ----------
function normalizeImage(u) {
  if (!u) return '';
  u = String(u).trim();
  let m = u.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;
  m = u.match(/drive\.google\.com\/open\?id=([^&]+)/);
  if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;
  return u;
}

function parseOrden(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

// ---------- Helpers Config desde hoja ----------
async function readConfigKV() {
  try {
    if (!SPREADSHEET_ID) return {};
    const sheets = getSheets();
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CONFIG}!A:B`
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
    // Si no se puede leer config, no tiramos abajo el sistema: fallback a defaults.
    return {};
  }
}

// ---------- Helpers ID de pedido ----------
async function getNextIdPedido() {
  const urlBase = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  // 1) Upstash (recomendado)
  if (urlBase && token) {
    const url = urlBase.replace(/\/+$/, '') + '/incr/id:pedidos:last';
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const j = await r.json().catch(() => ({}));
    const n = Number(j.result || 0);
    return n < 10001 ? 10001 : n;
  }

  // 2) Fallback: leer la última fila del sheet (más lento)
  const sheets = getSheets();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PEDIDOS}!A:A`
  });
  const rows = resp.data.values?.length || 1;
  if (rows <= 1) return 10001;
  const lastId = Number(resp.data.values[rows - 1]?.[0]) || 10000;
  return lastId + 1;
}

function getRequestIp(req) {
  // En Vercel: x-forwarded-for suele traer "ip, proxy, proxy"
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket?.remoteAddress || '';
}

// ----------------- Handler -----------------
export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCors(res);
    return res.status(200).end();
  }

  try {
    if (!SPREADSHEET_ID) return err(res, 500, 'MISSING_SPREADSHEET_ID');

    const route = String(req.query.route || '').toLowerCase();

    // -------- GET ui-config --------
    if (req.method === 'GET' && route === 'ui-config') {
      const kv = await readConfigKV();
      return ok(res, {
        // operativo
        FORM_ENABLED: String(kv.FORM_ENABLED ?? 'true'),
        FORM_CLOSED_TITLE: kv.FORM_CLOSED_TITLE ?? 'Pedidos temporalmente cerrados',
        FORM_CLOSED_MESSAGE: kv.FORM_CLOSED_MESSAGE ?? 'Estamos atendiendo por WhatsApp. Volvé más tarde o escribinos.',

        // UI / theme
        THEME_PRIMARY: kv.THEME_PRIMARY ?? '',
        THEME_SECONDARY: kv.THEME_SECONDARY ?? '',
        THEME_BG: kv.THEME_BG ?? '',
        THEME_TEXT: kv.THEME_TEXT ?? '',
        RADIUS: kv.RADIUS ?? '16',
        SPACING: kv.SPACING ?? '8',

        // assets
        ASSET_HEADER_URL: normalizeImage(kv.ASSET_HEADER_URL ?? ''),
        ASSET_PLACEHOLDER_IMG_URL: normalizeImage(kv.ASSET_PLACEHOLDER_IMG_URL ?? ''),
        ASSET_LOGO_URL: normalizeImage(kv.ASSET_LOGO_URL ?? ''),

        // límites / UI
        UI_MAX_QTY_POR_VIANDA: kv.UI_MAX_QTY_POR_VIANDA ?? '9',
        UI_RESUMEN_ITEMS_VISIBLES: kv.UI_RESUMEN_ITEMS_VISIBLES ?? '4',

        // mensajes
        MSG_EMPTY: kv.MSG_EMPTY ?? 'No hay viandas disponibles por ahora.',
        MSG_AUTH_FAIL: kv.MSG_AUTH_FAIL ?? 'DNI o clave incorrectos o cliente no validado.',
        MSG_LIMIT: kv.MSG_LIMIT ?? 'Máximo 9 por vianda.',
        MSG_SERVER_FAIL: kv.MSG_SERVER_FAIL ?? 'No pudimos completar el pedido. Probá más tarde.',
        MSG_SUCCESS: kv.MSG_SUCCESS ?? '¡Listo! Tu pedido es #{IDPEDIDO} por ${TOTAL}.',

        // WhatsApp opcional
        WA_ENABLED: String(kv.WA_ENABLED ?? 'true'),
        WA_TEMPLATE: kv.WA_TEMPLATE ?? '',
        WA_ITEMS_BULLET: kv.WA_ITEMS_BULLET ?? '',
        WA_PHONE_TARGET: kv.WA_PHONE_TARGET ?? '',

        // PAGO
        PAY_ALIAS: kv.PAY_ALIAS ?? '',
        PAY_NOTE: kv.PAY_NOTE ?? ''
      });
    }

    // -------- GET viandas --------
    if (req.method === 'GET' && route === 'viandas') {
      const sheets = getSheets();
      const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        // A:F antes; ahora A:G (G = Orden)
        range: `${SHEET_VIANDAS}!A:G`
      });

      const values = r.data.values || [];
      const items = [];

      for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        const disponible = String(row[5] ?? '').toLowerCase() === 'true';
        if (!disponible) continue;

        const orden = parseOrden(row[6]); // G
        items.push({
          IdVianda: row[0],
          Nombre: row[1],
          Descripcion: row[2],
          Precio: Number(row[3]) | 0,
          Imagen: normalizeImage(row[4]),
          _orden: orden === null ? 999999 : orden
        });
      }

      // Orden ascendente por Orden (G). Si empata, por Nombre.
      items.sort((a, b) => {
        if (a._orden !== b._orden) return a._orden - b._orden;
        return String(a.Nombre || '').localeCompare(String(b.Nombre || ''), 'es');
      });

      // limpiar el campo interno
      for (const it of items) delete it._orden;

      return ok(res, { items });
    }

    // -------- POST pedido --------
    if (req.method === 'POST' && route === 'pedido') {
      if (!requireApiKeyIfConfigured(req, res)) return;

      const kv = await readConfigKV();
      const formEnabled = asBool(kv.FORM_ENABLED, true);
      if (!formEnabled) return err(res, 403, 'FORM_CLOSED');

      const MAX_COMENT = 400;
      const MAX_IP = 128;
      const MAX_UA = 256;

      const body = req.body || {};
      const dni = String(body.dni || '').trim();
      const clave = String(body.clave || '').trim();

      // IP real (no confiamos en body.ip)
      const ip = String(getRequestIp(req) || '').slice(0, MAX_IP);

      // UA: preferimos header
      const ua = String(req.headers['user-agent'] || body.ua || '').slice(0, MAX_UA);

      // Comentarios saneados + anti-formula
      let comentarios = sanitizeForSheetText(body.comentarios).slice(0, MAX_COMENT);

      const items = Array.isArray(body.items) ? body.items : [];

      // Mantengo tu validación actual para no cambiar comportamiento
      if (!/^\d{8}$/.test(dni) || dni.startsWith('0') || !clave || !items.length) {
        return err(res, 400, 'BAD_REQUEST');
      }

      // MAX QTY alineado con Config (fallback a 9 como hoy)
      const maxQty = clampInt(kv.UI_MAX_QTY_POR_VIANDA, 1, 99, 9);

      const sheets = getSheets();

      // --- validar cliente ---
      const rc = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_CLIENTES}!A:N`
      });
      const allC = rc.data.values || [];
      const HC = allC[0] || [];
      const iDNI = HC.indexOf('DNI');
      const iClave = HC.indexOf('Clave');
      const iEstado = HC.indexOf('Estado');

      if (iDNI < 0 || iClave < 0 || iEstado < 0) {
        return err(res, 500, 'CLIENTES_HEADERS_INVALID');
      }

      const rowsC = allC.slice(1);
      const match = rowsC.find(r => String(r?.[iDNI] ?? '') === String(dni));
      if (!match || String(match[iClave] ?? '') !== String(clave) || String(match[iEstado] ?? '') !== 'Validado') {
        return err(res, 401, 'AUTH_FAIL');
      }

      // --- catálogo (incluye Disponible) ---
      const rv = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_VIANDAS}!A:G`
      });
      const rowsV = (rv.data.values || []).slice(1);
      const map = new Map();
      for (const row of rowsV) {
        if (!row || row.length < 6) continue;
        const id = String(row[0] ?? '').trim();
        if (!id) continue;
        const disponible = String(row[5] ?? '').toLowerCase() === 'true';
        if (!disponible) continue; // server valida Disponible

        map.set(id, {
          nombre: row[1] ?? '',
          precio: Number(row[3]) | 0
        });
      }

      const idPedido = await getNextIdPedido();

      let total = 0;
      const toAppend = [];

      for (const it of items) {
        const id = String(it?.idVianda ?? '').trim();
        let qty = parseInt(it?.cantidad ?? 0, 10);

        if (!id || !Number.isFinite(qty) || qty <= 0) continue;
        qty = clampInt(qty, 0, maxQty, 0);
        if (qty <= 0) continue;

        const v = map.get(id);
        if (!v) continue; // desconocido o no disponible

        const subtotal = v.precio * qty;
        total += subtotal;

        toAppend.push([
          idPedido,                 // IdPedido
          String(dni),              // DNI
          v.nombre,                 // Vianda (Nombre)
          qty,                      // Cantidad
          comentarios,              // Comentarios (saneado)
          subtotal,                 // Precio = SUBTOTAL
          new Date().toISOString(), // TimeStamp
          ip,                       // IP
          ua                        // UserAgent
        ]);
      }

      if (!toAppend.length) return err(res, 400, 'NO_ITEMS');

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_PEDIDOS}!A:I`,
        valueInputOption: 'RAW',
        requestBody: { values: toAppend }
      });

      return ok(res, { idPedido, total });
    }

    return err(res, 404, 'ROUTE_NOT_FOUND');
  } catch (e) {
    console.error('[pedidos] SERVER_ERROR', e);
    return err(res, 500, 'SERVER_ERROR');
  }
}
