const SHEET_ID = "18jX4rlx4hOGIa-6whQT0-jDxcU5UoeL0na655rwDxew";
const SHEET_NAME = "Viandas";
const CURRENCY = "$";
const cart = new Map();

const money = n => CURRENCY + " " + new Intl.NumberFormat("es-AR").format(n);

function parseGViz(text){
  const json = text.substring(text.indexOf('{'), text.lastIndexOf('}')+1);
  const data = JSON.parse(json);
  const cols = data.table.cols.map(c => c.label);
  const rows = data.table.rows.map(r => r.c.map(c => c? c.v : null));
  return {cols, rows};
}

async function loadItems(){
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${SHEET_NAME}`;
  const res = await fetch(url);
  const txt = await res.text();
  const {cols, rows} = parseGViz(txt);
  const colIndex = Object.fromEntries(cols.map((c,i)=>[c.trim(), i]));
  return rows.map(r => ({
    id: r[colIndex["IdVianda"]],
    nombre: r[colIndex["Nombre"]],
    desc: r[colIndex["Descripcion"]],
    precio: Number(r[colIndex["Precio"]])||0,
    imagen: r[colIndex["Imagen"]],
    disponible: String(r[colIndex["Disponible"]]).toLowerCase()!=="false"
  })).filter(x=>x.id && x.disponible);
}

const menu=document.getElementById("menu");
const tpl=document.getElementById("cardTemplate");

function renderMenu(items){
  menu.innerHTML="";
  items.forEach(it=>{
    const node=tpl.content.cloneNode(true);
    node.querySelector(".card").dataset.id=it.id;
    node.querySelector(".title").textContent=it.nombre;
    node.querySelector(".desc").textContent=it.desc;
    node.querySelector(".price").textContent=money(it.precio);
    const img=node.querySelector("img"); img.src=it.imagen; img.alt=it.nombre;
    const qtyBox=node.querySelector(".qty");
    const countEl=node.querySelector(".count");
    const addBtn=node.querySelector(".add");
    const incBtn=node.querySelector(".inc");
    const decBtn=node.querySelector(".dec");
    function sync(){
      const q=cart.get(it.id)?.qty||0;
      if(q===0){qtyBox.dataset.state="collapsed";} else {qtyBox.dataset.state="expanded"; countEl.textContent=q;}
      renderSummary();
    }
    addBtn.onclick=()=>{cart.set(it.id,{item:it,qty:1}); sync();};
    incBtn.onclick=()=>{const q=(cart.get(it.id)?.qty||0)+1; cart.set(it.id,{item:it,qty:q}); sync();};
    decBtn.onclick=()=>{const q=(cart.get(it.id)?.qty||0)-1; if(q<=0)cart.delete(it.id); else cart.set(it.id,{item:it,qty:q}); sync();};
    sync();
    menu.appendChild(node);
  });
}

const itemsEl=document.getElementById("items");
const totalEl=document.getElementById("grandTotal");
const submitBtn=document.getElementById("submitBtn");

function renderSummary(){
  if(cart.size===0){
    itemsEl.innerHTML='<span class="muted">Agregá productos para ver el detalle</span>';
    totalEl.textContent=money(0);
    submitBtn.disabled=true;
    return;
  }
  itemsEl.innerHTML="";
  let total=0;
  cart.forEach(({item,qty})=>{
    const line=document.createElement("div");
    line.className="line";
    line.textContent=`${qty} × ${item.nombre} ..... ${money(item.precio*qty)}`;
    itemsEl.appendChild(line);
    total+=item.precio*qty;
  });
  totalEl.textContent=money(total);
  submitBtn.disabled=false;
}

document.getElementById("copyAlias").onclick=()=>navigator.clipboard.writeText(document.getElementById("aliasText").textContent.trim());
submitBtn.onclick=()=>alert("Enviar pedido (pendiente de conexión con Apps Script)");

(async function(){
  try{
    const items=await loadItems();
    renderMenu(items);
    document.getElementById("loading")?.remove();
  }catch(e){
    document.getElementById("loading").textContent="No pudimos cargar las viandas.";
  }
})();