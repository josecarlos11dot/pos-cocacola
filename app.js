/* POS Coca-Cola — Mosaico + Orden (carrito) + Ingreso rápido + KPIs */
const LS_KEY = "pos_coca_ui_mosaic_order_v1";

/* Catálogo base con estilo visual (color/emoji) */
const catalogoBase = [
  { id: "coca_regular_355", nombre: "Coca-Cola Regular 355 ml", unidadesPorPaquete: 12, codigoBarrasUnidad: "", precio: 0, color: "#b91c1c", emoji:"🥤" },
  { id: "coca_zero_355",    nombre: "Coca-Cola Zero 355 ml",    unidadesPorPaquete: 12, codigoBarrasUnidad: "", precio: 0, color: "#111827", emoji:"⚫" },
  { id: "sidral_600",       nombre: "Sidral Mundet 600 ml",     unidadesPorPaquete: 12, codigoBarrasUnidad: "", precio: 0, color: "#9a3412", emoji:"🍎" },
  { id: "sprite_600",       nombre: "Sprite 600 ml",            unidadesPorPaquete: 12, codigoBarrasUnidad: "", precio: 0, color: "#047857", emoji:"🟢" },
  { id: "agua_500",         nombre: "Agua 500 ml",              unidadesPorPaquete: 12, codigoBarrasUnidad: "", precio: 0, color: "#1d4ed8", emoji:"💧" },
  { id: "agua_1l",          nombre: "Agua 1 L",                 unidadesPorPaquete: 12, codigoBarrasUnidad: "", precio: 0, color: "#0ea5e9", emoji:"💧" },
];

let STATE = seedSiHaceFalta();
let ULTIMO_MOV = null;
let lastScanTs = 0;

/* ===== Carrito (orden) ===== */
let ORDER = []; // cada línea: { productoId, qty, price }

function findOrderLine(pid){ return ORDER.find(l => l.productoId === pid) || null; }
function qtyInOrder(pid){ return findOrderLine(pid)?.qty || 0; }

// stock disponible descontando lo ya agregado al carrito
function availableFor(pid){
  const stock = calcularStockPorProducto();
  return Math.max(0, (stock[pid] || 0) - qtyInOrder(pid));
}

// TOTAL de la orden (artículos y $)
function orderTotal(){
  let items = 0, total = 0;
  for (const l of ORDER){
    const p = getProducto(l.productoId);
    const price = Number(l.price ?? p?.precio ?? 0);
    items += l.qty;
    total += price * l.qty;
  }
  return { items, total: +total.toFixed(2) };
}

/* ===== Persistencia ===== */
function cargarEstado(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||""); }catch{ return null; } }
function guardarEstado(s){ localStorage.setItem(LS_KEY, JSON.stringify(s)); }
function seedSiHaceFalta() {
  let s = cargarEstado();
  if (s) return s;
  const ahora = new Date().toISOString();
  const entradasSeed = catalogoBase.map(p => ({
    id: crypto.randomUUID(),
    fecha: ahora,
    tipo: "entrada",
    productoId: p.id,
    cantidadUnidades: p.unidadesPorPaquete, // 1 paquete por producto (12)
    nota: "Inventario inicial (1 paquete por producto)"
  }));
  s = { catalogo: catalogoBase, movimientos: entradasSeed };
  guardarEstado(s);
  return s;
}

/* ===== Utils ===== */
function getProducto(id){ return STATE.catalogo.find(p => p.id === id); }
function getProductoPorCodigoUnidad(code){
  const c = String(code||"").trim();
  return STATE.catalogo.find(p => (p.codigoBarrasUnidad||"").trim() === c) || null;
}
function calcularStockPorProducto() {
  const stock = {}; STATE.catalogo.forEach(p => stock[p.id] = 0);
  for (const m of STATE.movimientos) {
    if (!(m.productoId in stock)) continue;
    stock[m.productoId] += (m.tipo === "entrada" ? 1 : -1) * m.cantidadUnidades;
  }
  return stock;
}
function formMXN(n){ return Number(n||0).toLocaleString('es-MX',{style:'currency',currency:'MXN'}); }
function cooldownOk(ms=500){ const now=Date.now(); if(now-lastScanTs<ms) return false; lastScanTs=now; return true; }
function beep(ok=true){ try{ const a=new (window.AudioContext||window.webkitAudioContext)(),o=a.createOscillator(),g=a.createGain(); o.type=ok?"sine":"square";o.frequency.value=ok?880:240;o.connect(g);g.connect(a.destination);g.gain.setValueAtTime(.0001,a.currentTime);g.gain.exponentialRampToValueAtTime(.2,a.currentTime+.01);o.start();o.stop(a.currentTime+.12);}catch{} }

/* ===== Render: Catálogo ===== */
function renderCatalogo(){
  const tbody = document.querySelector("#tablaCatalogo tbody");
  tbody.innerHTML = "";
  for(const p of STATE.catalogo){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input data-field="nombre" data-id="${p.id}" type="text" value="${p.nombre}"></td>
      <td><input data-field="unidadesPorPaquete" data-id="${p.id}" type="number" min="1" value="${p.unidadesPorPaquete}"></td>
      <td><input data-field="precio" data-id="${p.id}" type="number" min="0" step="0.01" value="${Number(p.precio||0)}"></td>
      <td><input data-field="codigoBarrasUnidad" data-id="${p.id}" type="text" value="${p.codigoBarrasUnidad||""}" placeholder="EAN/UPC"></td>
      <td><input data-field="color" data-id="${p.id}" type="text" value="${p.color||""}" placeholder="#rrggbb"></td>
      <td><input data-field="emoji" data-id="${p.id}" type="text" value="${p.emoji||""}" placeholder="🥤"></td>
      <td><button class="ghost" data-action="del" data-id="${p.id}">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  }
  tbody.addEventListener("input", e=>{
    const el=e.target; const id=el.getAttribute("data-id"); const field=el.getAttribute("data-field");
    if(!id||!field) return; const prod=getProducto(id); if(!prod) return;
    if(field==="unidadesPorPaquete"){ prod[field] = Math.max(1, parseInt(el.value,10) || 1); }
    else if(field==="precio"){ prod[field] = Math.max(0, parseFloat(el.value)||0); }
    else { prod[field] = el.value; }
    if (["nombre","precio","color","emoji"].includes(field)) renderMosaicoVentas();
  });
  tbody.addEventListener("click", e=>{
    const btn=e.target.closest("button[data-action='del']"); if(!btn) return;
    const id=btn.getAttribute("data-id");
    const ix=STATE.catalogo.findIndex(p=>p.id===id);
    if(ix>=0 && confirm("¿Eliminar producto del catálogo? (no borra movimientos)")){
      STATE.catalogo.splice(ix,1); guardarEstado(STATE); renderCatalogo(); renderInventario(); renderMosaicoVentas();
    }
  });
}

/* ===== Render: Inventario ===== */
function renderInventario(){
  const tbody = document.querySelector("#tablaInventario tbody");
  tbody.innerHTML = "";
  const stock = calcularStockPorProducto();
  let total = 0;
  for(const p of STATE.catalogo){
    const u = stock[p.id]??0; total += u;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${p.nombre}</td><td>${p.unidadesPorPaquete}</td><td>${u}</td>`;
    tbody.appendChild(tr);
  }
  const trT = document.createElement("tr");
  trT.className = "total-row";
  trT.innerHTML = `<td colspan="2" style="text-align:right;">TOTAL</td><td>${total}</td>`;
  tbody.appendChild(trT);
}

/* ===== Render: Movimientos ===== */
function renderMovimientos(limit=20){
  const tbody = document.querySelector("#tablaMovimientos tbody");
  tbody.innerHTML = "";
  const ultimos = [...STATE.movimientos].reverse().slice(0,limit);
  for(const m of ultimos){
    const p = getProducto(m.productoId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(m.fecha).toLocaleString()}</td>
      <td>${m.tipo}</td>
      <td>${p ? p.nombre : m.productoId}</td>
      <td>${m.cantidadUnidades}</td>
      <td>${m.nota||""}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* ===== Resumen ventas (hoy) ===== */
function esMismaFechaLocal(a,b){ return new Date(a).toDateString()===new Date(b).toDateString(); }
function ventasDeHoy(){ const hoy=new Date(); return STATE.movimientos.filter(m=>m.tipo==="salida" && esMismaFechaLocal(m.fecha,hoy.toISOString())); }
function renderResumenVentasHoy(){
  const ventas = ventasDeHoy();
  let unid=0, total=0;
  const tbody = document.querySelector("#tablaVentasHoy tbody");
  if(tbody) tbody.innerHTML = "";
  for(const v of ventas.slice().reverse().slice(0,30)){
    const p = getProducto(v.productoId);
    const precio = v.precioUnitario ?? Number(p?.precio||0);
    const sub = v.subtotal ?? +(precio * v.cantidadUnidades).toFixed(2);
    if(tbody){
      const tr=document.createElement("tr");
      tr.innerHTML = `
        <td>${new Date(v.fecha).toLocaleTimeString()}</td>
        <td>${p ? p.nombre : v.productoId}</td>
        <td>${v.cantidadUnidades}</td>
        <td>${formMXN(precio)}</td>
        <td>${formMXN(sub)}</td>
      `;
      tbody.appendChild(tr);
    }
    unid += v.cantidadUnidades; total += sub;
  }
  document.getElementById("kpiVentasUnidades").textContent = String(unid);
  document.getElementById("kpiVentasTotal").textContent = formMXN(+total.toFixed(2));
}

/* ===== Núcleo movimientos ===== */
function registrarMovimiento({ tipo, productoId, cantidadUnidades, nota }){
  if(!cantidadUnidades || cantidadUnidades<=0) return;
  const prod = getProducto(productoId);
  const mov = {
    id: crypto.randomUUID(),
    fecha: new Date().toISOString(),
    tipo,
    productoId,
    cantidadUnidades,
    nota: nota||""
  };
  if(tipo==="salida"){
    const precioUnitario = Number(prod?.precio||0);
    mov.precioUnitario = precioUnitario;
    mov.subtotal = +(precioUnitario * cantidadUnidades).toFixed(2);
  }
  STATE.movimientos.push(mov);
  guardarEstado(STATE);
  ULTIMO_MOV = mov;
  renderInventario(); renderMovimientos(); renderResumenVentasHoy();
}

function deshacerUltimoMovimiento(){
  if(!ULTIMO_MOV) return alert("No hay movimiento para deshacer.");
  const idx = STATE.movimientos.findIndex(m=>m.id===ULTIMO_MOV.id);
  if(idx>=0){
    STATE.movimientos.splice(idx,1);
    guardarEstado(STATE);
    ULTIMO_MOV=null;
    renderInventario(); renderMovimientos(); renderResumenVentasHoy();
    alert("Movimiento deshecho.");
  } else { alert("No se encontró el movimiento."); }
}

/* ===== Ingreso modal ===== */
function fillModalProductoOptions(){
  const sel = document.getElementById("modalProducto");
  sel.innerHTML = "";
  STATE.catalogo.forEach(p=>{
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.nombre;
    sel.appendChild(opt);
  });
}

function abrirModalIngreso(){
  // deshabilita el input de ventas para evitar foco del lector
  document.getElementById("ventaScan")?.setAttribute("disabled","true");

  fillModalProductoOptions();
  document.getElementById("modalCantidad").value = "1";
  document.getElementById("modalNota").value = "";
  document.getElementById("modalIngresoContador").value = "0";
  // modo por defecto: unidad
  document.querySelector('input[name="modoIngreso"][value="unidad"]').checked = true;
  toggleModoLoteUI();

  const modal=document.getElementById("modalIngreso");
  modal.classList.remove("hidden"); modal.setAttribute("aria-hidden","false");
  setTimeout(()=>document.getElementById("modalProducto").focus(),50);
}

function cerrarModalIngreso(){
  document.getElementById("ventaScan")?.removeAttribute("disabled");
  const modal=document.getElementById("modalIngreso");
  modal.classList.add("hidden"); modal.setAttribute("aria-hidden","true");
  setTimeout(()=>document.getElementById("ventaScan").focus(),50);
}

function toggleModoLoteUI(){
  const isLote = [...document.querySelectorAll('input[name="modoIngreso"]')]
    .find(r=>r.checked)?.value === "lote";
  const cant = document.getElementById("modalCantidad");
  cant.disabled = !isLote;           // Unidad => deshabilitado (siempre 1)
  if (!isLote) cant.value = "1";
}

function crearProductoRapidoDesdeCodigo(codigo){
  const nombre = (prompt("Código nuevo detectado. Nombre del producto:", "Nuevo producto")||"").trim();
  if(!nombre) return null;
  const up = Math.max(1, parseInt(prompt("Unidades por paquete (ej. 12):","12"),10) || 1);
  const precio = Math.max(0, parseFloat(prompt("Precio por unidad (MXN):","0")) || 0);
  const nuevo = { id:"prod_"+crypto.randomUUID().slice(0,8), nombre, unidadesPorPaquete:up, codigoBarrasUnidad:String(codigo).trim(), precio, color:"#374151", emoji:"🧃" };
  STATE.catalogo.push(nuevo); guardarEstado(STATE);
  renderCatalogo(); renderInventario(); renderMosaicoVentas();
  return nuevo;
}
function procesarIngresoManual(){
  const sel = document.getElementById("modalProducto");
  const pid = sel.value;
  const prod = getProducto(pid);
  if(!prod){ alert("Selecciona un producto válido."); return; }

  const modo = [...document.querySelectorAll('input[name="modoIngreso"]')]
    .find(r=>r.checked)?.value || "unidad";

  let cantidad = 1;
  if (modo === "lote") {
    cantidad = Math.max(1, parseInt(document.getElementById("modalCantidad").value,10) || 1);
  }

  const nota = (document.getElementById("modalNota").value||"").trim();

  registrarMovimiento({
    tipo: "entrada",
    productoId: pid,
    cantidadUnidades: cantidad,
    nota: nota ? `Ingreso manual: ${nota}` : "Ingreso manual"
  });

  // contador de sesión
  const c = document.getElementById("modalIngresoContador");
  c.value = String((parseInt(c.value,10)||0) + cantidad);

  // feedback y preparar siguiente
  try{ beep(true); }catch{}
  if (modo === "lote") document.getElementById("modalCantidad").select();
  else sel.focus(); // unidad: listo para elegir otro
}


/* ===== Mosaico de ventas ===== */
function productoBadgeHTML(p, stock){
  const emoji = p.emoji || "🥤";
  return `
    <div class="tile__footer">
      <div class="tile__title">${p.nombre}</div>
      <div class="tile__price">${formMXN(p.precio||0)}</div>
    </div>
    <div class="tile__pulse"></div>
    <div class="tile__emoji" aria-hidden="true">${emoji}</div>
    <div class="tile__stock">${stock} en stock</div>
  `;
}
function renderMosaicoVentas(){
  const wrap = document.getElementById("ventaMosaico");
  if(!wrap) return;
  wrap.innerHTML = "";
  const stock = calcularStockPorProducto();
  const q = (document.getElementById("ventaBuscar").value||"").trim().toLowerCase();

  STATE.catalogo
    .filter(p => !q || p.nombre.toLowerCase().includes(q))
    .forEach(p=>{
      const s = stock[p.id] ?? 0;
      const tile = document.createElement("button");
      tile.className = "tile";
      if(s<=0) tile.classList.add("tile--no-stock");
      tile.style.borderColor = (p.color ? p.color : "#20304f");
      tile.style.background = p.color
        ? `linear-gradient(135deg, ${p.color}44, ${p.color}22)`
        : "linear-gradient(135deg,#1b2338,#0a1020)";
      tile.innerHTML = productoBadgeHTML(p, s);

      // Chapita con cantidad en carrito
      const inOrder = qtyInOrder(p.id);
      if (inOrder > 0) {
        const badge = document.createElement("div");
        badge.className = "badge-on-tile";
        badge.textContent = `×${inOrder}`;
        tile.appendChild(badge);
      }

      // Agregar al carrito (click / alt-click / long-press)
      let pressTimer=null, pressed=false;
      const agregar = (cantidad=1)=>{
        const cap = availableFor(p.id);
        if (cap <= 0){ tile.classList.add("tile--shake"); setTimeout(()=>tile.classList.remove("tile--shake"), 350); beep(false); return; }
        if (cantidad > cap){ alert(`Solo hay ${cap} disponibles.`); cantidad = cap; if (cantidad<=0) return; }

        const precio = Number(p.precio||0);
        const line = findOrderLine(p.id);
        if (line) line.qty += cantidad;
        else ORDER.push({ productoId: p.id, qty: cantidad, price: precio });

        renderOrderPanel(); renderMosaicoVentas();
        beep(true);
      };

      tile.addEventListener("click", (e)=>{
        if(e.altKey){
          const n = parseInt(prompt(`¿Cuántas unidades de "${p.nombre}"?`, "2"),10);
          if(!isNaN(n) && n>0) agregar(n);
        } else if (!pressed){
          agregar(1);
        }
        pressed=false;
      });

      // Long press (táctil)
      tile.addEventListener("touchstart", ()=>{
        pressed=false;
        pressTimer=setTimeout(()=>{
          pressed=true;
          const n = parseInt(prompt(`¿Cuántas unidades de "${p.nombre}"?`, "2"),10);
          if(!isNaN(n) && n>0) agregar(n);
        }, 500);
      });
      tile.addEventListener("touchend", ()=> clearTimeout(pressTimer));
      tile.addEventListener("touchmove", ()=> clearTimeout(pressTimer));

      wrap.appendChild(tile);
    });
}

/* ===== Panel de orden ===== */
function renderOrderPanel(){
  const tbody = document.querySelector("#orderTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  for(const l of ORDER){
    const p = getProducto(l.productoId);
    const precio = Number(l.price || p?.precio || 0);
    const sub = +(precio * l.qty).toFixed(2);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p ? p.nombre : l.productoId}</td>
      <td>
        <div class="order-qty">
          <button data-action="dec" data-id="${l.productoId}" class="ghost">−</button>
          <input data-action="edit" data-id="${l.productoId}" type="number" min="1" value="${l.qty}" style="width:56px; text-align:center;">
          <button data-action="inc" data-id="${l.productoId}" class="ghost">＋</button>
        </div>
      </td>
      <td>${formMXN(precio)}</td>
      <td>${formMXN(sub)}</td>
      <td><button data-action="del" data-id="${l.productoId}" class="ghost">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  }

  // Totales
  const { items, total } = orderTotal();
  document.getElementById("orderItemsCount").textContent = `${ORDER.length} líneas`;
  document.getElementById("orderCount").textContent = String(items);
  document.getElementById("orderTotal").textContent = formMXN(total);

  // Delegación de eventos
  tbody.onclick = (e)=>{
    const el = e.target.closest("button, input");
    if (!el) return;
    const pid = el.getAttribute("data-id");
    const act = el.getAttribute("data-action");
    const line = findOrderLine(pid);
    if (!line) return;

    if (act === "inc") {
      const cap = availableFor(pid);
      if (cap <= 0){ beep(false); alert("Sin stock disponible para agregar más."); return; }
      line.qty += 1;
    }
    if (act === "dec") {
      line.qty -= 1;
      if (line.qty <= 0) ORDER = ORDER.filter(l => l.productoId !== pid);
    }
    if (act === "del") {
      ORDER = ORDER.filter(l => l.productoId !== pid);
    }
    if (act === "edit" && el.tagName === "INPUT") {
      el.addEventListener("change", ()=>{
        let n = Math.max(1, parseInt(el.value,10) || 1);
        const cap = qtyInOrder(pid) + availableFor(pid); // stock total posible
        if (n > cap) { alert(`Máximo permitido: ${cap}`); n = cap; }
        line.qty = n;
        renderOrderPanel(); renderMosaicoVentas();
      }, { once: true });
      return;
    }

    renderOrderPanel(); renderMosaicoVentas();
  };
}

/* ===== Acciones de la orden ===== */
function clearOrder() {
  if (ORDER.length === 0) return;
  if (confirm("¿Vaciar la orden actual?")) {
    ORDER = [];
    renderOrderPanel();
    renderMosaicoVentas();
  }
}
function cancelOrder() {
  if (ORDER.length === 0) return;
  if (confirm("¿Cancelar la orden? Se perderán los items seleccionados.")) {
    ORDER = [];
    renderOrderPanel();
    renderMosaicoVentas();
  }
}
function checkoutOrder() {
  if (ORDER.length === 0) { alert("La orden está vacía."); return; }

  // Validar stock antes de descontar
  const stock = calcularStockPorProducto();
  for (const l of ORDER) {
    const disponible = stock[l.productoId] ?? 0;
    if (disponible < l.qty) {
      const p = getProducto(l.productoId);
      alert(`Stock insuficiente para ${p?.nombre || l.productoId}. Disponible: ${disponible}, pedido: ${l.qty}`);
      return;
    }
  }

  // Registrar salidas
  for (const l of ORDER) {
    registrarMovimiento({
      tipo: "salida",
      productoId: l.productoId,
      cantidadUnidades: l.qty,
      nota: "Venta (orden)"
    });
  }

  const { items, total } = orderTotal();
  alert(`Orden cerrada.\nArtículos: ${items}\nTotal: ${formMXN(total)}`);

  ORDER = [];
  renderOrderPanel();
  renderMosaicoVentas();
}

/* ===== Escáner físico (agrega al carrito) ===== */
function procesarVentaScan(codeOverride=null){
  if(!cooldownOk()) return;
  const code = (codeOverride ?? document.getElementById("ventaScan").value.trim());
  if(!code) return;
  const prod = getProductoPorCodigoUnidad(code);
  if(!prod){ alert("Código no registrado en catálogo."); document.getElementById("ventaScan").value=""; beep(false); return; }

  const cap = availableFor(prod.id);
  if (cap <= 0){ alert(`Sin stock para ${prod.nombre}.`); document.getElementById("ventaScan").value=""; beep(false); return; }

  const line = findOrderLine(prod.id);
  if (line) line.qty += 1;
  else ORDER.push({ productoId: prod.id, qty: 1, price: Number(prod.precio||0) });

  document.getElementById("ventaUltimo").value = prod.nombre;
  document.getElementById("ventaScan").value = "";
  renderOrderPanel(); renderMosaicoVentas();
  beep(true);
}

/* ===== Listeners ===== */
// Ingreso manual (F2)
document.getElementById("btnIngresoRapido").addEventListener("click", abrirModalIngreso);
document.getElementById("modalIngresoCerrar").addEventListener("click", cerrarModalIngreso);
document.getElementById("modalIngresoTerminar").addEventListener("click", cerrarModalIngreso);
document.querySelectorAll('input[name="modoIngreso"]').forEach(r=> r.addEventListener("change", toggleModoLoteUI));
document.getElementById("modalIngresoAgregar").addEventListener("click", procesarIngresoManual);

// Enter en cantidad (cuando está habilitada)
document.getElementById("modalCantidad").addEventListener("keydown", (e)=>{
  if(e.key === "Enter") procesarIngresoManual();
});

// Atajos: F2 abre, Esc cierra si está abierto
document.addEventListener("keydown",(e)=>{
  const modalAbierto = !document.getElementById("modalIngreso").classList.contains("hidden");
  if(e.key==="F2" && !modalAbierto){ e.preventDefault(); abrirModalIngreso(); }
  if(e.key==="Escape" && modalAbierto){ e.preventDefault(); cerrarModalIngreso(); }
});


/* ===== Init ===== */
function init(){
  renderCatalogo();
  renderInventario();
  renderMovimientos();
  renderResumenVentasHoy();
  renderMosaicoVentas();
  renderOrderPanel();
  wireEvents();
}
document.addEventListener("DOMContentLoaded", init);
