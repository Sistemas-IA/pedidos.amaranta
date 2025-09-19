const API_TOKEN = ''; // si definís API_TOKEN en Vercel, ponelo también acá
const CURRENCY = '$';
const cart = new Map();
const money = n => CURRENCY + ' ' + new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n);

async function loadItems(){
  const qs = API_TOKEN ? `?token=${encodeURIComponent(API_TOKEN)}` : '';
  const res = await fetch(`/api/viandas${qs}`);
  const data = await res.json();
  return data.items || [];
}

const menu = document.getElementById('menu');
const tpl = document.getElementById('cardTemplate');
function renderMenu(items){
  menu.innerHTML = '';
  items.forEach(it => {
    const node = tpl.content.cloneNode(true);
    node.querySelector('.card').dataset.id = it.id;
    node.querySelector('.title').textContent = it.nombre;
    node.querySelector('.desc').textContent = it.desc;
    node.querySelector('.price').textContent = money(it.precio);
    const img = node.querySelector('img'); img.src = it.imagen; img.alt = it.nombre;
    const qtyBox = node.querySelector('.qty');
    const countEl = node.querySelector('.count');
    const addBtn = node.querySelector('.add');
    const incBtn = node.querySelector('.inc');
    const decBtn = node.querySelector('.dec');
    function sync(){
      const q = cart.get(it.id)?.qty || 0;
      if(q===0){ qtyBox.dataset.state='collapsed'; }
      else { qtyBox.dataset.state='expanded'; countEl.textContent = q; }
      renderSummary();
    }
    addBtn.onclick = () => { cart.set(it.id,{item:it,qty:1}); sync(); };
    incBtn.onclick = () => { const q=(cart.get(it.id)?.qty||0)+1; cart.set(it.id,{item:it,qty:q}); sync(); };
    decBtn.onclick = () => { const q=(cart.get(it.id)?.qty||0)-1; if(q<=0) cart.delete(it.id); else cart.set(it.id,{item:it,qty:q}); sync(); };
    sync();
    menu.appendChild(node);
  });
}

const itemsEl = document.getElementById('items');
const totalEl = document.getElementById('grandTotal');
const submitBtn = document.getElementById('submitBtn');
function renderSummary(){
  if(cart.size===0){
    itemsEl.textContent = 'Agregá productos…';
    totalEl.textContent = money(0);
    submitBtn.disabled = true;
    return;
  }
  itemsEl.innerHTML='';
  let total=0;
  cart.forEach(({item, qty}) => {
    const line = document.createElement('div');
    line.className='line';
    line.innerHTML = `<span><strong>${qty} ×</strong> ${item.nombre}</span><span>${money(item.precio*qty)}</span>`;
    itemsEl.appendChild(line);
    total += item.precio*qty;
  });
  totalEl.textContent = money(total);
  submitBtn.disabled = false;
}

document.getElementById('copyAlias').onclick = () => navigator.clipboard.writeText(document.getElementById('aliasText').textContent.trim());

submitBtn.onclick = async () => {
  const clienteId = document.getElementById('cliId').value.trim();
  const clave = document.getElementById('cliKey').value.trim();
  if(!clienteId || !clave){ alert('Completá Cliente ID y Clave'); return; }
  if(cart.size===0){ alert('No hay items en el pedido'); return; }

  const items = Array.from(cart.values()).map(({item, qty}) => ({ id: item.id, qty }));
  const body = { clienteId, clave, items, moneda: CURRENCY, alias: document.getElementById('aliasText').textContent.trim() };
  const qs = API_TOKEN ? `?token=${encodeURIComponent(API_TOKEN)}` : '';
  const res = await fetch(`/api/pedido${qs}`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data = await res.json();
  if(!res.ok || !data.ok){ alert('No pudimos registrar el pedido: ' + (data.error||res.status)); return; }
  alert('¡Pedido enviado! ID: ' + data.pedidoId);
  cart.clear(); renderSummary();
};

(async function(){
  try{
    const items = await loadItems();
    renderMenu(items);
    document.getElementById('loading')?.remove();
  }catch(e){
    document.getElementById('loading').textContent = 'No pudimos cargar las viandas.';
    console.error(e);
  }
})();