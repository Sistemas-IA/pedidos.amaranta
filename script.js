const fmt = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);

const viandasListEl = document.getElementById('viandasList');
const orderBarEl = document.getElementById('orderBar');
const orderAmountEl = document.getElementById('orderAmount');
const btnSendEl = document.getElementById('btnSend');
const btnResetEl = document.getElementById('btnReset');
const toastEl = document.getElementById('toast');

const clienteIdEl = document.getElementById('clienteId');
const clienteClaveEl = document.getElementById('clienteClave');
const orderSummaryEl = document.getElementById('orderSummary');

const cart = new Map();

function showToast(msg){
  toastEl.textContent = msg;
  toastEl.hidden = false;
  setTimeout(()=> toastEl.hidden = true, 2500);
}

function isAvailableFlag(v){
  const f = v.disponible ?? v.disponible_hoy ?? v.F ?? v[5];
  const s = String(f).trim().toLowerCase();
  return f === true || f === 1 || s === 'true' || s === 'sí' || s === 'si';
}

function renderSummary(){
  if (cart.size === 0){
    orderSummaryEl.classList.add('empty');
    orderSummaryEl.textContent = 'Agregá productos para ver el detalle.';
    return;
  }
  orderSummaryEl.classList.remove('empty');
  const lines = [];
  cart.forEach(({item, qty, precio}) => {
    const nombre = item.nombre ?? item.Nombre ?? item[1] ?? 'Vianda';
    lines.push(`${qty} × ${nombre} — ${fmt(precio*qty)}`);
  });
  lines.push(`Total: ${fmt(totalCart())}`);
  orderSummaryEl.innerHTML = lines.map(l=>`<div>${l}</div>`).join('');
}

function renderCards(items){
  viandasListEl.innerHTML = '';
  items.forEach(item => {
    const id = item.id ?? item.ID ?? item[0];
    const nombre = item.nombre ?? item.Nombre ?? item[1] ?? 'Vianda';
    const desc = item.descripcion ?? item.Descripción ?? item[2] ?? '';
    const precio = Number(item.precio ?? item.Precio ?? item[3] ?? 0);
    const img = item.imagen ?? item.Imagen ?? item[4] ?? 'assets/placeholder.jpg';

    const card = document.createElement('article');
    card.className = 'dish-card';
    card.innerHTML = `
      <div class="content">
        <div class="info">
          <div class="dish-title">${nombre}</div>
          <div class="dish-sub">${desc}</div>
          <div class="dish-price">${fmt(precio)}</div>
          <div class="controls" data-id="${id}">
            <button class="btn-add" aria-label="Agregar ${nombre}">+</button>
            <div class="qty" role="group" aria-label="Cantidad de ${nombre}">
              <button class="btn-dec" aria-label="Quitar">–</button>
              <span class="qty-num">0</span>
              <button class="btn-inc" aria-label="Agregar">+</button>
            </div>
          </div>
        </div>
        <div class="media">
          <img src="${img}" alt="${nombre}" loading="lazy">
        </div>
      </div>
    `;

    const controls = card.querySelector('.controls');
    const qtyNum = controls.querySelector('.qty-num');

    const exist = cart.get(id);
    if (exist && exist.qty > 0){
      qtyNum.textContent = exist.qty;
      controls.classList.add('has-qty');
    }

    const updateQty = (qty) => {
      if (qty > 0){
        cart.set(id, { item, qty, precio });
        controls.classList.add('has-qty');
        qtyNum.textContent = qty;
      } else {
        cart.delete(id);
        controls.classList.remove('has-qty');
        qtyNum.textContent = '0';
      }
      syncBar();
      renderSummary();
    };

    controls.querySelector('.btn-add').addEventListener('click', () => {
      updateQty((cart.get(id)?.qty || 0) + 1);
    });
    controls.querySelector('.btn-inc').addEventListener('click', () => {
      updateQty((cart.get(id)?.qty || 0) + 1);
    });
    controls.querySelector('.btn-dec').addEventListener('click', () => {
      updateQty(Math.max((cart.get(id)?.qty || 0) - 1, 0));
    });

    viandasListEl.appendChild(card);
  });
  syncBar();
}

function totalCart(){
  let t = 0;
  cart.forEach(v => t += v.precio * v.qty);
  return t;
}

function credentialsFilled(){
  return (clienteIdEl?.value?.trim().length > 0) && (clienteClaveEl?.value?.trim().length > 0);
}

function syncBar(){
  const t = totalCart();
  if (t > 0){
    orderBarEl.hidden = false;
    orderAmountEl.textContent = fmt(t);
  } else {
    orderBarEl.hidden = true;
  }
  btnSendEl.disabled = !(t > 0 && credentialsFilled());
}

clienteIdEl?.addEventListener('input', syncBar);
clienteClaveEl?.addEventListener('input', syncBar);

btnResetEl.addEventListener('click', () => {
  cart.clear();
  document.querySelectorAll('.controls').forEach(c => { c.classList.remove('has-qty'); c.querySelector('.qty-num').textContent = '0'; });
  syncBar();
  renderSummary();
});

btnSendEl.addEventListener('click', async () => {
  try {
    const payload = {
      clienteId: clienteIdEl.value.trim(),
      clienteClave: clienteClaveEl.value.trim(),
      items: Array.from(cart.values()).map(({item, qty, precio}) => ({
        id: item.id ?? item.ID ?? item[0],
        nombre: item.nombre ?? item.Nombre ?? item[1],
        qty, precio
      })),
      total: totalCart()
    };
    const res = await fetch('/api/pedido', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    if(!res.ok){ throw new Error('Error al enviar el pedido'); }
    showToast('Pedido enviado ✔');
    cart.clear();
    document.querySelectorAll('.controls').forEach(c => { c.classList.remove('has-qty'); c.querySelector('.qty-num').textContent = '0'; });
    syncBar();
    renderSummary();
  } catch(e){
    showToast('No se pudo enviar. Revisá tus datos.');
  }
});

async function cargarViandas(){
  try {
    const res = await fetch('/api/viandas');
    const data = await res.json();
    const disponibles = data.filter(isAvailableFlag);
    renderCards(disponibles);
  } catch(e){
    const mock = [
      { id: '1', nombre: 'Ensalada César', descripcion: 'Pollo grillado, croutons, parmesano.', precio: 4200, imagen: 'assets/placeholder.jpg', disponible_hoy: true },
      { id: '2', nombre: 'Wrap Veggie', descripcion: 'Hummus, vegetales asados, espinaca.', precio: 3800, imagen: 'assets/placeholder.jpg', disponible_hoy: true },
      { id: '3', nombre: 'Poke Bowl', descripcion: 'Arroz, salmón, palta, sésamo.', precio: 5600, imagen: 'assets/placeholder.jpg', disponible_hoy: true }
    ];
    renderCards(mock);
  }
}

cargarViandas();
