import cfg from '../config/config.json' assert { type: 'json' };

const sel=(q)=>document.querySelector(q), el=(t,c)=>{const n=document.createElement(t); if(c)n.className=c; return n;}
const state={token:null,dni:null,items:[],cart:new Map(),alias:''}
const fmt=(n)=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(n||0)
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n))

function setSection(logged){sel('#login').classList.toggle('hidden',logged); sel('#menu').classList.toggle('hidden',!logged)}
function showMsg(node,text,ok=false){node.textContent=text||''; node.style.color=text?(ok?'#145844':'#666'):'#666'}

sel('#loginForm').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const fd=new FormData(e.currentTarget); const dni=(fd.get('dni')||'').toString().trim(); const clave=(fd.get('clave')||'').toString().trim();
  sel('#loginForm button').disabled=true; showMsg(sel('#loginMsg'),'Ingresando...');
  try{
    let recaptchaToken=''; if(cfg.recaptchaSiteKey && typeof grecaptcha!=='undefined'){recaptchaToken=await grecaptcha.execute(cfg.recaptchaSiteKey,{action:'login'})}
    const res=await fetch(cfg.endpoints.login,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({dni,clave,recaptchaToken})});
    const data=await res.json().catch(()=>({})); if(!res.ok||!data.ok) throw new Error();
    state.token=data.token; state.dni=dni; showMsg(sel('#loginMsg'), ''); await cargarViandas(); setSection(true);
  }catch(err){ showMsg(sel('#loginMsg'),'DNI o clave incorrectos, o pedidos cerrados.',false) } finally{ sel('#loginForm button').disabled=false }
})

async function cargarViandas(){
  const res=await fetch(cfg.endpoints.viandas,{headers:{'Authorization':'Bearer '+state.token,'Accept':'application/json'}});
  const data=await res.json().catch(()=>({items:[]})); if(!data.ok) throw new Error('no viandas');
  state.items=data.items||[]; if(data.alias) state.alias=data.alias; renderListado(); renderResumen();
}

function renderListado(){
  const cont=sel('#listado'); cont.innerHTML='';
  state.items.forEach((it,idx)=>{
    const card=el('div','card'+(idx%2===1?' even':''));
    const imgWrap=el('div','img-wrap');
    if(it.imagen){const img=el('img'); img.src=it.imagen; img.alt=it.nombre||'Vianda'; imgWrap.appendChild(img)}
    else {const ph=el('div','placeholder'); ph.textContent=(it.nombre||'V').slice(0,1).toUpperCase(); imgWrap.appendChild(ph)}
    const body=el('div','card-body'); const title=el('h3'); title.textContent=it.nombre||'—'; const desc=el('p'); desc.className='muted'; desc.textContent=it.descripcion||''; const price=el('div','price'); price.textContent=fmt(it.precio||0); const step=renderStepper(it.id);
    body.append(title,desc,price,step); card.append(imgWrap,body); cont.appendChild(card);
  })
}

function renderStepper(id){
  const w=el('div','stepper'); const m=el('button'); m.type='button'; m.textContent='−'; const i=el('input'); i.type='number'; i.min='0'; i.max='9'; i.value=state.cart.get(id)||0; const p=el('button'); p.type='button'; p.textContent='+';
  const refresh=()=>{const n=Number(i.value)||0; m.disabled=n<=0; p.disabled=n>=9}
  const setQty=(n)=>{n=clamp(n,0,9); if(n===0) state.cart.delete(id); else state.cart.set(id,n); i.value=n; refresh(); renderResumen()}
  m.addEventListener('click',()=>setQty((Number(i.value)||0)-1)); p.addEventListener('click',()=>setQty((Number(i.value)||0)+1)); i.addEventListener('change',()=>setQty(Number(i.value)||0))
  refresh(); w.append(m,i,p); return w
}

function renderResumen(){
  const list=sel('#resumenItems'); list.innerHTML=''; let total=0;
  for(const [id,qty] of state.cart.entries()){ const it=state.items.find(x=>String(x.id)===String(id)); if(!it) continue; const line=el('div','resumen-line'); const left=el('span'); left.textContent=`${qty} × ${it.nombre}`; const right=el('strong'); right.textContent=fmt((it.precio||0)*qty); line.append(left,right); list.appendChild(line); total += (it.precio||0)*qty; }
  sel('#total').textContent=fmt(total); sel('#totalBar').textContent=fmt(total); sel('#alias').textContent=state.alias||'—';
}

sel('#reiniciar').addEventListener('click', ()=>{ state.cart.clear(); renderListado(); renderResumen(); });
function copy(t){ navigator.clipboard?.writeText(t).catch(()=>{}) }
sel('#copyAlias').addEventListener('click', ()=>copy(sel('#alias').textContent||''));
sel('#copyAliasModal').addEventListener('click', ()=>copy(sel('#modalAlias').textContent||''));

sel('#enviarPedido').addEventListener('click', async ()=>{
  const btn=sel('#enviarPedido'); btn.disabled=true; showMsg(sel('#pedidoMsg'),'Enviando...');
  try{
    const items=Array.from(state.cart.entries()).map(([id,cantidad])=>({id,cantidad})); if(items.length===0) throw new Error('vacio'); const comentarios=sel('#comentarios').value||'';
    let recaptchaToken=''; if(cfg.recaptchaSiteKey && typeof grecaptcha!=='undefined'){ recaptchaToken=await grecaptcha.execute(cfg.recaptchaSiteKey,{action:'pedido'}) }
    const res=await fetch(cfg.endpoints.pedido,{method:'POST',headers:{'Authorization':'Bearer '+state.token,'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({items,comentarios,recaptchaToken})});
    const data=await res.json().catch(()=>({})); if(!res.ok||!data.ok) throw new Error();
    if(data.alias) state.alias=data.alias; sel('#modalOK').showModal(); sel('#modalPedido').textContent=`Pedido #${data.idPedido}`; sel('#modalTotal').textContent=fmt(data.total||0); sel('#modalAlias').textContent=state.alias||'—'; state.cart.clear(); renderListado(); renderResumen(); showMsg(sel('#pedidoMsg'),'',true);
  }catch(err){ showMsg(sel('#pedidoMsg'),'No se pudo registrar el pedido.',false) } finally{ btn.disabled=false }
})
sel('#cerrarModal').addEventListener('click', ()=> sel('#modalOK').close());
