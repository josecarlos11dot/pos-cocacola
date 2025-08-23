/* POS Coca-Cola — Ventas + Ingreso en modal (Unidad/Lote) + Cámara + Resumen ventas */
const LS_KEY = "pos_coca_b3_state_cam";

/* Catálogo base con precio (edítalo en Catálogo) */
const catalogoBase = [
  { id: "coca_regular_355", nombre: "Coca-Cola Regular 355 ml", unidadesPorPaquete: 12, codigoBarrasUnidad: "", precio: 0 },
  { id: "coca_zero_355",    nombre: "Coca-Cola Zero 355 ml",    unidadesPorPaquete: 12, codigoBarrasUnidad: "", precio: 0 },
  { id: "sidral_600",       nombre: "Sidral Mundet 600 ml",     unidadesPorPaquete: 12, codigoBarrasUnidad: "", precio: 0 },
  { id: "sprite_600",       nombre: "Sprite 600 ml",            unidadesPorPaquete: 12, codigoBarrasUnidad: "", precio: 0 },
  { id: "agua_500",         nombre: "Agua 500 ml",              unidadesPorPaquete: 12, codigoBarrasUnidad: "", precio: 0 },
  { id: "agua_1l",          nombre: "Agua 1 L",                 unidadesPorPaquete: 12, codigoBarrasUnidad: "", precio: 0 },
];

let STATE = seedSiHaceFalta();
let MODO = "sale";             // 'sale' | 'intake'
let ULTIMO_MOV = null;         // para deshacer
let lastScanTs = 0;            // cooldown anti doble-lectura (ms)

// ZXing helpers
const { BrowserMultiFormatReader, NotFoundException } = window.ZXing || {};
const zxingVenta = new BrowserMultiFormatReader();
const zxingIngreso = new BrowserMultiFormatReader();
let ventaCurrentDeviceId = null;
let ingresoCurrentDeviceId = null;
let ventaTrack = null;
let ingresoTrack = null;

/* ===== Persistencia ===== */
function cargarEstado() {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function guardarEstado(state) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}
function seedSiHaceFalta() {
  let state = cargarEstado();
  if (state) return state;
  const ahora = new Date().toISOString();
  const entradasSeed = catalogoBase.map(p => ({
    id: crypto.randomUUID(),
    fecha: ahora,
    tipo: "entrada",
    productoId: p.id,
    cantidadUnidades: p.unidadesPorPaquete * 1, // 1 paquete por producto
    nota: "Inventario inicial (1 paquete por producto)"
  }));
  state = { catalogo: catalogoBase, movimientos: entradasSeed };
  guardarEstado(state);
  return state;
}

/* ===== Utils ===== */
function getProducto(id) {
  return STATE.catalogo.find(p => p.id === id);
}
function getProductoPorCodigoUnidad(code) {
  if (!code) return null;
  const codeStr = String(code).trim();
  return STATE.catalogo.find(p => (p.codigoBarrasUnidad || "").trim() === codeStr);
}
function calcularStockPorProducto() {
  const stock = {};
  for (const p of STATE.catalogo) stock[p.id] = 0;
  for (const m of STATE.movimientos) {
    if (!(m.productoId in stock)) continue;
    if (m.tipo === "entrada") stock[m.productoId] += m.cantidadUnidades;
    if (m.tipo === "salida")  stock[m.productoId] -= m.cantidadUnidades;
  }
  return stock;
}
function cooldownOk() {
  const now = Date.now();
  if (now - lastScanTs < 700) return false; // 700 ms para cámara
  lastScanTs = now;
  return true;
}
function beep(ok = true) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = ok ? "sine" : "square";
    o.frequency.value = ok ? 880 : 240;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    o.start();
    o.stop(ctx.currentTime + 0.12);
  } catch {}
}

/* Alta rápida si el código no existe */
function crearProductoRapidoDesdeCodigo(codigo) {
  const nombre = (prompt("Código nuevo detectado. Ingresa el NOMBRE del producto:", "Nuevo producto") || "").trim();
  if (!nombre) return null;
  const up = Math.max(1, parseInt(prompt("Unidades por paquete (ej. 12):", "12"), 10) || 1);
  const precio = Math.max(0, parseFloat(prompt("Precio por unidad (MXN):", "0")) || 0);
  const nuevo = {
    id: "prod_" + crypto.randomUUID().slice(0,8),
    nombre,
    unidadesPorPaquete: up,
    codigoBarrasUnidad: String(codigo).trim(),
    precio
  };
  STATE.catalogo.push(nuevo);
  guardarEstado(STATE);
  renderCatalogo();
  renderInventario();
  return nuevo;
}
function asegurarProductoParaCodigoUnidad(codigo) {
  let prod = getProductoPorCodigoUnidad(codigo);
  if (prod) return prod;
  return crearProductoRapidoDesdeCodigo(codigo);
}

/* ===== Render ===== */
function renderCatalogo() {
  const tbody = document.querySelector("#tablaCatalogo tbody");
  tbody.innerHTML = "";
  for (const p of STATE.catalogo) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input data-field="nombre" data-id="${p.id}" type="text" value="${p.nombre}"></td>
      <td><input data-field="unidadesPorPaquete" data-id="${p.id}" type="number" min="1" value="${p.unidadesPorPaquete}"></td>
      <td><input data-field="precio" data-id="${p.id}" type="number" min="0" step="0.01" value="${Number(p.precio||0)}"></td>
      <td><input data-field="codigoBarrasUnidad" data-id="${p.id}" type="text" value="${p.codigoBarrasUnidad || ""}" placeholder="EAN/UPC"></td>
      <td><button class="ghost" data-action="del" data-id="${p.id}">🗑️</button></td>
    `;
    tbody.appendChild(tr);
  }
  // Delegación de eventos
  tbody.addEventListener("input", (e) => {
    const el = e.target;
    const id = el.getAttribute("data-id");
    const field = el.getAttribute("data-field");
    if (!id || !field) return;
    const prod = getProducto(id);
    if (!prod) return;
    if (field === "unidadesPorPaquete") {
      prod[field] = Math.max(1, parseInt(el.value, 10) || 1);
    } else if (field === "precio") {
      prod[field] = Math.max(0, parseFloat(el.value) || 0);
    } else {
      prod[field] = el.value;
    }
  });
  tbody.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action='del']");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    const ix = STATE.catalogo.findIndex(p => p.id === id);
    if (ix >= 0 && confirm("¿Eliminar producto del catálogo? (No borra movimientos históricos)")) {
      STATE.catalogo.splice(ix, 1);
      guardarEstado(STATE);
      renderCatalogo();
      renderInventario();
    }
  });
}
function agregarProductoVacio() {
  const nuevo = {
    id: "prod_" + crypto.randomUUID().slice(0,8),
    nombre: "Nuevo producto",
    unidadesPorPaquete: 12,
    codigoBarrasUnidad: "",
    precio: 0
  };
  STATE.catalogo.push(nuevo);
  guardarEstado(STATE);
  renderCatalogo();
}
function renderInventario() {
  const tbody = document.querySelector("#tablaInventario tbody");
  tbody.innerHTML = "";
  const stock = calcularStockPorProducto();
  let totalUnidades = 0;
  for (const p of STATE.catalogo) {
    const unidades = stock[p.id] ?? 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.nombre}</td>
      <td>${p.unidadesPorPaquete}</td>
      <td>${unidades}</td>
    `;
    tbody.appendChild(tr);
    totalUnidades += unidades;
  }
  const trTotal = document.createElement("tr");
  trTotal.classList.add("total-row");
  trTotal.innerHTML = `<td colspan="2" style="text-align:right;">TOTAL</td><td>${totalUnidades}</td>`;
  tbody.appendChild(trTotal);
}
function renderMovimientos(limit = 20) {
  const tbody = document.querySelector("#tablaMovimientos tbody");
  tbody.innerHTML = "";
  const ultimos = [...STATE.movimientos].reverse().slice(0, limit);
  for (const m of ultimos) {
    const prod = getProducto(m.productoId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(m.fecha).toLocaleString()}</td>
      <td>${m.tipo}</td>
      <td>${prod ? prod.nombre : m.productoId}</td>
      <td>${m.cantidadUnidades}</td>
      <td>${m.nota ?? ""}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* ===== Resumen ventas (hoy) ===== */
function esMismaFechaLocal(isoA, isoB) { const a=new Date(isoA), b=new Date(isoB); return a.toDateString()===b.toDateString(); }
function formMXN(n) { return n.toLocaleString('es-MX', { style:'currency', currency:'MXN' }); }
function ventasDeHoy() {
  const hoy = new Date();
  return STATE.movimientos.filter(m => m.tipo === "salida" && esMismaFechaLocal(m.fecha, hoy.toISOString()));
}
function renderResumenVentasHoy() {
  const ventas = ventasDeHoy();
  let totalUnidades = 0, totalMonto = 0;

  const tbody = document.querySelector("#tablaVentasHoy tbody");
  if (tbody) tbody.innerHTML = "";

  for (const v of ventas.slice().reverse().slice(0, 30)) {
    const prod = getProducto(v.productoId);
    const precio = v.precioUnitario ?? Number(prod?.precio || 0);
    const subtotal = v.subtotal ?? +(precio * v.cantidadUnidades).toFixed(2);

    if (tbody) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${new Date(v.fecha).toLocaleTimeString()}</td>
        <td>${prod ? prod.nombre : v.productoId}</td>
        <td>${v.cantidadUnidades}</td>
        <td>${formMXN(precio)}</td>
        <td>${formMXN(subtotal)}</td>
      `;
      tbody.appendChild(tr);
    }

    totalUnidades += v.cantidadUnidades;
    totalMonto += subtotal;
  }

  const kpiU = document.getElementById("kpiVentasUnidades");
  const kpiT = document.getElementById("kpiVentasTotal");
  if (kpiU) kpiU.textContent = String(totalUnidades);
  if (kpiT) kpiT.textContent = formMXN(+totalMonto.toFixed(2));
}

/* ===== Núcleo de movimientos ===== */
function registrarMovimiento({ tipo, productoId, cantidadUnidades, nota }) {
  if (!cantidadUnidades || cantidadUnidades <= 0) return;

  const prod = getProducto(productoId);
  const mov = {
    id: crypto.randomUUID(),
    fecha: new Date().toISOString(),
    tipo, // 'entrada' | 'salida'
    productoId,
    cantidadUnidades,
    nota: nota || ""
  };

  if (tipo === "salida") {
    const precioUnitario = Number(prod?.precio || 0);
    mov.precioUnitario = precioUnitario;
    mov.subtotal = +(precioUnitario * cantidadUnidades).toFixed(2);
  }

  STATE.movimientos.push(mov);
  guardarEstado(STATE);
  ULTIMO_MOV = mov;
  renderInventario();
  renderMovimientos();
  renderResumenVentasHoy();
}
function deshacerUltimoMovimiento() {
  if (!ULTIMO_MOV) return alert("No hay movimiento para deshacer.");
  const idx = STATE.movimientos.findIndex(m => m.id === ULTIMO_MOV.id);
  if (idx >= 0) {
    STATE.movimientos.splice(idx, 1);
    guardarEstado(STATE);
    ULTIMO_MOV = null;
    renderInventario();
    renderMovimientos();
    renderResumenVentasHoy();
    alert("Movimiento deshecho.");
  } else {
    alert("No se encontró el movimiento a deshacer.");
  }
}

/* ===== Venta por escaneo ===== */
function procesarVentaScan(codeOverride=null) {
  if (!cooldownOk()) return;
  const code = (codeOverride ?? document.getElementById("ventaScan").value.trim());
  if (!code) return;
  const prod = getProductoPorCodigoUnidad(code);
  if (!prod) {
    alert("Código no registrado en catálogo. (No se da de alta desde venta)");
    document.getElementById("ventaScan").value = "";
    beep(false);
    return;
  }
  const stock = calcularStockPorProducto();
  if ((stock[prod.id] ?? 0) <= 0) {
    alert(`Sin stock para ${prod.nombre}.`);
    document.getElementById("ventaScan").value = "";
    beep(false);
    return;
  }
  registrarMovimiento({ tipo: "salida", productoId: prod.id, cantidadUnidades: 1, nota: "Venta por escaneo" });
  document.getElementById("ventaUltimo").value = prod.nombre;
  document.getElementById("ventaScan").value = "";
  beep(true);
}

/* ===== Ingreso (modal) Unidad/Lote ===== */
function abrirModalIngreso() {
  MODO = "intake";
  document.getElementById("ventaScan")?.setAttribute("disabled", "true");
  const modal = document.getElementById("modalIngreso");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  setTimeout(() => document.getElementById("modalIngresoScan").focus(), 50);
}
function cerrarModalIngreso() {
  MODO = "sale";
  document.getElementById("ventaScan")?.removeAttribute("disabled");
  const modal = document.getElementById("modalIngreso");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  setTimeout(() => document.getElementById("ventaScan").focus(), 50);
}
function toggleModoLoteUI() {
  const radios = document.querySelectorAll('input[name="modoIngreso"]');
  const isLote = [...radios].find(r => r.checked)?.value === "lote";
  document.getElementById("fieldCantidadLote").style.display = isLote ? "block" : "none";
}
function procesarModalIngresoScan(codeOverride=null) {
  if (!cooldownOk()) return;
  const code = (codeOverride ?? document.getElementById("modalIngresoScan").value.trim());
  if (!code) return;

  // Buscar o crear producto por código de unidad
  const prod = asegurarProductoParaCodigoUnidad(code);
  if (!prod) { beep(false); return; } // cancelado

  const radios = document.querySelectorAll('input[name="modoIngreso"]');
  const modo = [...radios].find(r => r.checked)?.value || "unidad";

  if (modo === "unidad") {
    registrarMovimiento({ tipo: "entrada", productoId: prod.id, cantidadUnidades: 1, nota: "Ingreso unitario (modal)" });
    document.getElementById("modalIngresoScan").value = "";
    const c = document.getElementById("modalIngresoContador");
    c.value = String((parseInt(c.value, 10) || 0) + 1);
    beep(true);
    return;
  }

  // Lote: confirmar y permitir editar cantidad
  let cantidad = Math.max(1, parseInt(document.getElementById("modalCantidadLote").value, 10) || 1);
  const msg = `Detecté "${prod.nombre}". ¿Agregar ${cantidad} unidades?`;
  const ok = confirm(msg);
  if (!ok) {
    const editar = confirm("¿Quieres editar la cantidad?");
    if (editar) {
      const nueva = parseInt(prompt("Nueva cantidad a ingresar:", String(cantidad)), 10);
      if (!isNaN(nueva) && nueva > 0) cantidad = nueva;
      else { beep(false); return; }
    } else { beep(false); return; }
  }

  registrarMovimiento({ tipo: "entrada", productoId: prod.id, cantidadUnidades: cantidad, nota: `Ingreso por lote (x${cantidad})` });
  document.getElementById("modalIngresoScan").value = "";
  const c = document.getElementById("modalIngresoContador");
  c.value = String((parseInt(c.value, 10) || 0) + cantidad);
  beep(true);
}

/* ===== Cámara (ZXing) ===== */
async function listarCamaras(selectEl) {
  try {
    const devices = await BrowserMultiFormatReader.listVideoInputDevices();
    selectEl.innerHTML = "";
    devices.forEach((d, idx) => {
      const opt = document.createElement("option");
      opt.value = d.deviceId;
      opt.textContent = d.label || `Cámara ${idx+1}`;
      selectEl.appendChild(opt);
    });
    return devices;
  } catch (e) {
    console.warn("No se pudieron listar cámaras", e);
    selectEl.innerHTML = "<option value=''>No disponible</option>";
    return [];
  }
}

async function startVentaCamera() {
  const video = document.getElementById("ventaVideo");
  const select = document.getElementById("ventaCamSelect");
  const status = document.getElementById("ventaCamStatus");
  const deviceId = select.value || undefined;

  stopVentaCamera(); // por si acaso
  try {
    await zxingVenta.decodeFromVideoDevice(deviceId, video, (result, err, controls) => {
      if (result) {
        status.textContent = `✅ ${result.getText()}`;
        procesarVentaScan(result.getText());
      } else if (err && !(err instanceof NotFoundException)) {
        status.textContent = "⚠️ Error leyendo";
      }
    });
    // guardar track para torch
    const stream = video.srcObject;
    ventaTrack = stream?.getVideoTracks?.()[0] || null;
    ventaCurrentDeviceId = deviceId || (await listarCamaras(select))[0]?.deviceId || null;
    status.textContent = "Cámara activa";
  } catch (e) {
    status.textContent = "❌ No se pudo iniciar cámara";
    console.error(e);
  }
}
function stopVentaCamera() {
  try { zxingVenta.reset(); } catch {}
  try {
    const video = document.getElementById("ventaVideo");
    const stream = video?.srcObject;
    stream?.getTracks?.().forEach(t => t.stop());
    video.srcObject = null;
  } catch {}
  ventaTrack = null;
  document.getElementById("ventaCamStatus").textContent = "Cámara inactiva";
}
async function toggleVentaTorch() {
  if (!ventaTrack) return;
  const caps = ventaTrack.getCapabilities?.();
  if (!caps || !caps.torch) return alert("Linterna no soportada en este dispositivo.");
  const settings = ventaTrack.getSettings?.();
  const torchOn = !settings.torch;
  await ventaTrack.applyConstraints({ advanced: [{ torch: torchOn }] });
}

async function startIngresoCamera() {
  const video = document.getElementById("ingresoVideo");
  const select = document.getElementById("ingresoCamSelect");
  const status = document.getElementById("ingresoCamStatus");
  const deviceId = select.value || undefined;

  stopIngresoCamera(); // por si acaso
  try {
    await zxingIngreso.decodeFromVideoDevice(deviceId, video, (result, err, controls) => {
      if (result) {
        status.textContent = `✅ ${result.getText()}`;
        procesarModalIngresoScan(result.getText());
      } else if (err && !(err instanceof NotFoundException)) {
        status.textContent = "⚠️ Error leyendo";
      }
    });
    const stream = video.srcObject;
    ingresoTrack = stream?.getVideoTracks?.()[0] || null;
    ingresoCurrentDeviceId = deviceId || (await listarCamaras(select))[0]?.deviceId || null;
    status.textContent = "Cámara activa";
  } catch (e) {
    status.textContent = "❌ No se pudo iniciar cámara";
    console.error(e);
  }
}
function stopIngresoCamera() {
  try { zxingIngreso.reset(); } catch {}
  try {
    const video = document.getElementById("ingresoVideo");
    const stream = video?.srcObject;
    stream?.getTracks?.().forEach(t => t.stop());
    video.srcObject = null;
  } catch {}
  ingresoTrack = null;
  document.getElementById("ingresoCamStatus").textContent = "Cámara inactiva";
}
async function toggleIngresoTorch() {
  if (!ingresoTrack) return;
  const caps = ingresoTrack.getCapabilities?.();
  if (!caps || !caps.torch) return alert("Linterna no soportada en este dispositivo.");
  const settings = ingresoTrack.getSettings?.();
  const torchOn = !settings.torch;
  await ingresoTrack.applyConstraints({ advanced: [{ torch: torchOn }] });
}

/* ===== Listeners ===== */
function wireEvents() {
  // Venta
  document.getElementById("ventaScan").addEventListener("keydown", (e) => {
    if (e.key === "Enter") procesarVentaScan();
  });
  document.getElementById("btnUndo").addEventListener("click", deshacerUltimoMovimiento);

  // Catálogo
  document.getElementById("btnAgregarProducto").addEventListener("click", agregarProductoVacio);
  document.getElementById("btnGuardarCatalogo").addEventListener("click", () => {
    guardarEstado(STATE);
    alert("Catálogo guardado.");
    renderInventario();
  });

  // Modal ingreso
  document.getElementById("btnIngresoRapido").addEventListener("click", async () => {
    abrirModalIngreso();
    await listarCamaras(document.getElementById("ingresoCamSelect"));
  });
  document.getElementById("modalIngresoCerrar").addEventListener("click", () => { stopIngresoCamera(); cerrarModalIngreso(); });
  document.getElementById("modalIngresoTerminar").addEventListener("click", () => { stopIngresoCamera(); cerrarModalIngreso(); });
  document.getElementById("modalIngresoScan").addEventListener("keydown", (e) => {
    if (e.key === "Enter") procesarModalIngresoScan();
  });
  document.querySelectorAll('input[name="modoIngreso"]').forEach(r => {
    r.addEventListener("change", toggleModoLoteUI);
  });

  // Atajos globales
  document.addEventListener("keydown", (e) => {
    if (e.key === "F2" && document.getElementById("modalIngreso").classList.contains("hidden")) {
      e.preventDefault(); abrirModalIngreso(); listarCamaras(document.getElementById("ingresoCamSelect"));
    }
    if (e.key === "Escape" && !document.getElementById("modalIngreso").classList.contains("hidden")) {
      e.preventDefault(); stopIngresoCamera(); cerrarModalIngreso();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault(); deshacerUltimoMovimiento();
    }
  });

  // Cámara Ventas
  document.getElementById("ventaCamStart").addEventListener("click", startVentaCamera);
  document.getElementById("ventaCamStop").addEventListener("click", stopVentaCamera);
  document.getElementById("ventaTorch").addEventListener("click", toggleVentaTorch);
  document.getElementById("ventaCamSelect").addEventListener("change", () => {
    if (document.getElementById("ventaVideo").srcObject) startVentaCamera();
  });

  // Cámara Ingreso
  document.getElementById("ingresoCamStart").addEventListener("click", startIngresoCamera);
  document.getElementById("ingresoCamStop").addEventListener("click", stopIngresoCamera);
  document.getElementById("ingresoTorch").addEventListener("click", toggleIngresoTorch);
  document.getElementById("ingresoCamSelect").addEventListener("change", () => {
    if (document.getElementById("ingresoVideo").srcObject) startIngresoCamera();
  });

  // Enfoque inicial
  setTimeout(async () => {
    document.getElementById("ventaScan")?.focus();
    await listarCamaras(document.getElementById("ventaCamSelect"));
  }, 100);
}

/* ===== Init ===== */
function init() {
  renderCatalogo();
  renderInventario();
  renderMovimientos();
  renderResumenVentasHoy();
  wireEvents();
}
document.addEventListener("DOMContentLoaded", init);
