const CURRENCY = "€";
const ITEMS = [
  {id:"poke", nombre:"Enlagloria Poke Bowl", desc:"Salmón, arroz, edamame, palta, hongos y wakame.", precio:11.95, imagen:"https://images.unsplash.com/photo-1562967914-608f82629710?q=80&w=800"},
  {id:"wrap", nombre:"New Wrap Veggie", desc:"Zanahoria, hummus, mix verde y pepino.", precio:7.90, imagen:"https://images.unsplash.com/photo-1541592106381-b31e9677c0e5?q=80&w=800"}
];

const cart = new Map();
function money(n){return CURRENCY+" "+n.toFixed(2).replace('.', ',');}
function renderMenu(){
  const menu=document.getElementById('menu');menu.innerHTML='';
  const tpl=document.getElementById('cardTemplate');
  ITEMS.forEach(it=>{
    const node=tpl.content.cloneNode(true);
    const card=node.querySelector('.card');card.dataset.id=it.id;
    node.querySelector('.title').textContent=it.nombre;
    node.querySelector('.desc').textContent=it.desc;
    node.querySelector('.price').textContent=money(it.precio);
    const img=node.querySelector('img');img.src=it.imagen;img.alt=it.nombre;
    const out=node.querySelector('.count');out.textContent=cart.get(it.id)?.qty||0;
    node.querySelector('.inc').addEventListener('click',()=>updateQty(it,1,out));
    node.querySelector('.dec').addEventListener('click',()=>updateQty(it,-1,out));
    menu.appendChild(node);
  });
}
function updateQty(item,delta,outEl){
  const current=cart.get(item.id)?.qty||0;const next=Math.max(0,current+delta);
  if(next===0){cart.delete(item.id);}else{cart.set(item.id,{item,qty:next});}
  outEl.textContent=next;renderSummary();
}
function renderSummary(){
  const itemsEl=document.getElementById('items');const totalEl=document.getElementById('grandTotal');
  const barTotal=document.getElementById('barTotal');const submitBtn=document.getElementById('submitBtn');const barSubmit=document.getElementById('barSubmit');
  if(cart.size===0){itemsEl.innerHTML='<span class="muted">Agregá productos</span>';totalEl.textContent=money(0);barTotal.textContent=money(0);submitBtn.disabled=true;barSubmit.disabled=true;return;}
  itemsEl.innerHTML='';let total=0;
  cart.forEach(({item,qty})=>{const row=document.createElement('div');row.className='row';const name=document.createElement('div');name.textContent=`${qty}x ${item.nombre}`;const sub=document.createElement('div');sub.textContent=money(item.precio*qty);row.append(name,sub);itemsEl.appendChild(row);total+=item.precio*qty;});
  totalEl.textContent=money(total);barTotal.textContent=money(total);submitBtn.disabled=false;barSubmit.disabled=false;
}
document.getElementById('copyAlias').addEventListener('click',()=>navigator.clipboard.writeText(document.getElementById('aliasText').textContent.trim()));
document.getElementById('clearBtn').addEventListener('click',()=>{cart.clear();renderMenu();renderSummary();});
function submitOrder(){alert('Pedido enviado (demo).');}
document.getElementById('submitBtn').addEventListener('click',submitOrder);
document.getElementById('barSubmit').addEventListener('click',submitOrder);
renderMenu();renderSummary();