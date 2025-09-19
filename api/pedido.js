const { google } = require('googleapis');
const crypto = require('crypto');
function sha256(s){ return crypto.createHash('sha256').update(String(s)).digest('hex'); }
module.exports = async function handler(req, res){
  try{
    if(req.method!=='POST') return res.status(405).end();
    const token = (req.query.token || '').trim();
    if(process.env.API_TOKEN && token !== process.env.API_TOKEN) return res.status(401).json({error:'unauthorized'});
    // Parse body if needed
    let body = req.body;
    if(!body){
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      try{ body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }catch{ body = {}; }
    }
    const { clienteId, clave, items, moneda, alias } = body || {};
    if(!clienteId || !clave || !Array.isArray(items) || items.length===0) return res.status(400).json({error:'bad_request'});

    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL, null,
      (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g,'\n'),
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    const sheets = google.sheets({version:'v4', auth});

    const c = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID, range: `${process.env.SHEET_CLIENTES || 'Clientes'}!A1:Z10000` });
    const [chead, ...crows] = c.data.values || [];
    const cidx = Object.fromEntries(chead.map((h,i)=>[String(h).trim(), i]));
    const crow = crows.find(r => String(r[cidx['ClienteId']])===String(clienteId));
    if(!crow) return res.status(400).json({error:'cliente_no_encontrado'});
    if(String(crow[cidx['Validado']]).toLowerCase()!=='true') return res.status(400).json({error:'cliente_no_validado'});
    const salt = String(crow[cidx['Salt']]||''); const hash = String(crow[cidx['ClaveHash']]||'');
    if(sha256(String(clave)+salt)!==hash) return res.status(400).json({error:'clave_incorrecta'});

    const v = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SHEET_ID, range: `${process.env.SHEET_VIANDAS || 'Viandas'}!A1:Z10000` });
    const [vhead, ...vrows] = v.data.values || [];
    const vidx = Object.fromEntries(vhead.map((h,i)=>[String(h).trim(), i]));
    const map = new Map();
    vrows.forEach(r=>{ const disp = String(r[vidx['Disponible']]).toLowerCase()!=='false'; if(!disp) return;
      map.set(String(r[vidx['IdVianda']]), {id:r[vidx['IdVianda']], nombre:r[vidx['Nombre']], precio:Number(r[vidx['Precio']])||0}); });
    const detalle = items.map(it=>{ const ref = map.get(String(it.id)); if(!ref) throw new Error('vianda_invalida:'+it.id);
      const qty = Math.max(1, Number(it.qty)||0); const subtotal = +(ref.precio*qty).toFixed(2);
      return {id:ref.id, nombre:ref.nombre, precio:ref.precio, qty, subtotal}; });
    const total = detalle.reduce((a,b)=>a+b.subtotal,0); const pedidoId = 'P'+Date.now();
    await sheets.spreadsheets.values.append({ spreadsheetId: process.env.SHEET_ID, range: `${process.env.SHEET_PEDIDOS || 'Pedidos'}!A1`,
      valueInputOption:'USER_ENTERED', requestBody:{ values:[[new Date().toISOString(), pedidoId, clienteId, total, moneda||'$', alias||'', JSON.stringify(detalle)]] }});
    return res.status(200).json({ok:true, pedidoId, total});
  }catch(e){ console.error(e); return res.status(500).json({error:'server_error'}); }
};