// /api/pedidos.js  — API independiente para Pedidos (Vercel Serverless)
// Requiere env: GOOGLE_SERVICE_ACCOUNT (JSON), SPREADSHEET_ID
// Opcional: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (rate + id)

import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT),
  scopes: SCOPES
});
const sheets = google.sheets({ version: 'v4', auth });
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

const SHEET_VIANDAS = 'Viandas';
const SHEET_CLIENTES = 'Clientes';
const SHEET_PEDIDOS = 'Pedidos';

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://pedidos.amaranta.ar';

async function getNextIdPedido() {
  // Si hay Upstash, usala (seguro en concurrencia)
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const url = process.env.UPSTASH_REDIS_REST_URL + '/incr/id:pedidos:last';
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` }
    });
    const j = await r.json();
    const n = Number(j.result || 0);
    return n < 10001 ? 10001 : n; // arranca desde 10001
  }
  // Sin Upstash: leer última fila en Pedidos y sumar 1
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_PEDIDOS}!A:A`
  });
  const rows = resp.data.values?.length || 1;
  if (rows <= 1) return 10001; // solo encabezado
  const lastId = Number(resp.data.values[rows - 1][0]) || 10000;
  return lastId + 1;
}

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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  const route = String(req.query.route || '').toLowerCase();

  // GET ?route=ui-config  → mínimos para que el front arranque
  if (req.method === 'GET' && route === 'ui-config') {
    return ok(res, {
      FORM_ENABLED: 'true',
      UI_MAX_QTY_POR_VIANDA: '9',
      UI_RESUMEN_ITEMS_VISIBLES: '4',
      MSG_EMPTY: 'No hay viandas disponibles por ahora.',
      MSG_AUTH_FAIL: 'DNI o clave incorrectos o cliente no validado.',
      MSG_LIMIT: 'Máximo 9 por vianda.',
      MSG_SERVER_FAIL: 'No pudimos completar el pedido. Probá más tarde.',
      MSG_SUCCESS: '¡Listo! Tu pedido es #{IDPEDIDO} por ${TOTAL}.'
    });
  }

  // GET ?route=viandas  → lista disponible=true
  if (req.method === 'GET' && route === 'viandas') {
    const r = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_VIANDAS}!A:F`
    });
    const values = r.data.values || [];
    const head = values[0] || [];
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
        Imagen: row[4]
      });
    }
    return ok(res, { items });
  }

  // POST ?route=pedido  → inserta filas en "Pedidos"
  if (req.method === 'POST' && route === 'pedido') {
    const ip =
      (req.headers['x-forwarded-for'] ?? '').toString().split(',')[0] ||
      req.socket?.remoteAddress ||
      '';

    const { dni, clave, comentarios = '', items = [], ua } = (req.body || {});
    if (!/^\d{8}$/.test(String(dni)) || String(dni).startsWith('0') || !clave || !Array.isArray(items) || !items.length) {
      return err(res, 400, 'BAD_REQUEST');
    }

    // 1) Validar cliente: DNI + Clave + Estado=Validado
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

    // 2) Leer catálogo para precios actuales
    const rv = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_VIANDAS}!A:D`
    });
    const HV = rv.data.values?.[0] || [];
    const rowsV = rv.data.values?.slice(1) || [];
    const map = new Map();
    for (const row of rowsV) {
      const id = String(row[0]);
      map.set(id, { nombre: row[1], precio: Number(row[3]) | 0 });
    }

    // 3) Generar IdPedido
    const idPedido = await getNextIdPedido();

    // 4) Armar filas (una por vianda distinta)
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
      total += v.precio * qty;
      toAppend.push([
        idPedido,            // IdPedido
        String(dni),         // DNI
        v.nombre,            // Vianda (Nombre)
        qty,                 // Cantidad
        String(comentarios), // Comentarios
        v.precio,            // Precio (unitario, entero)
        new Date().toISOString(), // TimeStamp
        ip,                  // IP
        String(ua || '')     // UserAgent
      ]);
    }
    if (!toAppend.length) return err(res, 400, 'NO_ITEMS');

    // 5) Escribir en "Pedidos"
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

