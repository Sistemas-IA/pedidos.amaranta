// /api/pedidos.js — API independiente para Pedidos (Vercel Serverless)
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

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
}

function ok(res, data) {
  setCors(res);
  res.status(200).json(data);
}

function bad(res, status, data) {
  setCors(res);
  res.status(status).json(data);
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

// ---------- Helpers ----------
function nowISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function sanitize(s, max) {
  s = String(s ?? '').trim();
  if (s.length > max) s = s.slice(0, max);
  return s;
}

async function getKV() {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_CONFIG}!A:B`
  });
  const values = r.data.values || [];
  const kv = {};
  for (let i = 1; i < values.length; i++) {
    const [k,v] = values[i];
    if (!k) continue;
    kv[String(k).trim()] = (v ?? '').toString();
  }
  return kv;
}

async function getClienteByDni(dni) {
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_CLIENTES}!A:Z`
  });
  const values = r.data.values || [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rowDni = String(row[1] ?? '').trim();
    if (rowDni === dni) {
      return {
        Nombre: row[0] ?? '',
        DNI: row[1] ?? '',
        Email: row[2] ?? '',
        Telefono: row[3] ?? '',
        Clave: row[4] ?? ''
      };
    }
  }
  return null;
}

async function appendPedido(pedidoRow) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PEDIDOS}!A:Z`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [pedidoRow] }
  });
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const route = url.searchParams.get('route') || '';

    // -------- GET ui-config --------
    if (req.method === 'GET' && route === 'ui-config') {
      const kv = await getKV();
      return ok(res, {
        FORM_ENABLED: kv.FORM_ENABLED ?? 'true',
        FORM_CLOSED_TITLE: kv.FORM_CLOSED_TITLE ?? 'Pedidos cerrados',
        FORM_CLOSED_MESSAGE: kv.FORM_CLOSED_MESSAGE ?? 'Volvé más tarde.',
        UI_RESUMEN_ITEMS_VISIBLES: kv.UI_RESUMEN_ITEMS_VISIBLES ?? '4',
        UI_MAX_QTY_POR_VIANDA: kv.UI_MAX_QTY_POR_VIANDA ?? '9',
        MSG_EMPTY: kv.MSG_EMPTY ?? '',
        MSG_AUTH_FAIL: kv.MSG_AUTH_FAIL ?? '',
        MSG_LIMIT: kv.MSG_LIMIT ?? '',
        MSG_SERVER_FAIL: kv.MSG_SERVER_FAIL ?? '',
        MSG_SUCCESS: kv.MSG_SUCCESS ?? '',
        THEME_PRIMARY: kv.THEME_PRIMARY ?? '',
        THEME_SECONDARY: kv.THEME_SECONDARY ?? '',
        THEME_BG: kv.THEME_BG ?? '',
        THEME_TEXT: kv.THEME_TEXT ?? '',
        RADIUS: kv.RADIUS ?? '',
        SPACING: kv.SPACING ?? '',
        ASSET_HEADER_URL: kv.ASSET_HEADER_URL ?? '',
        ASSET_LOGO_URL: kv.ASSET_LOGO_URL ?? '',
        ASSET_PLACEHOLDER_IMG_URL: kv.ASSET_PLACEHOLDER_IMG_URL ?? '',
        WA_NUMBER: kv.WA_NUMBER ?? '',
        WA_MESSAGE: kv.WA_MESSAGE ?? '',
        WA_PHONE_TARGET: kv.WA_PHONE_TARGET ?? '',
        PAY_ALIAS: kv.PAY_ALIAS ?? '',
        PAY_NOTE: kv.PAY_NOTE ?? '',
      });
    }

    // -------- GET viandas --------
    if (req.method === 'GET' && route === 'viandas') {
      const r = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_VIANDAS}!A:G`
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
          Imagen: normalizeImage(row[4]),
          Orden: row[6] ?? ''
        });
      }

      // Ordenamos por columna G (Orden) si viene cargada.
      const toNum = (v) => {
        const s = String(v ?? '').trim().replace(',', '.');
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      };
      items.sort((a,b) => {
        const ao = toNum(a.Orden);
        const bo = toNum(b.Orden);
        if (ao != null && bo != null && ao !== bo) return ao - bo;
        if (ao != null && bo == null) return -1;
        if (ao == null && bo != null) return 1;
        return String(a.Nombre || '').localeCompare(String(b.Nombre || ''), 'es', { sensitivity: 'base' });
      });

      return ok(res, { items });
    }

    // -------- POST pedido --------
    if (req.method === 'POST' && route === 'pedido') {
      const MAX_COMENT = 400, MAX_IP = 128, MAX_UA = 256;

      const body = req.body || {};
      const dni = String(body.dni || '').trim();
      const clave = String(body.clave || '').trim();
      const comentarios = sanitize(body.comentarios || '', MAX_COMENT);
      const ip = sanitize(body.ip || '', MAX_IP);
      const ua = sanitize(body.ua || '', MAX_UA);
      const items = Array.isArray(body.items) ? body.items : [];

      const kv = await getKV();
      const enabled = String(kv.FORM_ENABLED ?? 'true').toLowerCase() === 'true';
      if (!enabled) return bad(res, 403, { error: 'FORM_CLOSED' });

      if (!/^\d{8}$/.test(dni) || dni.startsWith('0')) return bad(res, 400, { error: 'BAD_DNI' });
      if (!clave) return bad(res, 400, { error: 'BAD_CLAVE' });
      if (!items.length) return bad(res, 400, { error: 'EMPTY' });

      const cliente = await getClienteByDni(dni);
      if (!cliente) return bad(res, 401, { error: 'AUTH_FAIL' });
      if (String(cliente.Clave || '').trim() !== clave) return bad(res, 401, { error: 'AUTH_FAIL' });

      const idPedido = `${Date.now()}-${Math.random().toString(16).slice(2,8)}`;
      const fecha = nowISO();

      // Guardamos en la hoja Pedidos (simple)
      await appendPedido([
        fecha,
        idPedido,
        cliente.Nombre || '',
        dni,
        comentarios,
        ip,
        ua,
        JSON.stringify(items)
      ]);

      return ok(res, { idPedido });
    }

    return bad(res, 404, { error: 'NOT_FOUND' });
  } catch (e) {
    return bad(res, 500, { error: 'SERVER', message: String(e?.message || e) });
  }
}
