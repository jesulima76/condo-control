// ==========================================================================
// CondoControl - Gestión de Cobranzas, Tasa BCV & Notas/Protocolos
// ==========================================================================

const firebaseConfig = {
  apiKey: "AIzaSyBLWrf7c-FL7C2xDWERzjnCiRmUX_6flVc",
  authDomain: "condominio-cobranzas.firebaseapp.com",
  projectId: "condominio-cobranzas",
  storageBucket: "condominio-cobranzas.firebasestorage.app",
  messagingSenderId: "980591655193",
  appId: "1:980591655193:web:8d8df30e733497ba6fad88"
};

let db = null;
let storage = null;

try {
  if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    storage = firebase.storage();
  }
} catch (e) {
  console.warn("Error inicializando Firebase:", e);
}

// Estado de la Aplicación
let jornadasList = [];
let jornadaActiva = null;
let apartamentosList = [];
let tasasHistorial = {};
let notasList = [];
let unsubscribeJornada = null;
let tasaBCVHoy = 911.62;
let adjuntoNotaModalActual = "";
let adjuntoNotaTipoActual = "";
let adjuntoNotaNombreActual = "";
let chartModeActual = "tasa";

const APARTAMENTOS_INICIALES = [
  { id: "07-11", numero: "07-11", propietario: "LUIS F. MARQUEZ", telefono: "", email: "" },
  { id: "07-12", numero: "07-12", propietario: "WILLIAM J. ESCOBAR", telefono: "", email: "" },
  { id: "07-13", numero: "07-13", propietario: "ELIZABETH NIÑO PAIVA", telefono: "", email: "" },
  { id: "07-21", numero: "07-21", propietario: "EDGAR N. PETIT", telefono: "", email: "" },
  { id: "07-22", numero: "07-22", propietario: "EDUARDO R. VERA M.", telefono: "", email: "" },
  { id: "07-24", numero: "07-24", propietario: "JESUS M. LIMA L.", telefono: "", email: "" },
  { id: "07-31", numero: "07-31", propietario: "JUANA FRANCISCA ROJAS", telefono: "", email: "" },
  { id: "07-32", numero: "07-32", propietario: "LUIS A. NATERA", telefono: "", email: "" },
  { id: "07-33", numero: "07-33", propietario: "JAVIER CORDERO", telefono: "", email: "" },
  { id: "07-34", numero: "07-34", propietario: "EMILIO PRECIADO I.", telefono: "", email: "" },
  { id: "07-41", numero: "07-41", propietario: "VERONICA Y. FAGUNDEZ", telefono: "", email: "" },
  { id: "07-42", numero: "07-42", propietario: "FRANK R. ROJAS E.", telefono: "", email: "" },
  { id: "07-43", numero: "07-43", propietario: "ALBA COLINA", telefono: "", email: "" },
];

const NOTAS_INICIALES = [
  {
    id: "nota_protocolo_bombas",
    fecha: "2026-11-10",
    categoria: "Protocolo",
    asunto: "Protocolo de Encendido y Apagado de Bombas de Agua",
    descripcion: "Horario acordado en asamblea: Encendido de 6:00 AM a 8:30 AM y de 6:00 PM a 9:00 PM. No dejar bombas activas si la presión baja de 20 PSI.",
    adjuntoUrl: "",
    adjuntoTipo: "",
    adjuntoNombre: "",
    createdAt: new Date().toISOString()
  },
  {
    id: "nota_cuota_limpieza",
    fecha: "2026-11-09",
    categoria: "Acuerdo",
    asunto: "Acuerdo Cuota Extraordinaria Limpieza e Implementos",
    descripcion: "Se aprobó cuota fijada en USD calculada a tasa oficial BCV del día del pago. Los comprobantes deben ser enviados con número de referencia bancaria legible.",
    adjuntoUrl: "",
    adjuntoTipo: "",
    adjuntoNombre: "",
    createdAt: new Date().toISOString()
  }
];

const formatUSD = (num) => `$${(Number(num) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatBS = (num) => `Bs. ${(Number(num) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(mensaje, tipo = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  const colores = tipo === "error"
    ? "bg-rose-600 text-white border-rose-700"
    : tipo === "info"
      ? "bg-white text-slate-800 border-slate-200"
      : "bg-[#0B2247] text-white border-blue-900";

  toast.className = `pointer-events-auto px-4 py-3 rounded-2xl shadow-lg border text-xs sm:text-sm font-bold flex items-center gap-2.5 transition-all duration-200 ${colores}`;
  toast.innerHTML = `
    <span class="w-2 h-2 rounded-full ${tipo === 'error' ? 'bg-white' : tipo === 'info' ? 'bg-blue-600' : 'bg-emerald-400'}"></span>
    <span>${escapeHtml(mensaje)}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 220);
  }, 3400);
}

window.toggleSidebar = function(open) {
  const sidebar = document.getElementById("mobile-sidebar");
  const backdrop = document.getElementById("mobile-backdrop");
  if (!sidebar || !backdrop) return;
  if (open) {
    sidebar.classList.remove("-translate-x-full");
    backdrop.classList.remove("hidden");
  } else {
    sidebar.classList.add("-translate-x-full");
    backdrop.classList.add("hidden");
  }
};

// ==========================================
// 1. OBTENCIÓN AUTOMÁTICA DE TASA BCV
// ==========================================
async function fetchTasaBCV(manual = false) {
  const headerTasaEl = document.getElementById("header-bcv-rate");
  const statusEl = document.getElementById("header-bcv-status");
  const iconRefresh = document.getElementById("icon-refresh-bcv");
  const bottomSyncEl = document.getElementById("bottom-bcv-sync");

  if (iconRefresh) iconRefresh.classList.add("animate-spin");
  if (statusEl) statusEl.textContent = "Consultando BCV en vivo...";

  let promedio = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("https://ve.dolarapi.com/v1/dolares/oficial", { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data && data.promedio) promedio = Number(data.promedio);
    }
  } catch (err) {
    console.warn("Intento 1 con DolarAPI falló:", err);
  }

  if (!promedio) {
    try {
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), 7000);
      const res2 = await fetch("https://ve.dolarapi.com/v1/dolares", { signal: controller2.signal });
      clearTimeout(timer2);
      if (res2.ok) {
        const arr = await res2.json();
        if (Array.isArray(arr)) {
          const itemOficial = arr.find(x => x.fuente === "oficial");
          if (itemOficial && itemOficial.promedio) promedio = Number(itemOficial.promedio);
        }
      }
    } catch (err2) {
      console.warn("Intento 2 con DolarAPI falló:", err2);
    }
  }

  const hoyTexto = new Date().toLocaleDateString('es-VE');
  const horaActual = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

  if (promedio && !isNaN(promedio) && promedio > 0) {
    tasaBCVHoy = promedio;
    if (headerTasaEl) headerTasaEl.innerText = `${tasaBCVHoy.toFixed(2)} Bs./$`;
    if (statusEl) statusEl.textContent = `Oficial BCV · ${horaActual}`;
    if (bottomSyncEl) bottomSyncEl.textContent = `${hoyTexto} · ${horaActual}`;

    const fechaHoy = new Date().toISOString().split('T')[0];
    guardarTasaEnMemoriaYFirebase(fechaHoy, tasaBCVHoy, "API Oficial BCV");

    if (jornadaActiva) renderJornadaActiva();
    if (manual) showToast(`Tasa BCV actualizada: ${tasaBCVHoy.toFixed(2)} Bs./$`, "success");
  } else {
    if (headerTasaEl) headerTasaEl.innerText = `${tasaBCVHoy.toFixed(2)} Bs./$`;
    if (statusEl) statusEl.textContent = "Última tasa registrada · Offline";
    if (bottomSyncEl) bottomSyncEl.textContent = `${hoyTexto} · Modo Offline`;
    if (manual) showToast("Sin conexión BCV. Se mantiene la última tasa registrada.", "info");
  }

  if (iconRefresh) iconRefresh.classList.remove("animate-spin");
}

async function guardarTasaEnMemoriaYFirebase(fecha, valor, origen = "Manual") {
  tasasHistorial[fecha] = Number(valor);
  renderHistorialTasas();
  if (jornadaActiva) renderGraficosJornada();

  if (db) {
    try {
      await db.collection("tasas_bcv").doc(fecha).set({
        fecha: fecha,
        tasa: Number(valor),
        origen: origen,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (e) {
      console.warn("No se pudo guardar tasa en Firestore:", e);
    }
  }
}

// ==========================================
// 2. INICIALIZACIÓN Y CARGA DE DATOS
// ==========================================
function initApp() {
  if (typeof lucide !== 'undefined') {
    try { lucide.createIcons(); } catch (e) {}
  }

  apartamentosList = [...APARTAMENTOS_INICIALES];
  renderDirectorioApartamentos();

  const jornadaLocalInicial = {
    id: "jornada_bolsas_basura_nov_2026",
    nombre: "Bolsas de Basura y Limpieza",
    montoFactura: 55.00,
    numAptos: 13,
    margenProteccion: 6.2,
    cuotaCobradaPorApto: 4.50,
    tasaCierreProyectada: 911.62,
    fechaInicio: "2026-11-09",
    fechaFin: "2026-11-16",
    pagos: {
      "07-11": {
        aptoId: "07-11",
        numero: "07-11",
        propietario: "LUIS F. MARQUEZ",
        fechaPago: "2026-11-09",
        tasaBCV: 897.54,
        montoFijadoUSD: 4.50,
        montoPagadoBS: 4038.93,
        equivalenteUSDReal: 4.50,
        estadoPago: "PAGADO",
        metodoRef: "Pago móvil / 957570410",
        comprobanteUrl: ""
      }
    }
  };

  tasasHistorial["2026-11-04"] = 884.10;
  tasasHistorial["2026-11-06"] = 891.25;
  tasasHistorial["2026-11-09"] = 897.54;
  tasasHistorial["2026-11-11"] = 904.80;
  tasasHistorial["2026-11-13"] = 911.62;
  renderHistorialTasas();

  jornadasList = [jornadaLocalInicial];
  jornadaActiva = jornadaLocalInicial;
  actualizarSelectorJornadas();
  renderJornadaActiva();

  try {
    const notasGuardadas = localStorage.getItem("condo_notas_protocolos");
    notasList = notasGuardadas ? JSON.parse(notasGuardadas) : [...NOTAS_INICIALES];
  } catch (errNotas) {
    notasList = [...NOTAS_INICIALES];
  }
  renderNotas();

  fetchTasaBCV(false);
  setInterval(() => fetchTasaBCV(false), 10 * 60 * 1000);

  const fbStatusEl = document.getElementById("bottom-firebase-status");

  if (db) {
    try {
      db.collection("apartamentos").onSnapshot((snapshot) => {
        if (!snapshot.empty) {
          apartamentosList = [];
          snapshot.forEach(docSnap => apartamentosList.push({ id: docSnap.id, ...docSnap.data() }));
          apartamentosList.sort((a, b) => a.numero.localeCompare(b.numero, undefined, { numeric: true }));
          renderDirectorioApartamentos();
          if (jornadaActiva) renderJornadaActiva();
        } else {
          APARTAMENTOS_INICIALES.forEach(apt => {
            db.collection("apartamentos").doc(apt.id).set(apt).catch(() => {});
          });
        }
        if (fbStatusEl) fbStatusEl.textContent = "Sincronizado en vivo";
      }, (err) => console.warn("Firestore apartamentos:", err));

      db.collection("tasas_bcv").onSnapshot((snapshot) => {
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          if (data && data.fecha && data.tasa) tasasHistorial[data.fecha] = data.tasa;
        });
        renderHistorialTasas();
        if (jornadaActiva) renderGraficosJornada();
      }, (err) => console.warn("Firestore tasas:", err));

      db.collection("jornadas").onSnapshot((snapshot) => {
        if (!snapshot.empty) {
          jornadasList = [];
          snapshot.forEach(docSnap => jornadasList.push({ id: docSnap.id, ...docSnap.data() }));
          jornadasList.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
          actualizarSelectorJornadas();
        } else {
          db.collection("jornadas").doc(jornadaLocalInicial.id).set(jornadaLocalInicial).catch(() => {});
        }
      }, (err) => console.warn("Firestore jornadas:", err));

      db.collection("notas_protocolos").onSnapshot((snapshot) => {
        if (!snapshot.empty) {
          notasList = [];
          snapshot.forEach(docSnap => notasList.push({ id: docSnap.id, ...docSnap.data() }));
          notasList.sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
          try { localStorage.setItem("condo_notas_protocolos", JSON.stringify(notasList)); } catch (e) {}
          renderNotas();
        }
      }, (err) => console.warn("Firestore notas:", err));
    } catch (errDb) {
      console.warn("Error iniciando listeners de Firestore:", errDb);
      if (fbStatusEl) fbStatusEl.textContent = "Respaldo local activo";
    }
  } else if (fbStatusEl) {
    fbStatusEl.textContent = "Modo local activo";
  }

  const btnRefresh = document.getElementById("btn-refresh-rate");
  if (btnRefresh) btnRefresh.onclick = () => fetchTasaBCV(true);

  const selectJornada = document.getElementById("select-jornada");
  if (selectJornada) {
    selectJornada.onchange = (e) => cargarJornadaSeleccionada(e.target.value);
  }
}

window.sincronizarJornadaDesdeSidebar = function(id) {
  cargarJornadaSeleccionada(id);
};

function actualizarSelectorJornadas() {
  const selectMain = document.getElementById("select-jornada");
  const selectSide = document.getElementById("sidebar-select-jornada");

  [selectMain, selectSide].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = "";
    jornadasList.forEach(j => {
      const opt = document.createElement("option");
      opt.value = j.id;
      opt.className = sel === selectSide ? "bg-[#071631] text-white" : "text-slate-900";
      opt.textContent = `${j.nombre} (${formatUSD(j.cuotaCobradaPorApto)})`;
      sel.appendChild(opt);
    });
  });

  if (jornadasList.length > 0) {
    const idTarget = (!jornadaActiva || !jornadasList.find(x => x.id === jornadaActiva.id))
      ? jornadasList[0].id
      : jornadaActiva.id;
    cargarJornadaSeleccionada(idTarget);
  }
}

function cargarJornadaSeleccionada(id) {
  if (unsubscribeJornada) unsubscribeJornada();

  const j = jornadasList.find(x => x.id === id);
  if (j) {
    jornadaActiva = j;
    const selectMain = document.getElementById("select-jornada");
    const selectSide = document.getElementById("sidebar-select-jornada");
    if (selectMain) selectMain.value = id;
    if (selectSide) selectSide.value = id;
    renderJornadaActiva();
  }

  if (db) {
    unsubscribeJornada = db.collection("jornadas").doc(id).onSnapshot((docSnap) => {
      if (docSnap.exists) {
        jornadaActiva = { id: docSnap.id, ...docSnap.data() };
        const selectMain = document.getElementById("select-jornada");
        const selectSide = document.getElementById("sidebar-select-jornada");
        if (selectMain) selectMain.value = id;
        if (selectSide) selectSide.value = id;
        renderJornadaActiva();
      }
    });
  }
}

// ==========================================
// 3. RENDERIZADO, GRÁFICOS Y FILTROS
// ==========================================
window.filtrarTablaPagos = function() {
  renderJornadaActiva();
};

window.limpiarFiltrosPagos = function() {
  const txt = document.getElementById("filtro-pagos-texto");
  const est = document.getElementById("filtro-pagos-estado");
  if (txt) txt.value = "";
  if (est) est.value = "TODOS";
  renderJornadaActiva();
};

window.setChartMode = function(mode) {
  chartModeActual = mode;
  const btnTasa = document.getElementById("btn-chart-tasa");
  const btnPagos = document.getElementById("btn-chart-pagos");
  const titulo = document.getElementById("chart-evolucion-titulo");

  if (mode === "tasa") {
    if (titulo) titulo.textContent = "Evolución de Tasa Oficial BCV";
    if (btnTasa) btnTasa.className = "px-3 py-1 rounded-full transition bg-white text-[#0B2755]";
    if (btnPagos) btnPagos.className = "px-3 py-1 rounded-full transition text-white/85 hover:text-white";
  } else {
    if (titulo) titulo.textContent = "Avance de Solvencia Torre 7";
    if (btnPagos) btnPagos.className = "px-3 py-1 rounded-full transition bg-white text-[#0B2755]";
    if (btnTasa) btnTasa.className = "px-3 py-1 rounded-full transition text-white/85 hover:text-white";
  }
  renderGraficosJornada();
};

function renderJornadaActiva() {
  if (!jornadaActiva) return;

  const pagos = jornadaActiva.pagos || {};
  const aptos = apartamentosList.length > 0 ? apartamentosList : APARTAMENTOS_INICIALES;

  const textoFiltro = (document.getElementById("filtro-pagos-texto")?.value || "").toLowerCase().trim();
  const estadoFiltro = document.getElementById("filtro-pagos-estado")?.value || "TODOS";

  let totalFijadoUSD = 0;
  let totalRecaudadoBS = 0;
  let totalRealUSD = 0;
  let aptosPagados = 0;
  let filasVisibles = 0;

  const tbody = document.getElementById("tabla-pagos-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  aptos.forEach(apt => {
    const p = pagos[apt.id] || {
      aptoId: apt.id,
      numero: apt.numero,
      propietario: apt.propietario,
      fechaPago: "",
      tasaBCV: 0,
      montoFijadoUSD: jornadaActiva.cuotaCobradaPorApto || 0,
      montoPagadoBS: 0,
      equivalenteUSDReal: 0,
      estadoPago: "PENDIENTE",
      metodoRef: "",
      comprobanteUrl: ""
    };

    const montoFijadoVigente = (p.estadoPago === "PAGADO" && p.montoFijadoUSD)
      ? Number(p.montoFijadoUSD)
      : Number(jornadaActiva.cuotaCobradaPorApto || 0);

    totalFijadoUSD += montoFijadoVigente;

    const isPagado = p.estadoPago === "PAGADO";
    if (isPagado) {
      aptosPagados++;
      totalRecaudadoBS += Number(p.montoPagadoBS || 0);
      totalRealUSD += Number(p.equivalenteUSDReal || 0);
    }

    const coincideTexto = !textoFiltro ||
      apt.numero.toLowerCase().includes(textoFiltro) ||
      apt.propietario.toLowerCase().includes(textoFiltro) ||
      (p.metodoRef || "").toLowerCase().includes(textoFiltro);
    const coincideEstado = estadoFiltro === "TODOS" || p.estadoPago === estadoFiltro;

    if (!coincideTexto || !coincideEstado) return;
    filasVisibles++;

    const tr = document.createElement("tr");
    tr.className = "hover:bg-blue-50/45 transition-colors cursor-pointer group border-b border-slate-100";
    tr.onclick = () => openModalPago(apt.id);

    tr.innerHTML = `
      <td class="py-3 px-4 font-mono">
        <span class="inline-block bg-indigo-50 text-indigo-800 group-hover:bg-blue-100 font-extrabold px-2.5 py-1 rounded-lg text-xs tabular-nums transition-colors">
          ${escapeHtml(apt.numero)}
        </span>
      </td>
      <td class="py-3 px-4 font-bold text-slate-800 text-xs sm:text-sm whitespace-nowrap">${escapeHtml(apt.propietario)}</td>
      <td class="py-3 px-4 text-slate-600 font-mono text-xs tabular-nums whitespace-nowrap">${p.fechaPago || '—'}</td>
      <td class="py-3 px-4 text-right font-mono text-xs font-semibold text-slate-600 tabular-nums">${p.tasaBCV ? Number(p.tasaBCV).toFixed(2) : '—'}</td>
      <td class="py-3 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">${formatUSD(montoFijadoVigente)}</td>
      <td class="py-3 px-4 text-right font-extrabold font-mono tabular-nums whitespace-nowrap ${p.montoPagadoBS > 0 ? 'text-emerald-700' : 'text-slate-300'}">
        ${p.montoPagadoBS > 0 ? formatBS(p.montoPagadoBS) : '—'}
      </td>
      <td class="py-3 px-4 text-right font-extrabold font-mono tabular-nums ${p.equivalenteUSDReal > 0 ? 'text-indigo-700' : 'text-slate-300'}">
        ${p.equivalenteUSDReal > 0 ? formatUSD(p.equivalenteUSDReal) : '—'}
      </td>
      <td class="py-3 px-4 text-center">
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border whitespace-nowrap ${
          isPagado ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
        }">
          <span class="w-1.5 h-1.5 rounded-full ${isPagado ? 'bg-emerald-500' : 'bg-amber-500'}"></span>
          ${isPagado ? 'Pagado' : 'Pendiente'}
        </span>
      </td>
      <td class="py-3 px-4 text-center" onclick="event.stopPropagation()">
        ${p.comprobanteUrl ? `
          <button onclick="verComprobanteGrande('${p.comprobanteUrl}', 'Comprobante Apto ${escapeHtml(apt.numero)}')" class="text-blue-700 hover:text-blue-900 inline-flex items-center gap-1 text-xs font-bold bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-1 rounded-lg transition">
            <i data-lucide="image" class="w-3.5 h-3.5"></i>
            <span>Ver</span>
          </button>
        ` : `
          <button onclick="openModalPago('${apt.id}')" class="text-slate-500 hover:text-blue-700 inline-flex items-center gap-1 text-xs font-semibold bg-slate-50 hover:bg-blue-50 px-2.5 py-1 rounded-lg transition">
            <i data-lucide="upload" class="w-3.5 h-3.5"></i>
            <span>Cargar</span>
          </button>
        `}
      </td>
      <td class="py-3 px-4 text-center no-print" onclick="event.stopPropagation()">
        <div class="flex items-center justify-center gap-1.5">
          <button onclick="openModalPago('${apt.id}')" class="w-7 h-7 rounded-full border border-slate-200 text-blue-600 hover:bg-blue-50 flex items-center justify-center transition" title="Editar Pago">
            <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
          </button>
          ${isPagado ? `
            <button onclick="revertirPagoAptoDirecto('${apt.id}')" class="w-7 h-7 rounded-full border border-slate-200 text-rose-600 hover:bg-rose-50 flex items-center justify-center transition" title="Revertir Pago">
              <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>
            </button>
          ` : ''}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (filasVisibles === 0) {
    const emptyTr = document.createElement("tr");
    emptyTr.innerHTML = `
      <td colspan="10" class="py-10 text-center text-xs text-slate-500">
        No se encontraron apartamentos con los filtros actuales.
        <button onclick="limpiarFiltrosPagos()" class="text-blue-600 font-bold hover:underline ml-1">Limpiar filtros</button>
      </td>
    `;
    tbody.appendChild(emptyTr);
  }

  // KPIs
  const totalAptos = aptos.length;
  const pct = totalAptos > 0 ? (aptosPagados / totalAptos) * 100 : 0;
  const pendientesCount = totalAptos - aptosPagados;
  const tasaCierre = jornadaActiva.tasaCierreProyectada || tasaBCVHoy || 911.62;
  const superavit = totalRealUSD - (jornadaActiva.montoFactura || 0);

  document.getElementById("stat-presupuesto").textContent = formatUSD(jornadaActiva.montoFactura || 0);
  document.getElementById("stat-cuota-cobrada").textContent = `${formatUSD(jornadaActiva.cuotaCobradaPorApto || 0)} / apto`;
  document.getElementById("stat-recaudado-bs").textContent = formatBS(totalRecaudadoBS);
  document.getElementById("stat-recaudado-usd").textContent = formatUSD(totalRealUSD);
  document.getElementById("stat-tasa-cierre").textContent = `${Number(tasaCierre).toFixed(2)} Bs./$`;

  const elPendientes = document.getElementById("stat-pendientes-resumen");
  if (elPendientes) elPendientes.textContent = `${pendientesCount} pend.`;

  const elSuperavit = document.getElementById("stat-superavit");
  elSuperavit.textContent = `${superavit >= 0 ? '+' : ''}${formatUSD(superavit)}`;
  elSuperavit.className = `font-bold font-mono tabular-nums ${superavit >= 0 ? 'text-emerald-700' : 'text-rose-600'}`;

  document.getElementById("stat-avance-cobro").textContent = `${aptosPagados} / ${totalAptos}`;
  const elPct = document.getElementById("stat-porcentaje-cobrado");
  if (elPct) elPct.textContent = `${pct.toFixed(1)}%`;
  document.getElementById("stat-progreso-barra").style.width = `${pct}%`;

  const badgeUnidades = document.getElementById("badge-unidades-tabla");
  if (badgeUnidades) badgeUnidades.textContent = `· ${totalAptos} Unidades`;

  const bottomAptos = document.getElementById("bottom-aptos-count");
  if (bottomAptos) bottomAptos.textContent = `${totalAptos} Apartamentos`;

  // Totales TFOOT
  const elTotalFijado = document.getElementById("total-fijado-usd");
  if (elTotalFijado) elTotalFijado.textContent = formatUSD(totalFijadoUSD);
  const elTotalPagado = document.getElementById("total-pagado-bs");
  if (elTotalPagado) elTotalPagado.textContent = formatBS(totalRecaudadoBS);
  const elTotalReal = document.getElementById("total-real-usd");
  if (elTotalReal) elTotalReal.textContent = formatUSD(totalRealUSD);

  // Gráficos SVG
  renderGraficosJornada({
    pct,
    totalRecaudadoBS,
    totalFijadoUSD,
    totalRealUSD,
    tasaCierre
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function renderGraficosJornada(resumen = null) {
  if (!jornadaActiva) return;

  // Si se llama sin resumen (ej. cambio de tab de gráfico), recalculamos
  let data = resumen;
  if (!data) {
    const pagos = jornadaActiva.pagos || {};
    const aptos = apartamentosList.length > 0 ? apartamentosList : APARTAMENTOS_INICIALES;
    let totalFijadoUSD = 0, totalRecaudadoBS = 0, totalRealUSD = 0, aptosPagados = 0;
    aptos.forEach(apt => {
      const p = pagos[apt.id];
      const fijado = (p && p.estadoPago === "PAGADO" && p.montoFijadoUSD) ? Number(p.montoFijadoUSD) : Number(jornadaActiva.cuotaCobradaPorApto || 0);
      totalFijadoUSD += fijado;
      if (p && p.estadoPago === "PAGADO") {
        aptosPagados++;
        totalRecaudadoBS += Number(p.montoPagadoBS || 0);
        totalRealUSD += Number(p.equivalenteUSDReal || 0);
      }
    });
    const pct = aptos.length > 0 ? (aptosPagados / aptos.length) * 100 : 0;
    const tasaCierre = jornadaActiva.tasaCierreProyectada || tasaBCVHoy || 911.62;
    data = { pct, totalRecaudadoBS, totalFijadoUSD, totalRealUSD, tasaCierre };
  }

  // 1. Donut Chart
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  const dash = (data.pct / 100) * circ;
  const circle = document.getElementById("donut-progress-circle");
  if (circle) circle.setAttribute("stroke-dasharray", `${dash.toFixed(2)} ${circ.toFixed(2)}`);

  const lblPct = document.getElementById("donut-pct-label");
  if (lblPct) lblPct.textContent = `${data.pct.toFixed(1)}%`;

  const metaBS = data.totalFijadoUSD * data.tasaCierre;
  const pendienteBS = Math.max(0, (data.totalFijadoUSD - data.totalRealUSD) * data.tasaCierre);

  const elDonutPag = document.getElementById("donut-pagados-bs");
  if (elDonutPag) elDonutPag.textContent = formatBS(data.totalRecaudadoBS);
  const elDonutPend = document.getElementById("donut-pendientes-bs");
  if (elDonutPend) elDonutPend.textContent = formatBS(pendienteBS);
  const elDonutMeta = document.getElementById("donut-meta-bs");
  if (elDonutMeta) elDonutMeta.textContent = formatBS(metaBS);

  // 2. Evolución Chart (SVG)
  const svg = document.getElementById("chart-evolucion-svg");
  if (!svg) return;

  const width = 460, height = 165, padX = 34, padTop = 28, padBottom = 28;
  const raw = chartModeActual === "tasa"
    ? Object.entries(tasasHistorial)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-7)
        .map(([f, v]) => ({ label: f.slice(5), value: Number(v), display: Number(v).toFixed(1) }))
    : [
        { label: "Inicio", value: 0, display: "0%" },
        { label: "Actual", value: Math.round(data.pct), display: `${Math.round(data.pct)}%` }
      ];

  if (raw.length === 0) {
    svg.innerHTML = "";
    return;
  }

  const vals = raw.map(d => d.value);
  const minV = Math.min(...vals);
  const maxV = Math.max(...vals);
  const range = (maxV - minV) || 10;
  const low = minV - range * 0.25;
  const high = maxV + range * 0.2;
  const usableW = width - padX * 2;
  const usableH = height - padTop - padBottom;

  const pts = raw.map((d, i) => {
    const x = raw.length === 1 ? width / 2 : padX + (i / (raw.length - 1)) * usableW;
    const y = padTop + usableH - ((d.value - low) / (high - low)) * usableH;
    return { ...d, x, y };
  });

  const polyline = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `M ${pts[0].x.toFixed(1)},${(height - padBottom).toFixed(1)} ` +
    pts.map(p => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") +
    ` L ${pts[pts.length - 1].x.toFixed(1)},${(height - padBottom).toFixed(1)} Z`;

  const gridLines = [30, 65, 100, 135]
    .map(y => `<line x1="24" y1="${y}" x2="${width - 16}" y2="${y}" stroke="#E2E8F0" stroke-dasharray="3 3" stroke-width="1"/>`)
    .join("");

  const nodes = pts.map((pt, idx) => {
    const isLast = idx === pts.length - 1;
    const labelBadge = isLast
      ? `<g transform="translate(${pt.x.toFixed(1)}, ${(pt.y - 22).toFixed(1)})">
           <rect x="-26" y="-9" width="52" height="18" rx="9" fill="#16A34A"/>
           <text text-anchor="middle" y="3.5" fill="#FFFFFF" font-size="10" font-weight="700" font-family="JetBrains Mono, monospace">${pt.display}</text>
         </g>`
      : `<text x="${pt.x.toFixed(1)}" y="${(pt.y - 10).toFixed(1)}" text-anchor="middle" fill="#334155" font-size="10" font-weight="700" font-family="JetBrains Mono, monospace">${pt.display}</text>`;

    return `
      <g>
        <circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="${isLast ? 5.5 : 4}" fill="${isLast ? '#16A34A' : '#1D63ED'}" stroke="#FFFFFF" stroke-width="2"/>
        ${labelBadge}
        <text x="${pt.x.toFixed(1)}" y="${height - 6}" text-anchor="middle" fill="#64748B" font-size="10" font-weight="600">${pt.label}</text>
      </g>
    `;
  }).join("");

  svg.innerHTML = `
    <defs>
      <linearGradient id="areaBlueGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1D63ED" stop-opacity="0.24"/>
        <stop offset="100%" stop-color="#1D63ED" stop-opacity="0.02"/>
      </linearGradient>
    </defs>
    ${gridLines}
    <path d="${area}" fill="url(#areaBlueGrad)"/>
    <polyline fill="none" stroke="#1D63ED" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" points="${polyline}"/>
    ${nodes}
  `;
}

// ==========================================
// 4. MODAL DE REGISTRO DE PAGO
// ==========================================
window.openModalPagoRapido = function() {
  if (!jornadaActiva) return;
  const pagos = jornadaActiva.pagos || {};
  const aptos = apartamentosList.length > 0 ? apartamentosList : APARTAMENTOS_INICIALES;
  const pendiente = aptos.find(a => (pagos[a.id]?.estadoPago || "PENDIENTE") === "PENDIENTE");
  const target = pendiente ? pendiente.id : aptos[0]?.id;
  if (target) openModalPago(target);
};

window.openModalPago = function(aptoId) {
  if (!jornadaActiva) return;

  const apto = apartamentosList.find(a => a.id === aptoId) || APARTAMENTOS_INICIALES.find(a => a.id === aptoId);
  const pagos = jornadaActiva.pagos || {};
  const pago = pagos[aptoId] || {};

  document.getElementById("pago-apto-id").value = aptoId;
  document.getElementById("modal-pago-titulo").textContent = `Registrar Pago - Apto ${apto.numero}`;
  document.getElementById("modal-pago-subtitulo").textContent = apto.propietario;

  const montoCuota = jornadaActiva.cuotaCobradaPorApto || 4.5;
  document.getElementById("pago-monto-usd").value = montoCuota;

  const fechaHoy = new Date().toISOString().split('T')[0];
  const fechaPago = pago.fechaPago || fechaHoy;
  document.getElementById("pago-fecha").value = fechaPago;

  const tasaFecha = pago.tasaBCV || tasasHistorial[fechaPago] || tasaBCVHoy || 911.62;
  document.getElementById("pago-tasa-bcv").value = Number(tasaFecha).toFixed(2);

  document.getElementById("pago-estado").value = pago.estadoPago || "PENDIENTE";
  document.getElementById("pago-referencia").value = pago.metodoRef || "";

  if (pago.montoPagadoBS) {
    document.getElementById("pago-monto-bs").value = pago.montoPagadoBS;
    document.getElementById("pago-real-usd").value = pago.equivalenteUSDReal || montoCuota;
  } else {
    const sugeridoBS = Number((montoCuota * tasaFecha).toFixed(2));
    document.getElementById("pago-monto-bs").value = sugeridoBS;
    document.getElementById("pago-real-usd").value = montoCuota;
  }

  const uploadPrompt = document.getElementById("comprobante-upload-prompt");
  const previewBox = document.getElementById("comprobante-preview-box");
  const linkBox = document.getElementById("comprobante-actual-link");
  const btnVerComp = document.getElementById("link-ver-comprobante");
  const fileInput = document.getElementById("pago-comprobante-file");
  fileInput.value = "";

  if (pago.comprobanteUrl) {
    linkBox.classList.remove("hidden");
    if (btnVerComp) {
      btnVerComp.onclick = () => verComprobanteGrande(pago.comprobanteUrl, `Comprobante Apto ${apto.numero}`);
    }
  } else {
    linkBox.classList.add("hidden");
  }

  uploadPrompt.classList.remove("hidden");
  previewBox.classList.add("hidden");

  const btnRevertir = document.getElementById("btn-revertir-pago");
  if (btnRevertir) {
    if (pago.estadoPago === "PAGADO") btnRevertir.classList.remove("hidden");
    else btnRevertir.classList.add("hidden");
  }

  document.getElementById("modal-pago").classList.remove("hidden");
  if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.revertirPagoActual = function() {
  const aptoId = document.getElementById("pago-apto-id").value;
  revertirPagoAptoDirecto(aptoId);
  closeModalPago();
};

window.revertirPagoAptoDirecto = function(aptoId) {
  const apto = apartamentosList.find(a => a.id === aptoId) || APARTAMENTOS_INICIALES.find(a => a.id === aptoId);
  const nombreApto = apto ? apto.numero : aptoId;

  const confirmar = confirm(`¿Estás seguro de REVERTIR el pago del Apartamento ${nombreApto}?\n\nEl pago volverá a estar PENDIENTE y se descontará del total recaudado.`);
  if (!confirmar) return;

  const cuotaCobrada = jornadaActiva.cuotaCobradaPorApto || 4.5;
  const pagoRevertido = {
    aptoId: aptoId,
    fechaPago: "",
    tasaBCV: 0,
    montoFijadoUSD: cuotaCobrada,
    montoPagadoBS: 0,
    equivalenteUSDReal: 0,
    estadoPago: "PENDIENTE",
    metodoRef: "",
    comprobanteUrl: "",
    updatedAt: new Date().toISOString()
  };

  if (!jornadaActiva.pagos) jornadaActiva.pagos = {};
  jornadaActiva.pagos[aptoId] = pagoRevertido;
  renderJornadaActiva();
  showToast(`Pago de Apto ${nombreApto} revertido a Pendiente.`, "info");

  if (db) {
    const updatePath = `pagos.${aptoId}`;
    db.collection("jornadas").doc(jornadaActiva.id).update({
      [updatePath]: pagoRevertido
    }).catch(err => console.warn("Firestore revert error:", err));
  }
};

window.closeModalPago = function() {
  document.getElementById("modal-pago").classList.add("hidden");
};

window.actualizarTasaPorFecha = function() {
  const fecha = document.getElementById("pago-fecha").value;
  if (!fecha) return;
  if (tasasHistorial[fecha]) {
    document.getElementById("pago-tasa-bcv").value = Number(tasasHistorial[fecha]).toFixed(2);
  } else if (tasaBCVHoy) {
    document.getElementById("pago-tasa-bcv").value = Number(tasaBCVHoy).toFixed(2);
  }
  calcularMontoBsSugerido();
};

window.calcularMontoBsSugerido = function() {
  const cuotaUSD = parseFloat(document.getElementById("pago-monto-usd").value) || 0;
  const tasa = parseFloat(document.getElementById("pago-tasa-bcv").value) || 0;
  if (cuotaUSD > 0 && tasa > 0) {
    document.getElementById("pago-monto-bs").value = (cuotaUSD * tasa).toFixed(2);
    document.getElementById("pago-real-usd").value = cuotaUSD.toFixed(2);
  }
};

window.calcularEquivalenteUsdReal = function() {
  const montoBS = parseFloat(document.getElementById("pago-monto-bs").value) || 0;
  const tasa = parseFloat(document.getElementById("pago-tasa-bcv").value) || 0;
  if (tasa > 0) {
    document.getElementById("pago-real-usd").value = (montoBS / tasa).toFixed(2);
  }
};

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

window.previewComprobante = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  document.getElementById("comprobante-upload-prompt").classList.add("hidden");
  const previewBox = document.getElementById("comprobante-preview-box");
  previewBox.classList.remove("hidden");
  document.getElementById("comprobante-file-name").textContent = file.name;

  if (file.type.startsWith("image/")) {
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById("comprobante-preview-img").src = e.target.result;
    };
    reader.readAsDataURL(file);
  } else {
    document.getElementById("comprobante-preview-img").src = "";
  }
};

window.guardarPago = async function(event) {
  event.preventDefault();
  const btn = document.getElementById("btn-guardar-pago");
  btn.disabled = true;
  btn.innerHTML = `<span>Guardando...</span>`;

  try {
    const aptoId = document.getElementById("pago-apto-id").value;
    const fecha = document.getElementById("pago-fecha").value;
    const tasa = parseFloat(document.getElementById("pago-tasa-bcv").value) || 0;
    const montoUSD = parseFloat(document.getElementById("pago-monto-usd").value) || 0;
    const montoBS = parseFloat(document.getElementById("pago-monto-bs").value) || 0;
    const realUSD = parseFloat(document.getElementById("pago-real-usd").value) || 0;
    const estado = document.getElementById("pago-estado").value;
    const referencia = document.getElementById("pago-referencia").value;
    const fileInput = document.getElementById("pago-comprobante-file");

    if (fecha && tasa > 0) guardarTasaEnMemoriaYFirebase(fecha, tasa, "Registro de Pago");

    let comprobanteUrl = jornadaActiva.pagos?.[aptoId]?.comprobanteUrl || "";
    if (fileInput.files.length > 0) {
      try {
        comprobanteUrl = await fileToBase64(fileInput.files[0]);
      } catch (errFile) {
        console.warn("No se pudo leer comprobante:", errFile);
      }
    }

    const payloadPago = {
      aptoId,
      fechaPago: fecha,
      tasaBCV: tasa,
      montoFijadoUSD: montoUSD,
      montoPagadoBS: montoBS,
      equivalenteUSDReal: realUSD,
      estadoPago: estado,
      metodoRef: referencia,
      comprobanteUrl,
      updatedAt: new Date().toISOString()
    };

    if (!jornadaActiva.pagos) jornadaActiva.pagos = {};
    jornadaActiva.pagos[aptoId] = payloadPago;
    renderJornadaActiva();
    closeModalPago();
    showToast(`Pago de Apto ${aptoId} guardado correctamente.`, "success");

    if (db) {
      const updatePath = `pagos.${aptoId}`;
      db.collection("jornadas").doc(jornadaActiva.id).update({
        [updatePath]: payloadPago
      }).catch(err => console.warn("Firestore update:", err));
    }
  } catch (error) {
    console.error("Error al guardar pago:", error);
    showToast("Error al procesar el pago: " + error.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>Guardar Pago</span>`;
  }
};

// ==========================================
// 5. MODAL DE NUEVA / EDITAR JORNADA
// ==========================================
window.openModalNuevaJornada = function() {
  document.getElementById("modal-jornada-titulo").textContent = "Crear Nueva Jornada de Recaudación";
  document.getElementById("jornada-id").value = "";
  document.getElementById("jornada-nombre").value = "";
  document.getElementById("jornada-monto-factura").value = "";
  document.getElementById("jornada-margen").value = "5.0";
  document.getElementById("jornada-cuota-cobrada").value = "";

  const totalAptos = apartamentosList.length > 0 ? apartamentosList.length : APARTAMENTOS_INICIALES.length;
  document.getElementById("jornada-num-aptos").value = totalAptos;

  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById("jornada-fecha-inicio").value = hoy;

  const proxSemana = new Date();
  proxSemana.setDate(proxSemana.getDate() + 7);
  document.getElementById("jornada-fecha-fin").value = proxSemana.toISOString().split('T')[0];

  document.getElementById("modal-jornada").classList.remove("hidden");
};

window.openModalEditarJornada = function() {
  if (!jornadaActiva) return;
  document.getElementById("modal-jornada-titulo").textContent = "Editar Parámetros de la Jornada";
  document.getElementById("jornada-id").value = jornadaActiva.id;
  document.getElementById("jornada-nombre").value = jornadaActiva.nombre || "";
  document.getElementById("jornada-monto-factura").value = jornadaActiva.montoFactura || "";
  document.getElementById("jornada-num-aptos").value = jornadaActiva.numAptos || apartamentosList.length;
  document.getElementById("jornada-margen").value = jornadaActiva.margenProteccion || 5.0;
  document.getElementById("jornada-cuota-cobrada").value = jornadaActiva.cuotaCobradaPorApto || "";
  document.getElementById("jornada-fecha-inicio").value = jornadaActiva.fechaInicio || "";
  document.getElementById("jornada-fecha-fin").value = jornadaActiva.fechaFin || "";
  document.getElementById("modal-jornada").classList.remove("hidden");
};

window.closeModalJornada = function() {
  document.getElementById("modal-jornada").classList.add("hidden");
};

window.recalcularCuotaJornadaModal = function() {
  const factura = parseFloat(document.getElementById("jornada-monto-factura").value) || 0;
  const numAptos = parseInt(document.getElementById("jornada-num-aptos").value, 10) || 13;
  const margen = parseFloat(document.getElementById("jornada-margen").value) || 0;

  if (factura > 0 && numAptos > 0) {
    const conMargen = (factura / numAptos) * (1 + margen / 100);
    document.getElementById("jornada-cuota-cobrada").value = conMargen.toFixed(2);
  }
};

window.guardarJornada = async function(event) {
  event.preventDefault();
  const idExistente = document.getElementById("jornada-id").value;
  const nombre = document.getElementById("jornada-nombre").value;
  const factura = parseFloat(document.getElementById("jornada-monto-factura").value) || 0;
  const numAptos = parseInt(document.getElementById("jornada-num-aptos").value, 10) || 13;
  const margen = parseFloat(document.getElementById("jornada-margen").value) || 0;
  const cuotaCobrada = parseFloat(document.getElementById("jornada-cuota-cobrada").value) || 0;
  const fechaInicio = document.getElementById("jornada-fecha-inicio").value;
  const fechaFin = document.getElementById("jornada-fecha-fin").value;

  try {
    if (idExistente) {
      const pagosActualizados = { ...(jornadaActiva.pagos || {}) };
      const aptos = apartamentosList.length > 0 ? apartamentosList : APARTAMENTOS_INICIALES;

      aptos.forEach(apt => {
        const p = pagosActualizados[apt.id] || {
          aptoId: apt.id,
          numero: apt.numero,
          propietario: apt.propietario,
          fechaPago: "",
          tasaBCV: 0,
          montoPagadoBS: 0,
          equivalenteUSDReal: 0,
          estadoPago: "PENDIENTE",
          metodoRef: "",
          comprobanteUrl: ""
        };
        if (p.estadoPago !== "PAGADO") p.montoFijadoUSD = cuotaCobrada;
        pagosActualizados[apt.id] = p;
      });

      jornadaActiva.nombre = nombre;
      jornadaActiva.montoFactura = factura;
      jornadaActiva.numAptos = numAptos;
      jornadaActiva.margenProteccion = margen;
      jornadaActiva.cuotaCobradaPorApto = cuotaCobrada;
      jornadaActiva.fechaInicio = fechaInicio;
      jornadaActiva.fechaFin = fechaFin;
      jornadaActiva.pagos = pagosActualizados;

      actualizarSelectorJornadas();
      renderJornadaActiva();
      showToast("Parámetros de la jornada actualizados.", "success");

      if (db) {
        db.collection("jornadas").doc(idExistente).update({
          nombre, montoFactura: factura, numAptos, margenProteccion: margen,
          cuotaCobradaPorApto: cuotaCobrada, fechaInicio, fechaFin,
          pagos: pagosActualizados, updatedAt: new Date().toISOString()
        }).catch(e => console.warn(e));
      }
    } else {
      const idNueva = `jornada_${Date.now()}`;
      const aptos = apartamentosList.length > 0 ? apartamentosList : APARTAMENTOS_INICIALES;
      const pagos = {};

      aptos.forEach(apt => {
        pagos[apt.id] = {
          aptoId: apt.id,
          numero: apt.numero,
          propietario: apt.propietario,
          fechaPago: "",
          tasaBCV: 0,
          montoFijadoUSD: cuotaCobrada,
          montoPagadoBS: 0,
          equivalenteUSDReal: 0,
          estadoPago: "PENDIENTE",
          metodoRef: "",
          comprobanteUrl: ""
        };
      });

      const nuevaJornada = {
        id: idNueva,
        nombre,
        montoFactura: factura,
        numAptos,
        margenProteccion: margen,
        cuotaCobradaPorApto: cuotaCobrada,
        tasaCierreProyectada: tasaBCVHoy || 911.62,
        fechaInicio,
        fechaFin,
        pagos,
        createdAt: new Date().toISOString()
      };

      jornadasList.unshift(nuevaJornada);
      jornadaActiva = nuevaJornada;
      actualizarSelectorJornadas();
      renderJornadaActiva();
      showToast("Nueva jornada creada exitosamente.", "success");

      if (db) {
        db.collection("jornadas").doc(idNueva).set(nuevaJornada).catch(e => console.warn(e));
      }
    }
    closeModalJornada();
  } catch (e) {
    console.error("Error guardando jornada:", e);
    showToast("Error al guardar la jornada: " + e.message, "error");
  }
};

// ==========================================
// 6. DIRECTORIO DE APARTAMENTOS
// ==========================================
function renderDirectorioApartamentos() {
  const tbody = document.getElementById("tabla-directorio-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  apartamentosList.forEach(apt => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50 transition";
    tr.innerHTML = `
      <td class="py-3.5 px-5 font-mono font-extrabold text-[#0B2247]">${escapeHtml(apt.numero)}</td>
      <td class="py-3.5 px-5 text-slate-800 font-semibold">${escapeHtml(apt.propietario)}</td>
      <td class="py-3.5 px-5 text-slate-600 font-mono text-xs">${escapeHtml(apt.telefono) || '—'}</td>
      <td class="py-3.5 px-5 text-slate-600 text-xs">${escapeHtml(apt.email) || '—'}</td>
      <td class="py-3.5 px-5 text-center">
        <button onclick="editarApartamento('${apt.id}')" class="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition" title="Editar">
          <i data-lucide="edit-3" class="w-4 h-4"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.openModalNuevoApartamento = function() {
  document.getElementById("modal-apto-titulo").textContent = "Agregar Apartamento";
  document.getElementById("apto-id").value = "";
  document.getElementById("apto-numero").value = "";
  document.getElementById("apto-propietario").value = "";
  document.getElementById("apto-telefono").value = "";
  document.getElementById("apto-email").value = "";
  document.getElementById("modal-apartamento").classList.remove("hidden");
};

window.editarApartamento = function(id) {
  const apt = apartamentosList.find(a => a.id === id);
  if (!apt) return;
  document.getElementById("modal-apto-titulo").textContent = "Editar Apartamento";
  document.getElementById("apto-id").value = apt.id;
  document.getElementById("apto-numero").value = apt.numero;
  document.getElementById("apto-propietario").value = apt.propietario;
  document.getElementById("apto-telefono").value = apt.telefono || "";
  document.getElementById("apto-email").value = apt.email || "";
  document.getElementById("modal-apartamento").classList.remove("hidden");
};

window.closeModalApto = function() {
  document.getElementById("modal-apartamento").classList.add("hidden");
};

window.guardarApartamento = async function(event) {
  event.preventDefault();
  const idExistente = document.getElementById("apto-id").value;
  const numero = document.getElementById("apto-numero").value.trim();
  const propietario = document.getElementById("apto-propietario").value.trim();
  const telefono = document.getElementById("apto-telefono").value.trim();
  const email = document.getElementById("apto-email").value.trim();

  const id = idExistente || numero.replace(/[^a-zA-Z0-9_-]/g, "_");
  const nuevoApto = { id, numero, propietario, telefono, email, updatedAt: new Date().toISOString() };

  const idx = apartamentosList.findIndex(a => a.id === id);
  if (idx >= 0) apartamentosList[idx] = nuevoApto;
  else apartamentosList.push(nuevoApto);

  renderDirectorioApartamentos();
  if (jornadaActiva) renderJornadaActiva();
  showToast(`Apartamento ${numero} guardado.`, "success");

  if (db) {
    db.collection("apartamentos").doc(id).set(nuevoApto, { merge: true }).catch(() => {});
  }
  closeModalApto();
};

// ==========================================
// 7. HISTORIAL DE TASAS
// ==========================================
function renderHistorialTasas() {
  const tbody = document.getElementById("tabla-tasas-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  const fechas = Object.keys(tasasHistorial).sort().reverse();
  fechas.forEach(fecha => {
    const tasa = tasasHistorial[fecha];
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50 transition";
    tr.innerHTML = `
      <td class="py-3.5 px-5 font-mono font-semibold text-slate-800">${fecha}</td>
      <td class="py-3.5 px-5 text-right font-extrabold text-blue-700 font-mono tabular-nums">${Number(tasa).toFixed(2)} Bs./$</td>
      <td class="py-3.5 px-5 text-center text-xs text-slate-500">BCV Oficial</td>
      <td class="py-3.5 px-5 text-center">
        <button onclick="editarTasa('${fecha}', ${tasa})" class="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition">
          <i data-lucide="edit-3" class="w-4 h-4"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.openModalNuevaTasa = function() {
  document.getElementById("tasa-fecha").value = new Date().toISOString().split('T')[0];
  document.getElementById("tasa-valor").value = tasaBCVHoy || "";
  document.getElementById("modal-tasa").classList.remove("hidden");
};

window.closeModalTasa = function() {
  document.getElementById("modal-tasa").classList.add("hidden");
};

window.editarTasa = function(fecha, tasa) {
  document.getElementById("tasa-fecha").value = fecha;
  document.getElementById("tasa-valor").value = tasa;
  document.getElementById("modal-tasa").classList.remove("hidden");
};

window.guardarTasaManual = function(event) {
  event.preventDefault();
  const fecha = document.getElementById("tasa-fecha").value;
  const valor = parseFloat(document.getElementById("tasa-valor").value);
  if (fecha && valor > 0) {
    guardarTasaEnMemoriaYFirebase(fecha, valor, "Ajuste Manual");
    closeModalTasa();
    showToast(`Tasa del ${fecha} guardada (${valor.toFixed(2)} Bs./$).`, "success");
  }
};

// ==========================================
// 8. MÓDULO: NOTAS Y PROTOCOLOS
// ==========================================
function renderNotas(lista = null) {
  const contenedor = document.getElementById("contenedor-notas");
  const vacio = document.getElementById("vacio-notas");
  const badgeTotal = document.getElementById("badge-total-notas");
  const sidebarBadge = document.getElementById("sidebar-badge-notas");
  if (!contenedor) return;

  const items = lista || notasList;
  if (badgeTotal) badgeTotal.textContent = notasList.length;
  if (sidebarBadge) sidebarBadge.textContent = notasList.length;

  if (items.length === 0) {
    contenedor.innerHTML = "";
    if (vacio) vacio.classList.remove("hidden");
    return;
  }

  if (vacio) vacio.classList.add("hidden");
  contenedor.innerHTML = "";

  const coloresCategoria = {
    "Protocolo": { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-200" },
    "Acuerdo": { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
    "Mantenimiento": { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200" },
    "Servicios": { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-200" },
    "General": { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" },
  };

  items.forEach(nota => {
    const estiloCat = coloresCategoria[nota.categoria] || coloresCategoria["General"];
    const esPDF = nota.adjuntoTipo === "application/pdf" || (nota.adjuntoUrl && nota.adjuntoUrl.includes("application/pdf"));

    const card = document.createElement("div");
    card.className = "bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group";

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between gap-2 mb-3">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${estiloCat.bg} ${estiloCat.text} border ${estiloCat.border}">
            ${escapeHtml(nota.categoria || 'General')}
          </span>
          <span class="text-xs font-mono font-semibold text-slate-400">
            ${escapeHtml(nota.fecha || 'Sin fecha')}
          </span>
        </div>

        <h3 class="text-sm font-extrabold text-[#0B2247] group-hover:text-blue-700 transition-colors leading-snug">
          ${escapeHtml(nota.asunto)}
        </h3>

        ${nota.descripcion ? `
          <p class="text-xs text-slate-600 mt-2 line-clamp-3 leading-relaxed whitespace-pre-line">${escapeHtml(nota.descripcion)}</p>
        ` : ''}

        ${nota.adjuntoUrl ? `
          <div class="mt-4 pt-3 border-t border-slate-100">
            <button onclick="verAdjuntoNota('${nota.id}')" class="w-full bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 rounded-xl p-2.5 flex items-center space-x-2.5 transition text-left">
              <div class="w-8 h-8 rounded-lg ${esPDF ? 'bg-rose-100 text-rose-600' : 'bg-blue-100 text-blue-600'} flex items-center justify-center shrink-0">
                <i data-lucide="${esPDF ? 'file-text' : 'image'}" class="w-4 h-4"></i>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-[11px] font-bold text-slate-800 truncate">${escapeHtml(nota.adjuntoNombre || (esPDF ? 'Documento PDF' : 'Captura Adjunta'))}</p>
                <p class="text-[10px] text-blue-600 font-semibold">Clic para ver archivo</p>
              </div>
            </button>
          </div>
        ` : ''}
      </div>

      <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-end space-x-1.5">
        <button onclick="editarNota('${nota.id}')" class="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Editar Nota">
          <i data-lucide="edit-3" class="w-4 h-4"></i>
        </button>
        <button onclick="eliminarNota('${nota.id}')" class="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="Eliminar Nota">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
      </div>
    `;

    contenedor.appendChild(card);
  });

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

window.filtrarNotas = function() {
  const texto = (document.getElementById("filtro-notas")?.value || "").toLowerCase().trim();
  const cat = document.getElementById("filtro-categoria-nota")?.value || "TODAS";

  const filtradas = notasList.filter(n => {
    const coincideTexto = !texto || (n.asunto || "").toLowerCase().includes(texto) || (n.descripcion || "").toLowerCase().includes(texto);
    const coincideCat = cat === "TODAS" || n.categoria === cat;
    return coincideTexto && coincideCat;
  });
  renderNotas(filtradas);
};

window.openModalNuevaNota = function() {
  document.getElementById("modal-nota-titulo").textContent = "Nueva Nota / Protocolo";
  document.getElementById("nota-id").value = "";
  document.getElementById("nota-fecha").value = new Date().toISOString().split('T')[0];
  document.getElementById("nota-categoria").value = "Protocolo";
  document.getElementById("nota-asunto").value = "";
  document.getElementById("nota-descripcion").value = "";

  adjuntoNotaModalActual = "";
  adjuntoNotaTipoActual = "";
  adjuntoNotaNombreActual = "";

  const fileInput = document.getElementById("nota-adjunto-file");
  if (fileInput) fileInput.value = "";

  document.getElementById("nota-upload-prompt").classList.remove("hidden");
  document.getElementById("nota-preview-box").classList.add("hidden");
  document.getElementById("nota-adjunto-actual-link").classList.add("hidden");

  document.getElementById("modal-nota").classList.remove("hidden");
  if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.editarNota = function(id) {
  const nota = notasList.find(n => n.id === id);
  if (!nota) return;

  document.getElementById("modal-nota-titulo").textContent = "Editar Nota / Protocolo";
  document.getElementById("nota-id").value = nota.id;
  document.getElementById("nota-fecha").value = nota.fecha || new Date().toISOString().split('T')[0];
  document.getElementById("nota-categoria").value = nota.categoria || "General";
  document.getElementById("nota-asunto").value = nota.asunto || "";
  document.getElementById("nota-descripcion").value = nota.descripcion || "";

  adjuntoNotaModalActual = nota.adjuntoUrl || "";
  adjuntoNotaTipoActual = nota.adjuntoTipo || "";
  adjuntoNotaNombreActual = nota.adjuntoNombre || "";

  const fileInput = document.getElementById("nota-adjunto-file");
  if (fileInput) fileInput.value = "";

  document.getElementById("nota-upload-prompt").classList.remove("hidden");
  document.getElementById("nota-preview-box").classList.add("hidden");

  const linkBox = document.getElementById("nota-adjunto-actual-link");
  if (adjuntoNotaModalActual) linkBox.classList.remove("hidden");
  else linkBox.classList.add("hidden");

  document.getElementById("modal-nota").classList.remove("hidden");
  if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.closeModalNota = function() {
  document.getElementById("modal-nota").classList.add("hidden");
};

window.previewNotaAdjunto = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  document.getElementById("nota-upload-prompt").classList.add("hidden");
  const previewBox = document.getElementById("nota-preview-box");
  previewBox.classList.remove("hidden");
  document.getElementById("nota-file-name").textContent = file.name;

  const imgEl = document.getElementById("nota-preview-img");
  const docIcon = document.getElementById("nota-preview-doc-icon");

  if (file.type.startsWith("image/")) {
    imgEl.classList.remove("hidden");
    docIcon.classList.add("hidden");
    const reader = new FileReader();
    reader.onload = (e) => { imgEl.src = e.target.result; };
    reader.readAsDataURL(file);
  } else {
    imgEl.classList.add("hidden");
    docIcon.classList.remove("hidden");
  }
};

window.verAdjuntoNotaModal = function() {
  if (!adjuntoNotaModalActual) return;
  verComprobanteGrande(adjuntoNotaModalActual, adjuntoNotaNombreActual || "Adjunto de Nota");
};

window.quitarAdjuntoNotaModal = function() {
  adjuntoNotaModalActual = "";
  adjuntoNotaTipoActual = "";
  adjuntoNotaNombreActual = "";
  document.getElementById("nota-adjunto-actual-link").classList.add("hidden");
  const fileInput = document.getElementById("nota-adjunto-file");
  if (fileInput) fileInput.value = "";
  document.getElementById("nota-upload-prompt").classList.remove("hidden");
  document.getElementById("nota-preview-box").classList.add("hidden");
};

window.verAdjuntoNota = function(id) {
  const nota = notasList.find(n => n.id === id);
  if (!nota || !nota.adjuntoUrl) return;
  verComprobanteGrande(nota.adjuntoUrl, nota.adjuntoNombre || nota.asunto);
};

window.guardarNota = async function(event) {
  event.preventDefault();
  const btn = document.getElementById("btn-guardar-nota");
  btn.disabled = true;
  btn.innerHTML = `<span>Guardando...</span>`;

  try {
    const idExistente = document.getElementById("nota-id").value;
    const fecha = document.getElementById("nota-fecha").value;
    const categoria = document.getElementById("nota-categoria").value;
    const asunto = document.getElementById("nota-asunto").value.trim();
    const descripcion = document.getElementById("nota-descripcion").value.trim();
    const fileInput = document.getElementById("nota-adjunto-file");

    let adjuntoUrl = adjuntoNotaModalActual || "";
    let adjuntoTipo = adjuntoNotaTipoActual || "";
    let adjuntoNombre = adjuntoNotaNombreActual || "";

    if (fileInput && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      adjuntoTipo = file.type;
      adjuntoNombre = file.name;
      try {
        adjuntoUrl = await fileToBase64(file);
      } catch (errF) {
        console.warn("Error convirtiendo adjunto de nota:", errF);
      }
    }

    const id = idExistente || `nota_${Date.now()}`;
    const payloadNota = {
      id,
      fecha,
      categoria,
      asunto,
      descripcion,
      adjuntoUrl,
      adjuntoTipo,
      adjuntoNombre,
      updatedAt: new Date().toISOString()
    };

    if (idExistente) {
      const idx = notasList.findIndex(n => n.id === idExistente);
      if (idx >= 0) notasList[idx] = { ...notasList[idx], ...payloadNota };
    } else {
      payloadNota.createdAt = new Date().toISOString();
      notasList.unshift(payloadNota);
    }

    try { localStorage.setItem("condo_notas_protocolos", JSON.stringify(notasList)); } catch (e) {}

    renderNotas();
    closeModalNota();
    showToast("Nota / Protocolo guardado correctamente.", "success");

    if (db) {
      db.collection("notas_protocolos").doc(id).set(payloadNota, { merge: true }).catch(err => {
        console.warn("Error guardando nota en Firestore:", err);
      });
    }
  } catch (error) {
    console.error("Error al guardar nota:", error);
    showToast("Error al guardar la nota: " + error.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>Guardar Nota</span>`;
  }
};

window.eliminarNota = function(id) {
  const nota = notasList.find(n => n.id === id);
  const titulo = nota ? `"${nota.asunto}"` : "esta nota";

  const confirmar = confirm(`¿Estás seguro de ELIMINAR ${titulo}?\n\nEsta acción no se puede deshacer.`);
  if (!confirmar) return;

  notasList = notasList.filter(n => n.id !== id);
  try { localStorage.setItem("condo_notas_protocolos", JSON.stringify(notasList)); } catch (e) {}
  renderNotas();
  showToast("Nota eliminada.", "info");

  if (db) {
    db.collection("notas_protocolos").doc(id).delete().catch(err => {
      console.warn("Error eliminando nota en Firestore:", err);
    });
  }
};

// ==========================================
// 9. VISOR, EXPORTACIÓN CSV, WHATSAPP & TABS
// ==========================================
window.verComprobanteGrande = function(url, titulo = "Archivo adjunto") {
  const img = document.getElementById("img-ampliada");
  const pdf = document.getElementById("pdf-ampliado");
  const tit = document.getElementById("visor-titulo");
  const esPDF = url.startsWith("data:application/pdf");

  if (tit) tit.textContent = titulo;
  if (esPDF) {
    img.classList.add("hidden");
    pdf.src = url;
    pdf.classList.remove("hidden");
  } else {
    pdf.classList.add("hidden");
    img.src = url;
    img.classList.remove("hidden");
  }
  document.getElementById("modal-visor-img").classList.remove("hidden");
};

window.cerrarVisorImg = function() {
  document.getElementById("modal-visor-img").classList.add("hidden");
  const pdf = document.getElementById("pdf-ampliado");
  if (pdf) pdf.src = "";
};

window.exportarJornadaCSV = function() {
  if (!jornadaActiva) return;
  const pagos = jornadaActiva.pagos || {};
  const aptos = apartamentosList.length > 0 ? apartamentosList : APARTAMENTOS_INICIALES;

  const headers = ["Apartamento", "Propietario", "Fecha Pago", "Tasa BCV", "Monto Fijado (USD)", "Pagado (Bs.)", "Equivalente (USD)", "Estado", "Referencia"];
  const filas = aptos.map(apt => {
    const p = pagos[apt.id] || {};
    const isPagado = p.estadoPago === "PAGADO";
    const fijado = (isPagado && p.montoFijadoUSD) ? Number(p.montoFijadoUSD) : Number(jornadaActiva.cuotaCobradaPorApto || 0);
    return [
      apt.numero,
      `"${(apt.propietario || "").replace(/"/g, '""')}"`,
      p.fechaPago || "",
      p.tasaBCV ? Number(p.tasaBCV).toFixed(2) : "",
      fijado.toFixed(2),
      p.montoPagadoBS ? Number(p.montoPagadoBS).toFixed(2) : "0.00",
      p.equivalenteUSDReal ? Number(p.equivalenteUSDReal).toFixed(2) : "0.00",
      p.estadoPago || "PENDIENTE",
      `"${(p.metodoRef || "").replace(/"/g, '""')}"`
    ].join(",");
  });

  const csv = [headers.join(","), ...filas].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `CondoControl_${(jornadaActiva.nombre || "Jornada").replace(/\s+/g, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Reporte CSV descargado correctamente.", "success");
};

window.marcarTodosRecordatorio = function() {
  if (!jornadaActiva) return;
  const pagos = jornadaActiva.pagos || {};
  const aptos = apartamentosList.length > 0 ? apartamentosList : APARTAMENTOS_INICIALES;
  const pendientes = aptos.filter(a => (pagos[a.id]?.estadoPago || "PENDIENTE") === "PENDIENTE");

  if (pendientes.length === 0) {
    showToast("¡Todos los apartamentos están al día en esta jornada!", "success");
    return;
  }

  const texto = "📢 *RECORDATORIO DE COBRANZA - " + jornadaActiva.nombre.toUpperCase() + "*\n" +
    "Cuota por apartamento: " + formatUSD(jornadaActiva.cuotaCobradaPorApto) + "\n" +
    "Tasa oficial BCV: " + document.getElementById("header-bcv-rate").innerText + "\n\n" +
    "*Apartamentos pendientes (" + pendientes.length + "):*\n" +
    pendientes.map(a => "• " + a.numero + " - " + a.propietario).join("\n");

  navigator.clipboard.writeText(texto).then(() => {
    showToast("Lista de pendientes copiada para pegar en WhatsApp.", "success");
  }).catch(() => {
    showToast("No se pudo copiar automáticamente al portapapeles.", "error");
  });
};

window.switchTab = function(tab) {
  const tabs = ['jornadas', 'apartamentos', 'tasas', 'notas'];
  tabs.forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (t === tab) {
      if (el) el.classList.remove("hidden");
      if (btn) btn.className = "tab-btn w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap bg-[#1D63ED] text-white shadow-lg shadow-blue-600/30";
    } else {
      if (el) el.classList.add("hidden");
      if (btn) btn.className = "tab-btn w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap text-slate-200/85 hover:bg-white/10 hover:text-white";
    }
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.initApp = initApp;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
