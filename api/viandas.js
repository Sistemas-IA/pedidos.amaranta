const { google } = require('googleapis');

module.exports = async function handler(req, res) {
  try {
    const token = (req.query.token || '').trim();
    if (process.env.API_TOKEN && token !== process.env.API_TOKEN) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL, null,
      (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g,'\n'),
      ['https://www.googleapis.com/auth/spreadsheets.readonly']
    );
    const sheets = google.sheets({version:'v4', auth});
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.SHEET_ID,
      range: `${process.env.SHEET_VIANDAS || 'Viandas'}!A1:Z10000`,
    });
    const [head, ...rows] = data.values || [];
    if(!head) return res.status(200).json({items:[]});
    const idx = Object.fromEntries(head.map((h,i)=>[String(h).trim(), i]));
    const items = rows.map(r=>({
      id:r[idx['IdVianda']], nombre:r[idx['Nombre']], desc:r[idx['Descripcion']],
      precio:Number(r[idx['Precio']])||0, imagen:r[idx['Imagen']],
      disponible:String(r[idx['Disponible']]).toLowerCase()!=='false'
    })).filter(x=>x.id && x.disponible);
    res.setHeader('Cache-Control','s-maxage=30, stale-while-revalidate=300');
    return res.status(200).json({items});
  } catch(e){ console.error(e); return res.status(500).json({error:'server_error'}); }
};