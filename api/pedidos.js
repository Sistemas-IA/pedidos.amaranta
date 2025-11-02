// /api/pedidos.js — API independiente para Pedidos (Vercel Serverless)
// Requiere env: GOOGLE_SERVICE_ACCOUNT (JSON), SPREADSHEET_ID
// Recomendadas: CORS_ORIGIN (https://pedidos.amaranta.ar)
// Opcionales: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (ID atómico y rate-limit futuro)

import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: SCOPES
});
const sheets = google.sheets({ version: 'v4', auth });

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://pedidos.amaranta.ar';

const SHEET_VIANDAS   = 'Viandas';
const SHEET_CLIENTES  = 'Clientes';
const SHEET_PEDIDOS   = 'Pedidos';
const SHEET_CONFIG    = 'Configuracion';

// ---------- Utils CORS/Res ----------
function ok(res, data) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return res.status(200).json({ ok: true, ...data });
}
function err(res, code, msg) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  return res.status(code).json({ ok: false, error: msg });
}

// ---------- Helpers Config desde hoja ----------
async function readConfigKV() {
  try {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CONFIG}!A:B` // Col A=Clave, Col B=Valor
    });
    const rows = r.data.values || [];
    const kv = {};
    for (let i = 0; i < rows.length; i++) {
      const k = rows[i][0], v = rows[i][1];
      if (!k) continue;
      kv[String(k).trim()] = v;
    }
    return kv;
  } catch {
    return {}; // si no hay hoja Configuracion, seguimos con defaults
  }
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

// ---------- Helpers ID de pedido ----------
async function getNextIdPedido() {
  // 1) Si hay Upstash, usar contador atómico
  const urlBase = process.env.UPSTASH_REDIS_REST_URL;
  const token   = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (urlBase && token) {
    const url = urlBase.replace(/\/+$/,'') + '/incr/id:pedidos:last';
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const j = await r.json().catch(() => ({}));
    const n = Number(j.result || 0);
    return n < 10001 ? 10001 : n; // arrancar en 10001
  }
  // 2) Fallback: mirar última fila de Pedidos y +1
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PEDIDOS}!A:A`
  });
  const rows = resp.data.values?.length || 1;
  if (rows <= 1) return 10001; // sólo encabezado
  const lastId = Number(resp.data.values[rows - 1][0]) || 10000;
  return lastId + 1;
}

// ---------- Handler ----------
export default async function handler(req, res) {
  // Preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  const route = String(req.query.route || '').toLowerCase();

  // -------- GET ui-config (LEE HOJA Configuracion + defaults) --------
  if (req.method === 'GET' && route === 'ui-config') {
    const kv = await readConfigKV();
    return ok(res, {
      // operativo
      FORM_ENABLED: String(kv.FORM_ENABLED ?? 'true'),
      FORM_CLOSED_TITLE: kv.FORM_CLOSED_TITLE ?? 'Pedidos temporalmente cerrados',
      FORM_CLOSED_MESSAGE: kv.FORM_CLOSED_MESSAGE ?? 'Estamos atendiendo por WhatsApp. Volvé más tarde o escribinos.',

      // UI / theme opcional
      THEME_PRIMARY: kv.THEME_PRIMARY ?? '',
      THEME_SECONDARY: kv.THEME_SECONDARY ?? '',
      THEME_BG: kv.THEME_BG ?? '',
      THEME_TEXT: kv.THEME_TEXT ?? '',
      RADIUS: kv.RADIUS ?? '16',
      SPACING: kv.SPACING ?? '8',

      // assets (incluye banner)
      ASSET_HEADER_URL: normalizeImage(kv.ASSET_HEADER_URL ?? ''),
      ASSET_PLACEHOLDER_IMG_URL: normalizeImage(kv.ASSET_PLACEHOLDER_IMG_URL ?? ''),

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
      WA_PHONE_TARGET: kv.WA_PHONE_TARGET ?? ''
    });
  }

  // -------- GET viandas --------
  if (req.method === 'GET' && route === 'viandas') {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_VIANDAS}!A:F`
    });
    const values = r.data.values || [];
    const items = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const disponible = String(row[5]).toLowerCase() === 'true';
      if (!disponible) continue;
      items.push({
        IdVianda: row[0],
        Nombre: row[1],
        Descripcion: row[2],
        Precio: Number(row[3]) | 0,
        Imagen: normalizeImage(row[4])
      });
    }
    return ok(res, { items });
  }

  // -------- POST pedido --------
  if (req.method === 'POST' && route === 'pedido') {
    // límites/saneo
    const MAX_COMENT = 400, MAX_IP = 128, MAX_UA = 256;

    const body = req.body || {};
    const dni = String(body.dni || '').trim();
    const clave = String(body.clave || '').trim();

    // IP y UA (limitadas)
    const ipHeader = (req.headers['x-forwarded-for'] ?? '').toString().split(',')[0] || req.socket?.remoteAddress || '';
    const ip = (body.ip || ipHeader || '').toString().slice(0, MAX_IP);
    const ua = (body.ua || req.headers['user-agent'] || '').toString().slice(0, MAX_UA);

    // Comentarios (sanitizados)
    let comentarios = (body.comentarios ?? '').toString();
    comentarios = comentarios.replace(/\s+/g, ' ').trim().slice(0, MAX_COMENT);

    const items = Array.isArray(body.items) ? body.items : [];
    if (!/^\d{8}$/.test(dni) || dni.startsWith('0') || !clave || !items.length) {
      return err(res, 400, 'BAD_REQUEST');
    }

    // validar cliente
    const rc = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_CLIENTES}!A:N`
    });
    const HC = rc.data.values?.[0] || [];
    const iDNI = HC.indexOf('DNI'), iClave = HC.indexOf('Clave'), iEstado = HC.indexOf('Estado');
    const rowsC = rc.data.values?.slice(1) || [];
    const match = rowsC.find(r => String(r[iDNI]) === String(dni));
    if (!match || String(match[iClave]) !== String(clave) || String(match[iEstado]) !== 'Validado') {
      return err(res, 401, 'AUTH_FAIL');
    }

    // catálogo para precios vigentes
    const rv = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_VIANDAS}!A:D`
    });
    const rowsV = rv.data.values?.slice(1) || [];
    const map = new Map();
    for (const row of rowsV) {
      if (!row || row.length < 4) continue;
      const id = String(row[0]);
      map.set(id, { nombre: row[1], precio: Number(row[3]) | 0 });
    }

    // generar IdPedido
    const idPedido = await getNextIdPedido();

    // armar filas (una por vianda distinta) con SUBTOTAL en "Precio"
    let total = 0;
    const toAppend = [];
    for (const it of items) {
      const id = String(it.idVianda || '');
      let qty = parseInt(it.cantidad || 0, 10);
      if (!id || !qty) continue;
      if (qty < 0) qty = 0;
      if (qty > 9) qty = 9;
      const v = map.get(id);
      if (!v) continue;
      const subtotal = v.precio * qty;
      total += subtotal;
      toAppend.push([
        idPedido,                 // IdPedido
        String(dni),              // DNI
        v.nombre,                 // Vianda (Nombre)
        qty,                      // Cantidad
        comentarios,              // Comentarios (saneado)
        subtotal,                 // <<< Precio = SUBTOTAL (no unitario)
        new Date().toISOString(), // TimeStamp
        ip,                       // IP (limitado)
        ua                        // UserAgent (limitado)
      ]);
    }
    if (!toAppend.length) return err(res, 400, 'NO_ITEMS');

    // escribir en "Pedidos"
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PEDIDOS}!A:I`,
      valueInputOption: 'RAW',
      requestBody: { values: toAppend }
    });

    return ok(res, { idPedido, total });
  }

  return err(res, 404, 'ROUTE_NOT_FOUND');
}
