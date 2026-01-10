:root{
  --primary:#6BBF59; --secondary:#3A5A40; --bg:#fff; --text:#111;
  --radius:16px; --space:8px;
}
*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;
  font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,'Helvetica Neue',Arial,sans-serif;
  background:var(--bg); color:var(--text);
}

/* Header / banner fijo */
.hdr{
  position:sticky; top:0; z-index:1000;
  background:#fff; border-bottom:1px solid #eee;
}
.hdr #header-img{
  display:block; width:100%; height:auto; max-height:320px;
  object-fit:cover; /* mobile */
}
@media (min-width: 900px){
  .hdr #header-img{
    object-fit:contain; /* desktop: no recorta */
    background:#fff;
  }
}

.wrap.mini{
  max-width:1200px;margin:0 auto;padding:8px 16px;display:flex;align-items:center
}
#conn-status{margin-left:auto;font-size:12px;color:#666}

/* Main containers */
main{max-width:1200px;margin:0 auto;padding:16px}

/* Grid de cards: 3 / 2 / 1 col */
.grid{
  display:grid;
  grid-template-columns: repeat(3, 1fr);
  gap:16px;
}
@media (max-width: 1199px){
  .grid{ grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 899px){
  .grid{ grid-template-columns: 1fr; }
}

/* Card horizontal 60/40 */
.card{
  border:1px solid #e6e6e6; border-radius:var(--radius); overflow:hidden; background:#fff;
  display:grid; grid-template-columns: 3fr 2fr; min-height:220px;
}
.card-img{background:#f7f7f7}
.card-img img{ width:100%; aspect-ratio:1/1; object-fit:cover; display:block; }

.card-body{
  padding:14px; display:grid; grid-template-rows:auto 1fr auto; gap:8px;
  min-height:0;
}
.card-title{font-size:18px;margin:0}
.card-desc{font-size:13px;color:#555}
.card-bottom{
  margin-top:auto;
  display:flex;
  flex-direction:column;          /* mobile: como estaba */
  align-items:flex-end;
  gap:8px;
}
.card-price{font-weight:700}
.qty{
  display:inline-flex; gap:8px; align-items:center;
  border:1px solid #ddd; border-radius:999px;
  padding:4px 10px; width:max-content
}
.qty button,.plus{
  border:0; background:#f1f5f0; border-radius:999px;
  padding:6px 10px; cursor:pointer;
  font-size:16px; line-height:1
}
.plus{
  width:32px; height:32px;
  display:inline-flex; align-items:center; justify-content:center
}

/* ✅ Desktop: cards con proporción 1.5 y bottom en fila (mejor uso del espacio) */
@media (min-width: 900px){
  .card{
    aspect-ratio: 3 / 2;   /* 1.5 */
    min-height:auto;
  }

  .card-bottom{
    flex-direction:row;
    align-items:flex-end;
    justify-content:space-between;
    gap:12px;
  }

  /* clamp para que no “invada” el precio/selector */
  .card-title{
    display:-webkit-box;
    -webkit-box-orient:vertical;
    -webkit-line-clamp:2;
    overflow:hidden;
  }
  .card-desc{
    display:-webkit-box;
    -webkit-box-orient:vertical;
    -webkit-line-clamp:3;
    overflow:hidden;
  }
}

/* Resumen */
#resumen{ position:sticky; bottom:0; background:#fff; border-top:1px solid #eee; padding:10px 16px; }
#resumen-list{ font-size:14px; color:#444; margin-bottom:6px; display:flex; flex-direction:column; gap:4px }
.resumen-item{ display:flex; justify-content:space-between; gap:12px }
.resumen-left{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis }
.resumen-right{ font-weight:600 }
.resumen-empty{ color:#666; font-size:13px; padding:4px 0; }
#resumen .bar{ display:flex; align-items:center; gap:12px }
.total-label{ opacity:.8 }
.total-money{ font-weight:700 }
#btn-confirmar{ margin-left:auto; background:var(--primary); color:#fff; border:0; border-radius:12px; padding:10px 16px; cursor:pointer }
#btn-confirmar:disabled{ opacity:.5; cursor:not-allowed }

/* En ≥1200px: el resumen dentro del ancho de la 3ª columna */
@media (min-width: 1200px){
  #resumen{
    display:grid; grid-template-columns: 1fr 1fr 1fr; column-gap:16px;
  }
  #resumen-list, #resumen .bar{
    grid-column: 3;
    max-width: 100%;
  }
}

/* Sheet (modal) */
#auth-sheet{
  position:fixed; inset:0; background:rgba(0,0,0,.35);
  display:flex; align-items:flex-end; justify-content:center; padding:16px;
  z-index:2000;
}
.sheet{ width:100%; max-width:520px; background:#fff; border-radius:16px 16px 0 0; padding:16px; box-shadow:0 -6px 20px rgba(0,0,0,.15) }
.field{ display:flex; flex-direction:column; gap:6px; margin:8px 0 }
.row{ display:flex; gap:8px }
@media (max-width: 520px){ .row{flex-direction:column} }
input,textarea{ width:100%; padding:10px; border:1px solid #ddd; border-radius:10px; font-size:16px }
textarea{ min-height:70px }
.actions{ display:flex; gap:8px; justify-content:flex-end; margin-top:8px }
.btn{ border:0; border-radius:10px; padding:10px 14px; cursor:pointer }
.btn.cancel{ background:#eee }
.btn.primary{ background:var(--primary); color:#fff }
.hidden{ display:none !important }

/* Ticket / Comprobante */
#ticket{
  position:fixed; inset:0; background:rgba(0,0,0,.5);
  display:flex; align-items:center; justify-content:center; padding:16px;
  z-index:2500;
}
.ticket{ width:100%; max-width:560px; background:#fff; border-radius:16px; padding:16px; box-shadow:0 10px 30px rgba(0,0,0,.25) }
#ticket-content{
  padding:16px; border:1px dashed #e0e0e0; border-radius:12px; background:#fafafa;
}
.tkt-head{ display:flex; gap:12px; align-items:center; margin-bottom:8px }
#tkt-logo{ height:36px; display:none }
.tkt-title h3{ margin:0; font-size:18px }
.tkt-sub{ font-size:12px; color:#555 }
.tkt-info{ display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin:8px 0 12px }
.tkt-items{ display:flex; flex-direction:column; gap:8px; margin-bottom:12px }
.tkt-row{ display:flex; justify-content:space-between; gap:10px; border-bottom:1px dashed #e8e8e8; padding-bottom:6px }
.tkt-left{ font-size:14px }
.tkt-right{ font-size:14px; font-weight:600 }
.tkt-total{ display:flex; justify-content:space-between; gap:10px; font-size:16px; font-weight:700; margin-top:4px; }
.tkt-note{ margin-top:10px; font-size:12px; color:#666 }
.ticket-actions{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  justify-content:space-between;
  margin-top:12px
}

/* Bloque cerrado */
#closed{ max-width:860px; margin:40px auto; padding:20px; border:1px dashed #c8e6c9; border-radius:16px; background:#fafdf9 }
#closed h2{ margin:0 0 8px; font-size:22px }
#closed p{ margin:0 0 12px; color:#444 }

/* Toast */
#toast{ position:fixed; left:50%; bottom:24px; transform:translateX(-50%); background:#222; color:#fff; padding:8px 12px; border-radius:10px; opacity:0; transition:opacity .2s; z-index:3000 }
#toast.show{ opacity:1 }

/* Ajustes finos muy chicas */
@media (max-width: 360px){
  .card{min-height: 200px}
  .card-title{font-size:16px}
  .qty button,.plus{padding:5px 9px;font-size:15px}
  .plus{width:30px;height:30px}
}

/* =========================
   Desktop split 30/70 (SOLO PC) — no toca mobile
   ========================= */
.sidehdr{ display:none; }
.resumen-pane{ display:contents; } /* no altera el layout original */
#conn-status-side{ margin-left:auto; font-size:12px; color:#666; }

/* wrapper cuadrado para recorte central */
.sidehdr-img{
  width:100%;
  aspect-ratio:1/1;
  overflow:hidden;
  background:#fff;
}
#header-img-side{
  display:block;
  width:100%;
  height:100%;
  object-fit:cover;       /* ✅ recorte */
  object-position:center; /* ✅ central */
}

@media (min-width: 1024px) and (hover:hover) and (pointer:fine){
  body{ overflow:hidden; }

  /* El header "mobile" no se usa en desktop split */
  .hdr{ display:none; }

  /* App a pantalla completa, dividido 30/70 */
  main#app{
    position:fixed;
    inset:0;
    max-width:none;
    margin:0;
    padding:0;
    display:grid;
    grid-template-columns: 30% 70%;
    background:var(--bg);
  }

  /* Columna izquierda: 50% encabezado, 50% carrito */
  #resumen{
    grid-column: 1;
    height:100%;
    position:relative;
    bottom:auto;
    border-top:0;
    border-right:1px solid #eee;
    padding:0;
    background:#fff;

    display:grid !important;
    grid-template-columns: 1fr !important;
    grid-template-rows: 50% 50%;
    overflow:hidden;
  }

  /* Anula el modo "resumen en 3ra columna" */
  #resumen-list, #resumen .bar{
    grid-column:auto !important;
  }

  #resumen .sidehdr{
    display:block;
    overflow:hidden;
    border-bottom:1px solid #eee;
  }

  /* Segunda mitad: lista con scroll + barra fija abajo */
  #resumen .resumen-pane{
    display:flex;
    flex-direction:column;
    overflow:hidden;
    min-height:0;
  }

  #resumen-list{
    padding:10px 16px;
    margin:0;
    overflow-y:auto;
    flex:1 1 auto;
    min-height:0;
  }

  #resumen .bar{
    padding:10px 16px;
    border-top:1px solid #eee;
    background:#fff;
    flex:0 0 auto;
  }

  /* Columna derecha: catálogo 2 columnas con scroll */
  #catalogo{
    grid-column: 2;
    height:100%;
    overflow-y:auto;
    padding:16px;
    min-width:0;
    align-content:start;
  }

  #catalogo.grid{
    grid-template-columns: repeat(2, 1fr) !important;
  }

  /* ✅ FIX ancho extremo: la foto no puede crecer infinito */
  .card{
    grid-template-columns: clamp(200px, 35%, 260px) 1fr;
  }
}

/* ✅ Ultra-wide: 3 columnas en catálogo dentro del split */
@media (min-width: 1500px) and (hover:hover) and (pointer:fine){
  #catalogo.grid{
    grid-template-columns: repeat(3, 1fr) !important;
  }
  .card{
    grid-template-columns: clamp(180px, 34%, 230px) 1fr;
  }
}
