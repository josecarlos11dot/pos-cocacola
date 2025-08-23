/* Scanner móvil — Ingreso por cámara (Unidad/Lote) con alta rápida
   NOTA: usa el MISMO esquema que el POS pero es autónomo.
*/
const LS_KEY = "pos_coca_b3_state_cam"; // igual que en app.js 👈

let STATE = cargarEstado() || seed();
let lastScanTs = 0; // cooldown
const { BrowserMultiFormatReader, NotFoundException } = window.ZXing || {};
const zxing = new BrowserMultiFormatReader();
let currentTrack = null;

/* ===== Persistencia ===== */
function cargarEstado(){ try { return JSON.parse(localStorage.getItem(LS_KEY) || ""); } catch { return null; } }
function guardarEstado(s){ localStorage.setItem(LS_KEY, JSON.stringify(s)); }
function seed() {
  // catálogo de ejemplo vacío de códigos (ajústalos en el POS)
  const catalogoBase = [
    { id:"coca_regular_355", nombre:"Coca-Cola Regular 355 ml", unidadesPorPaquete:12, codigoBarrasUnidad:"", precio:0 },
    { id:"coca_zero_355",    nombre:"Coca-Cola Zero 355 ml",    unidadesPorPaquete:12, codigoBarrasUnidad:"", precio:0 },
    { id:"sidral_600",       nombre:"Sidral Mundet 600 ml",     unidadesPorPaquete:12, codigoBarrasUnidad:"", precio:0 },
    { id:"sprite_600",       nombre:"Sprite 600 ml",            unidadesPorPaquete:12, codigoBarrasUnidad:"", precio:0 },
    { id:"agua_500",         nombre:"Agua 500 ml",              unidadesPorPaquete:12, codigoBarrasUnidad:"", precio:0 },
    { id:"agua_1l",          nombre:"Agua 1 L",                 unidadesPorPaquete:12, codigoBarrasUnidad:"", precio:0 },
  ];
  const ahora = new Date().toISOString();
  const entradasSeed = catalogoBase.map(p => ({
    id: crypto.randomUUID(), fecha: ahora, tipo:"entrada", productoId:p.id,
    cantidadUnidades: p.unidadesPorPaquete, nota:"Inventario inicial (scanner)"
  }));
  const s = { catalogo: catalogoBase, movimientos: entradasSeed };
  guardarEstado(s); return s;
}

/* ===== Utils ===== */
function getProductoPorCodigoUnidad(code) {
  const c = String(code||"").trim();
  return STATE.catalogo.find(p => (p.codigoBarrasUnidad||"").trim() === c) || null;
}
function getProducto(id){ return STATE.catalogo.find(p => p.id === id); }
function cooldownOk(){ const now=Date.now(); if(now-lastScanTs<700) return false; lastScanTs=now; return true; }
function beep(ok=true){
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = ok ? "sine":"square"; o.frequency.value = ok ? 880:240;
    o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime+0.01);
    o.start(); o.stop(ctx.currentTime+0.12);
  }catch{}
}

/* ===== Alta rápida ===== */
function crearProductoRapidoDesdeCodigo(codigo) {
  const nombre = (prompt("Código nuevo. Nombre del producto:", "Nuevo producto")||"").trim();
  if(!nombre) return null;
  const up = Math.max(1, parseInt(prompt("Unidades por paquete (ej. 12):","12"),10) || 1);
  const precio = Math.max(0, parseFloat(prompt("Precio por unidad (MXN):", "0")) || 0);
  const nuevo = {
    id: "prod_"+crypto.randomUUID().slice(0,8),
    nombre, unidadesPorPaquete: up,
    codigoBarrasUnidad: String(codigo).trim(),
    precio
  };
  STATE.catalogo.push(nuevo);
  guardarEstado(STATE);
  return nuevo;
}
function asegurarProductoParaCodigoUnidad(codigo){
  return getProductoPorCodigoUnidad(codigo) || crearProductoRapidoDesdeCodigo(codigo);
}

/* ===== Movimientos / Render ===== */
function registrarMovimiento({ tipo, productoId, cantidadUnidades, nota }) {
  if (!cantidadUnidades || cantidadUnidades<=0) return;
  const mov = {
    id: crypto.randomUUID(), fecha: new Date().toISOString(),
    tipo, productoId, cantidadUnidades, nota: nota||""
  };
  STATE.movimientos.push(mov);
  guardarEstado(STATE);
  renderMovs();
}
function renderMovs(limit=30){
  const tbody = document.querySelector("#tablaMovs tbody");
  if(!tbody) return;
  tbody.innerHTML = "";
  const ultimos = [...STATE.movimientos].reverse().slice(0,limit);
  for(const m of ultimos){
    const prod = getProducto(m.productoId);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(m.fecha).toLocaleTimeString()}</td>
      <td>${prod?prod.nombre:m.productoId}</td>
      <td>${m.cantidadUnidades}</td>
      <td>${m.nota||""}</td>
    `;
    tbody.appendChild(tr);
  }
}

/* ===== Ingreso ===== */
function procesarIngreso(codeOverride=null){
  if(!cooldownOk()) return;
  const code = (codeOverride ?? document.getElementById("scanInput").value.trim());
  if(!code) return;
  let prod = asegurarProductoParaCodigoUnidad(code);
  if(!prod){ beep(false); return; }

  const modo = [...document.querySelectorAll('input[name="modoIngreso"]')].find(r=>r.checked)?.value || "unidad";
  if(modo==="unidad"){
    registrarMovimiento({ tipo:"entrada", productoId: prod.id, cantidadUnidades:1, nota:"Ingreso unitario (scanner)" });
    document.getElementById("scanInput").value = "";
    const c = document.getElementById("contadorSesion");
    c.value = String((parseInt(c.value,10)||0)+1);
    beep(true);
    return;
  }

  // Lote
  let cantidad = Math.max(1, parseInt(document.getElementById("cantidadLote").value,10) || 1);
  const ok = confirm(`Detecté "${prod.nombre}". ¿Agregar ${cantidad} unidades?`);
  if(!ok){
    const editar = confirm("¿Editar cantidad?");
    if(editar){
      const nueva = parseInt(prompt("Nueva cantidad:", String(cantidad)),10);
      if(!isNaN(nueva) && nueva>0) cantidad = nueva; else { beep(false); return; }
    } else { beep(false); return; }
  }
  registrarMovimiento({ tipo:"entrada", productoId: prod.id, cantidadUnidades:cantidad, nota:`Ingreso por lote (x${cantidad}) — scanner` });
  document.getElementById("scanInput").value = "";
  const c = document.getElementById("contadorSesion");
  c.value = String((parseInt(c.value,10)||0)+cantidad);
  beep(true);
}

/* ===== Cámara (ZXing) ===== */
async function listarCamaras(selectEl){
  try{
    const devices = await BrowserMultiFormatReader.listVideoInputDevices();
    selectEl.innerHTML = "";
    devices.forEach((d,i)=>{
      const opt = document.createElement("option");
      opt.value = d.deviceId; opt.textContent = d.label || `Cámara ${i+1}`;
      selectEl.appendChild(opt);
    });
    return devices;
  }catch(e){
    selectEl.innerHTML = "<option value=''>No disponible</option>";
    return [];
  }
}
async function startCamera(){
  const video = document.getElementById("video");
  const select = document.getElementById("camSelect");
  const status = document.getElementById("camStatus");
  const deviceId = select.value || undefined;

  stopCamera();
  try{
    await zxing.decodeFromVideoDevice(deviceId, video, (result, err)=>{
      if(result){
        status.textContent = `✅ ${result.getText()}`;
        procesarIngreso(result.getText());
      } else if (err && !(err instanceof NotFoundException)) {
        status.textContent = "⚠️ Error leyendo";
      }
    });
    const stream = video.srcObject;
    currentTrack = stream?.getVideoTracks?.()[0] || null;
    status.textContent = "Cámara activa";
  }catch(e){
    status.textContent = "❌ No se pudo iniciar cámara";
    console.error(e);
  }
}
function stopCamera(){
  try{ zxing.reset(); }catch{}
  try{
    const video = document.getElementById("video");
    const stream = video?.srcObject;
    stream?.getTracks?.().forEach(t=>t.stop());
    video.srcObject = null;
  }catch{}
  currentTrack = null;
  document.getElementById("camStatus").textContent = "Cámara inactiva";
}
async function toggleTorch(){
  if(!currentTrack) return;
  const caps = currentTrack.getCapabilities?.();
  if(!caps || !caps.torch) return alert("Linterna no soportada por este dispositivo/navegador.");
  const settings = currentTrack.getSettings?.();
  const torchOn = !settings.torch;
  await currentTrack.applyConstraints({ advanced: [{ torch: torchOn }] });
}

/* ===== Listeners ===== */
function wire(){
  document.getElementById("scanInput").addEventListener("keydown",(e)=>{ if(e.key==="Enter") procesarIngreso(); });
  document.getElementById("camStart").addEventListener("click", startCamera);
  document.getElementById("camStop").addEventListener("click", stopCamera);
  document.getElementById("camTorch").addEventListener("click", toggleTorch);
  document.getElementById("camSelect").addEventListener("change", ()=>{ if(document.getElementById("video").srcObject) startCamera(); });
  document.querySelectorAll('input[name="modoIngreso"]').forEach(r=>{
    r.addEventListener("change", ()=>{
      const isLote = [...document.querySelectorAll('input[name="modoIngreso"]')].find(x=>x.checked)?.value==="lote";
      document.getElementById("fieldCantidadLote").style.display = isLote ? "block":"none";
    });
  });
  document.addEventListener("keydown",(e)=>{
    if(e.key.toLowerCase()==="l"){
      const current = [...document.querySelectorAll('input[name="modoIngreso"]')].find(x=>x.checked);
      const nextVal = current.value==="unidad" ? "lote" : "unidad";
      [...document.querySelectorAll('input[name="modoIngreso"]')].forEach(x=>x.checked=(x.value===nextVal));
      const isLote = nextVal==="lote";
      document.getElementById("fieldCantidadLote").style.display = isLote ? "block":"none";
    }
  });
  document.getElementById("btnResetLocal").addEventListener("click", ()=>{
    if(confirm("Esto borrará los datos locales de este dispositivo. ¿Continuar?")){
      localStorage.removeItem(LS_KEY); location.reload();
    }
  });
}

/* ===== Init ===== */
async function init(){
  renderMovs();
  wire();
  await listarCamaras(document.getElementById("camSelect"));
}
document.addEventListener("DOMContentLoaded", init);
