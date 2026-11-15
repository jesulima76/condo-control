// ==========================================================================
// CondoControl - Gestión de Cobranzas, Tasa BCV & Notas/Protocolos
// ==========================================================================

// Configuración de conexión con Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBLWrf7c-FL7C2xDWERzjnCiRmUX_6flVc",
  authDomain: "condominio-cobranzas.firebaseapp.com",
  projectId: "condominio-cobranzas",
  storageBucket: "condominio-cobranzas.firebasestorage.app",
  messagingSenderId: "980591655193",
  appId: "1:980591655193:web:8d8df30e733497ba6fad88"
};

// Inicializar Firebase Compat (Compatible con doble clic local y web)
let db = null;
let storage = null;

try {
  if (typeof firebase !== 'undefined') {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    storage = firebase.storage();
    console.log("Firebase inicializado correctamente.");
  }
} catch (e) {
  console.warn("Error inicializando Firebase:", e);
}

// Estado de la Aplicación en memoria
let jornadasList = [];
let jornadaActiva = null;
let apartamentosList = [];
let tasasHistorial = {};
let notasList = [];
let unsubscribeJornada = null;
let tasaBCVHoy = 911.62;
let adjuntoNotaModalActual = "";
let adjuntoNotaTipoActual = "";

// Lista base de los 13 apartamentos de la Torre 7 (según datos del condominio)
const APARTAMENTOS_INICIALES = [
  { id: "07-11", numero: "07-11", propietario: "LUIS F. MARQUEZ", telefono: "" },
  { id: "07-12", numero: "07-12", propietario: "WILLIAM J. ESCOBAR", telefono: "" },
  { id: "07-13", numero: "07-13", propietario: "ELIZABETH NIÑO PAIVA", telefono: "" },
  { id: "07-21", numero: "07-21", propietario: "EDGAR N. PETIT", telefono: "" },
  { id: "07-22", numero: "07-22", propietario: "EDUARDO R. VERA M.", telefono: "" },
  { id: "07-24", numero: "07-24", propietario: "JESUS M. LIMA L.", telefono: "" },
  { id: "07-31", numero: "07-31", propietario: "JUANA FRANCISCA ROJAS", telefono: "" },
  { id: "07-32", numero: "07-32", propietario: "LUIS A. NATERA", telefono: "" },
  { id: "07-33", numero: "07-33", propietario: "JAVIER CORDERO", telefono: "" },
  { id: "07-34", numero: "07-34", propietario: "EMILIO PRECIADO I.", telefono: "" },
  { id: "07-41", numero: "07-41", propietario: "VERONICA Y. FAGUNDEZ", telefono: "" },
  { id: "07-42", numero: "07-42", propietario: "FRANK R. ROJAS E.", telefono: "" },
  { id: "07-43", numero: "07-43", propietario: "ALBA COLINA", telefono: "" },
];

// Notas iniciales de bienvenida / ejemplo si está vacío
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

// Formateadores de moneda
const formatUSD = (num) => `$${(Number(num) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatBS = (num) => `Bs. ${(Number(num) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ==========================================
// 1. OBTENCIÓN AUTOMÁTICA DE TASA BCV
// ==========================================
async function fetchTasaBCV() {
  const headerTasaEl = document.getElementById("header-bcv-rate");
  const statusEl = document.getElementById("header-bcv-status");
  const iconRefresh = document.getElementById("icon-refresh-bcv");

  if (iconRefresh) iconRefresh.classList.add("animate-spin");
  if (statusEl) statusEl.textContent = "Consultando BCV en vivo...";

  let promedio = null;

  // Intento 1: API Directa Oficial
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch("https://ve.dolarapi.com/v1/dolares/oficial", { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data && data.promedio) {
        promedio = Number(data.promedio);
      }
    }
  } catch (err) {
    console.warn("Intento 1 con DolarAPI oficial falló o demoró:", err);
  }

  // Intento 2: Endpoint general con fallback si el intento 1 falló
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
          if (itemOficial && itemOficial.promedio) {
            promedio = Number(itemOficial.promedio);
          }
        }
      }
    } catch (err2) {
      console.warn("Intento 2 con DolarAPI lista general falló:", err2);
    }
  }

  if (promedio && !isNaN(promedio) && promedio > 0) {
    tasaBCVHoy = promedio;
    const horaActual = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    if (headerTasaEl) headerTasaEl.innerText = `${tasaBCVHoy.toFixed(2)} Bs./$`;
    if (statusEl) statusEl.textContent = `Oficial BCV • Actualizado ${horaActual}`;

    const fechaHoy = new Date().toISOString().split('T')[0];
    guardarTasaEnMemoriaYFirebase(fechaHoy, tasaBCVHoy, "API Oficial BCV");

    // Refrescar vistas para que asuman la nueva tasa si aplica
    if (jornadaActiva) renderJornadaActiva();
  } else {
    // Si la red no respondió, mantenemos la última tasa conocida
    if (headerTasaEl) headerTasaEl.innerText = `${tasaBCVHoy.toFixed(2)} Bs./$`;
    if (statusEl) statusEl.textContent = "Última tasa registrada • Offline";
  }

  if (iconRefresh) iconRefresh.classList.remove("animate-spin");
}

async function guardarTasaEnMemoriaYFirebase(fecha, valor, origen = "Manual") {
  tasasHistorial[fecha] = Number(valor);
  renderHistorialTasas();

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
  console.log("Iniciando CondoControl App...");
  if (typeof lucide !== 'undefined') {
    try { lucide.createIcons(); } catch (e) {}
  }

  // 1. Cargar directorio base en pantalla
  apartamentosList = [...APARTAMENTOS_INICIALES];
  renderDirectorioApartamentos();

  // 2. Jornada inicial local con datos completos
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

  jornadasList = [jornadaLocalInicial];
  jornadaActiva = jornadaLocalInicial;
  actualizarSelectorJornadas();
  renderJornadaActiva();

  // 3. Historial de tasas inicial
  tasasHistorial["2026-11-09"] = 897.54;
  tasasHistorial["2026-11-13"] = 911.62;
  renderHistorialTasas();

  // 4. Cargar notas desde localStorage o iniciales
  try {
    const notasGuardadas = localStorage.getItem("condo_notas_protocolos");
    if (notasGuardadas) {
      notasList = JSON.parse(notasGuardadas);
    } else {
      notasList = [...NOTAS_INICIALES];
    }
  } catch (errNotas) {
    notasList = [...NOTAS_INICIALES];
  }
  renderNotas();

  // 5. Consultar tasa BCV en vivo de inmediato
  fetchTasaBCV();

  // Programar actualización automática cada 10 minutos (600.000 ms)
  setInterval(() => {
    fetchTasaBCV();
  }, 10 * 60 * 1000);

  // 6. Conexión en vivo con Firestore
  if (db) {
    try {
      // Apartamentos
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
      }, (err) => console.warn("Firestore apartamentos:", err));

      // Tasas BCV
      db.collection("tasas_bcv").onSnapshot((snapshot) => {
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          if (data && data.fecha && data.tasa) {
            tasasHistorial[data.fecha] = data.tasa;
          }
        });
        renderHistorialTasas();
      }, (err) => console.warn("Firestore tasas:", err));

      // Jornadas
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

      // Notas y Protocolos en vivo
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
    }
  }

  // Listener para el botón manual de refrescar tasa
  const btnRefresh = document.getElementById("btn-refresh-rate");
  if (btnRefresh) {
    btnRefresh.onclick = () => fetchTasaBCV();
  }

  // Listener para selector de jornada
  const selectJornada = document.getElementById("select-jornada");
  if (selectJornada) {
    selectJornada.onchange = (e) => cargarJornadaSeleccionada(e.target.value);
  }
}

function actualizarSelectorJornadas() {
  const select = document.getElementById("select-jornada");
  if (!select) return;
  select.innerHTML = "";

  jornadasList.forEach(j => {
    const opt = document.createElement("option");
    opt.value = j.id;
    opt.textContent = `${j.nombre} (Cuota: ${formatUSD(j.cuotaCobradaPorApto)})`;
    select.appendChild(opt);
  });

  if (jornadasList.length > 0) {
    if (!jornadaActiva || !jornadasList.find(x => x.id === jornadaActiva.id)) {
      cargarJornadaSeleccionada(jornadasList[0].id);
    } else {
      cargarJornadaSeleccionada(jornadaActiva.id);
    }
  }
}

function cargarJornadaSeleccionada(id) {
  if (unsubscribeJornada) unsubscribeJornada();

  const j = jornadasList.find(x => x.id === id);
  if (j) {
    jornadaActiva = j;
    const select = document.getElementById("select-jornada");
    if (select) select.value = id;
    renderJornadaActiva();
  }

  if (db) {
    unsubscribeJornada = db.collection("jornadas").doc(id).onSnapshot((docSnap) => {
      if (docSnap.exists) {
        jornadaActiva = { id: docSnap.id, ...docSnap.data() };
        const select = document.getElementById("select-jornada");
        if (select) select.value = id;
        renderJornadaActiva();
      }
    });
  }
}

// ==========================================
// 3. RENDERIZADO Y CÁLCULOS DE LA JORNADA
// ==========================================
function renderJornadaActiva() {
  if (!jornadaActiva) return;

  const pagos = jornadaActiva.pagos || {};
  const aptos = apartamentosList.length > 0 ? apartamentosList : APARTAMENTOS_INICIALES;

  let totalFijadoUSD = 0;
  let totalRecaudadoBS = 0;
  let totalRealUSD = 0;
  let aptosPagados = 0;

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

    // La cuota fijada vigente para cada apartamento
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

    const tr = document.createElement("tr");
    tr.className = "hover:bg-blue-50/40 transition-colors cursor-pointer group border-b border-slate-100/80";
    tr.onclick = () => openModalPago(apt.id);

    tr.innerHTML = `
      <td class="py-3.5 px-5 font-black text-slate-900 tracking-tight font-mono">
        <span class="bg-slate-100 group-hover:bg-blue-100 text-slate-800 group-hover:text-blue-900 px-2.5 py-1 rounded-xl text-xs transition-colors">
          ${apt.numero}
        </span>
      </td>
      <td class="py-3.5 px-5 font-bold text-slate-800 text-xs sm:text-sm">${apt.propietario}</td>
      <td class="py-3.5 px-5 text-slate-500 font-mono text-xs">${p.fechaPago || '<span class="text-slate-300 font-sans">—</span>'}</td>
      <td class="py-3.5 px-5 text-right font-mono text-xs font-bold text-slate-600">${p.tasaBCV ? Number(p.tasaBCV).toFixed(2) : '<span class="text-slate-300 font-sans">—</span>'}</td>
      <td class="py-3.5 px-5 text-right font-mono font-bold text-slate-900">${formatUSD(montoFijadoVigente)}</td>
      <td class="py-3.5 px-5 text-right font-black font-mono ${p.montoPagadoBS > 0 ? 'text-emerald-600 text-sm' : 'text-slate-300 font-sans'}">
        ${p.montoPagadoBS > 0 ? formatBS(p.montoPagadoBS) : '—'}
      </td>
      <td class="py-3.5 px-5 text-right font-black font-mono ${p.equivalenteUSDReal > 0 ? 'text-indigo-600 text-sm' : 'text-slate-300 font-sans'}">
        ${p.equivalenteUSDReal > 0 ? formatUSD(p.equivalenteUSDReal) : '—'}
      </td>
      <td class="py-3.5 px-5 text-center">
        <span class="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-extrabold tracking-wide ${
          isPagado ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/80 shadow-sm' : 'bg-amber-50 text-amber-700 border border-amber-200/80'
        }">
          <span class="w-1.5 h-1.5 rounded-full mr-1.5 ${isPagado ? 'bg-emerald-500' : 'bg-amber-500'}"></span>
          ${p.estadoPago}
        </span>
      </td>
      <td class="py-3.5 px-5 text-center" onclick="event.stopPropagation()">
        ${p.comprobanteUrl ? `
          <button onclick="verComprobanteGrande('${p.comprobanteUrl}')" class="text-blue-700 hover:text-blue-900 inline-flex items-center space-x-1.5 text-xs font-bold bg-blue-50 hover:bg-blue-100 border border-blue-200/60 px-3 py-1.5 rounded-xl transition-all shadow-sm" title="Ver Comprobante">
            <i data-lucide="image" class="w-3.5 h-3.5"></i>
            <span>Ver</span>
          </button>
        ` : `
          <button onclick="openModalPago('${apt.id}')" class="text-slate-400 hover:text-slate-600 inline-flex items-center space-x-1 text-xs font-semibold bg-slate-50 hover:bg-slate-100 px-2.5 py-1.5 rounded-xl transition" title="Adjuntar comprobante">
            <i data-lucide="upload" class="w-3.5 h-3.5"></i>
            <span>Cargar</span>
          </button>
        `}
      </td>
      <td class="py-3.5 px-5 text-center">
        <div class="flex items-center justify-center space-x-1.5" onclick="event.stopPropagation()">
          <button onclick="openModalPago('${apt.id}')" class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition" title="Editar Pago">
            <i data-lucide="edit-3" class="w-4 h-4"></i>
          </button>
          ${isPagado ? `
            <button onclick="revertirPagoAptoDirecto('${apt.id}')" class="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition" title="Revertir Pago">
              <i data-lucide="rotate-ccw" class="w-4 h-4"></i>
            </button>
          ` : ''}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Estadísticas y KPIs superiores
  document.getElementById("stat-presupuesto").textContent = formatUSD(jornadaActiva.montoFactura || 0);
  document.getElementById("stat-cuota-cobrada").textContent = `${formatUSD(jornadaActiva.cuotaCobradaPorApto || 0)} / apto`;
  document.getElementById("stat-recaudado-bs").textContent = formatBS(totalRecaudadoBS);
  document.getElementById("stat-recaudado-usd").textContent = formatUSD(totalRealUSD);

  const tasaCierre = jornadaActiva.tasaCierreProyectada || tasaBCVHoy || 911.62;
  document.getElementById("stat-tasa-cierre").textContent = `${Number(tasaCierre).toFixed(2)} Bs./$`;

  const superavit = totalRealUSD - (jornadaActiva.montoFactura || 0);
  const elSuperavit = document.getElementById("stat-superavit");
  elSuperavit.textContent = `${superavit >= 0 ? '+' : ''}${formatUSD(superavit)}`;
  elSuperavit.className = `font-bold font-mono ${superavit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;

  // Avance
  const totalAptos = aptos.length;
  document.getElementById("stat-avance-cobro").textContent = `${aptosPagados} / ${totalAptos}`;
  const pct = totalAptos > 0 ? (aptosPagados / totalAptos) * 100 : 0;
  document.getElementById("stat-progreso-barra").style.width = `${pct}%`;

  // TOTALES EN EL PIE DE TABLA (TFOOT)
  const elTotalFijado = document.getElementById("total-fijado-usd");
  if (elTotalFijado) elTotalFijado.textContent = formatUSD(totalFijadoUSD);

  const elTotalPagado = document.getElementById("total-pagado-bs");
  if (elTotalPagado) elTotalPagado.textContent = formatBS(totalRecaudadoBS);

  const elTotalReal = document.getElementById("total-real-usd");
  if (elTotalReal) elTotalReal.textContent = formatUSD(totalRealUSD);

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ==========================================
// 4. MODAL DE REGISTRO DE PAGO
// ==========================================
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
  const fileInput = document.getElementById("pago-comprobante-file");
  fileInput.value = "";

  if (pago.comprobanteUrl) {
    linkBox.classList.remove("hidden");
    document.getElementById("link-ver-comprobante").href = pago.comprobanteUrl;
  } else {
    linkBox.classList.add("hidden");
  }

  uploadPrompt.classList.remove("hidden");
  previewBox.classList.add("hidden");

  // Mostrar o esconder botón Revertir Pago
  const btnRevertir = document.getElementById("btn-revertir-pago");
  if (btnRevertir) {
    if (pago.estadoPago === "PAGADO") {
      btnRevertir.classList.remove("hidden");
    } else {
      btnRevertir.classList.add("hidden");
    }
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
    const totalBS = (cuotaUSD * tasa).toFixed(2);
    document.getElementById("pago-monto-bs").value = totalBS;
    document.getElementById("pago-real-usd").value = cuotaUSD.toFixed(2);
  }
};

window.calcularEquivalenteUsdReal = function() {
  const montoBS = parseFloat(document.getElementById("pago-monto-bs").value) || 0;
  const tasa = parseFloat(document.getElementById("pago-tasa-bcv").value) || 0;
  if (tasa > 0) {
    const realUSD = (montoBS / tasa).toFixed(2);
    document.getElementById("pago-real-usd").value = realUSD;
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
    document.getElementById("comprobante-preview-img").src = "https://cdn-icons-png.flaticon.com/512/337/337946.png";
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

    if (fecha && tasa > 0) {
      guardarTasaEnMemoriaYFirebase(fecha, tasa, "Registro de Pago");
    }

    let comprobanteUrl = jornadaActiva.pagos?.[aptoId]?.comprobanteUrl || "";

    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      try {
        comprobanteUrl = await fileToBase64(file);
      } catch (errFile) {
        console.warn("No se pudo leer comprobante:", errFile);
      }
    }

    const payloadPago = {
      aptoId: aptoId,
      fechaPago: fecha,
      tasaBCV: tasa,
      montoFijadoUSD: montoUSD,
      montoPagadoBS: montoBS,
      equivalenteUSDReal: realUSD,
      estadoPago: estado,
      metodoRef: referencia,
      comprobanteUrl: comprobanteUrl,
      updatedAt: new Date().toISOString()
    };

    if (!jornadaActiva.pagos) jornadaActiva.pagos = {};
    jornadaActiva.pagos[aptoId] = payloadPago;
    renderJornadaActiva();
    closeModalPago();

    if (db) {
      const updatePath = `pagos.${aptoId}`;
      db.collection("jornadas").doc(jornadaActiva.id).update({
        [updatePath]: payloadPago
      }).catch(err => {
        console.warn("Firestore update en background:", err);
      });
    }

  } catch (error) {
    console.error("Error al guardar pago:", error);
    alert("Error al procesar el pago: " + error.message);
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
  const numAptos = parseInt(document.getElementById("jornada-num-aptos").value) || 13;
  const margen = parseFloat(document.getElementById("jornada-margen").value) || 0;

  if (factura > 0 && numAptos > 0) {
    const cuotaBase = factura / numAptos;
    const conMargen = cuotaBase * (1 + margen / 100);
    document.getElementById("jornada-cuota-cobrada").value = conMargen.toFixed(2);
  }
};

window.guardarJornada = async function(event) {
  event.preventDefault();
  const idExistente = document.getElementById("jornada-id").value;
  const nombre = document.getElementById("jornada-nombre").value;
  const factura = parseFloat(document.getElementById("jornada-monto-factura").value) || 0;
  const numAptos = parseInt(document.getElementById("jornada-num-aptos").value) || 13;
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

        if (p.estadoPago !== "PAGADO") {
          p.montoFijadoUSD = cuotaCobrada;
        }
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

      if (db) {
        db.collection("jornadas").doc(idExistente).update({
          nombre,
          montoFactura: factura,
          numAptos,
          margenProteccion: margen,
          cuotaCobradaPorApto: cuotaCobrada,
          fechaInicio,
          fechaFin,
          pagos: pagosActualizados,
          updatedAt: new Date().toISOString()
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

      if (db) {
        db.collection("jornadas").doc(idNueva).set(nuevaJornada).catch(e => console.warn(e));
      }
    }
    closeModalJornada();
  } catch (e) {
    console.error("Error guardando jornada:", e);
    alert("Error al guardar la jornada: " + e.message);
  }
};

// ==========================================
// 6. GESTIÓN DEL DIRECTORIO DE APARTAMENTOS
// ==========================================
function renderDirectorioApartamentos() {
  const tbody = document.getElementById("tabla-directorio-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  apartamentosList.forEach(apt => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50 transition";
    tr.innerHTML = `
      <td class="py-3 px-4 font-bold text-slate-900">${apt.numero}</td>
      <td class="py-3 px-4 text-slate-800 font-medium">${apt.propietario}</td>
      <td class="py-3 px-4 text-slate-600">${apt.telefono || '—'}</td>
      <td class="py-3 px-4 text-slate-600">${apt.email || '—'}</td>
      <td class="py-3 px-4 text-center">
        <button onclick="editarApartamento('${apt.id}')" class="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg" title="Editar">
          <i data-lucide="edit-2" class="w-4 h-4"></i>
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

  const id = idExistente || numero.replace(/[^a-zA-Z0-9_-]/g, "_");
  const nuevoApto = { id, numero, propietario, telefono, updatedAt: new Date().toISOString() };

  const idx = apartamentosList.findIndex(a => a.id === id);
  if (idx >= 0) {
    apartamentosList[idx] = nuevoApto;
  } else {
    apartamentosList.push(nuevoApto);
  }
  renderDirectorioApartamentos();

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
      <td class="py-3 px-4 font-mono font-semibold text-slate-800">${fecha}</td>
      <td class="py-3 px-4 text-right font-extrabold text-blue-600 font-mono">${Number(tasa).toFixed(2)} Bs./$</td>
      <td class="py-3 px-4 text-center text-xs text-slate-500">BCV Oficial</td>
      <td class="py-3 px-4 text-center">
        <button onclick="editarTasa('${fecha}', ${tasa})" class="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg">
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
  }
};

// ==========================================
// 8. MÓDULO: NOTAS Y PROTOCOLOS
// ==========================================
function renderNotas(lista = null) {
  const contenedor = document.getElementById("contenedor-notas");
  const vacio = document.getElementById("vacio-notas");
  const badgeTotal = document.getElementById("badge-total-notas");
  if (!contenedor) return;

  const items = lista || notasList;
  if (badgeTotal) badgeTotal.textContent = notasList.length;

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
    "Servicios": { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
    "General": { bg: "bg-slate-100", text: "text-slate-700", border: "border-slate-200" },
  };

  items.forEach(nota => {
    const estiloCat = coloresCategoria[nota.categoria] || coloresCategoria["General"];
    const esPDF = nota.adjuntoTipo === "application/pdf" || (nota.adjuntoUrl && nota.adjuntoUrl.includes("application/pdf"));
    const esImg = nota.adjuntoUrl && !esPDF;

    const card = document.createElement("div");
    card.className = "bg-white p-5 rounded-3xl border border-slate-200/80 shadow-card hover:shadow-md transition-all flex flex-col justify-between group";

    card.innerHTML = `
      <div>
        <div class="flex items-center justify-between gap-2 mb-3">
          <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide ${estiloCat.bg} ${estiloCat.text} border ${estiloCat.border}">
            ${nota.categoria || 'General'}
          </span>
          <span class="text-xs font-mono font-bold text-slate-400">
            ${nota.fecha || 'Sin fecha'}
          </span>
        </div>

        <h3 class="text-sm font-extrabold text-slate-900 group-hover:text-blue-600 transition-colors leading-snug">
          ${nota.asunto}
        </h3>

        ${nota.descripcion ? `
          <p class="text-xs text-slate-600 mt-2 line-clamp-3 leading-relaxed whitespace-pre-line">
            ${nota.descripcion}
          </p>
        ` : ''}

        ${nota.adjuntoUrl ? `
          <div class="mt-4 pt-3 border-t border-slate-100">
            <button onclick="verAdjuntoNota('${nota.id}')" class="w-full bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 rounded-2xl p-2.5 flex items-center space-x-2.5 transition text-left">
              <div class="w-8 h-8 rounded-xl ${esPDF ? 'bg-rose-100 text-rose-600' : 'bg-blue-100 text-blue-600'} flex items-center justify-center shrink-0">
                <i data-lucide="${esPDF ? 'file-text' : 'image'}" class="w-4 h-4"></i>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-[11px] font-bold text-slate-800 truncate">${nota.adjuntoNombre || (esPDF ? 'Documento PDF' : 'Captura Adjunta')}</p>
                <p class="text-[10px] text-blue-600 font-semibold">Clic para ver archivo</p>
              </div>
            </button>
          </div>
        ` : ''}
      </div>

      <div class="mt-4 pt-3 border-t border-slate-100 flex items-center justify-end space-x-1.5">
        <button onclick="editarNota('${nota.id}')" class="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition" title="Editar Nota">
          <i data-lucide="edit-3" class="w-4 h-4"></i>
        </button>
        <button onclick="eliminarNota('${nota.id}')" class="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition" title="Eliminar Nota">
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

  const fileInput = document.getElementById("nota-adjunto-file");
  if (fileInput) fileInput.value = "";

  document.getElementById("nota-upload-prompt").classList.remove("hidden");
  document.getElementById("nota-preview-box").classList.add("hidden");

  const linkBox = document.getElementById("nota-adjunto-actual-link");
  if (adjuntoNotaModalActual) {
    linkBox.classList.remove("hidden");
  } else {
    linkBox.classList.add("hidden");
  }

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
    reader.onload = (e) => {
      imgEl.src = e.target.result;
    };
    reader.readAsDataURL(file);
  } else {
    imgEl.classList.add("hidden");
    docIcon.classList.remove("hidden");
  }
};

window.verAdjuntoNotaModal = function() {
  if (!adjuntoNotaModalActual) return;
  if (adjuntoNotaTipoActual === "application/pdf" || adjuntoNotaModalActual.startsWith("data:application/pdf")) {
    const w = window.open("");
    w.document.write(`<iframe src="${adjuntoNotaModalActual}" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
  } else {
    verComprobanteGrande(adjuntoNotaModalActual);
  }
};

window.quitarAdjuntoNotaModal = function() {
  adjuntoNotaModalActual = "";
  adjuntoNotaTipoActual = "";
  document.getElementById("nota-adjunto-actual-link").classList.add("hidden");
  const fileInput = document.getElementById("nota-adjunto-file");
  if (fileInput) fileInput.value = "";
  document.getElementById("nota-upload-prompt").classList.remove("hidden");
  document.getElementById("nota-preview-box").classList.add("hidden");
};

window.verAdjuntoNota = function(id) {
  const nota = notasList.find(n => n.id === id);
  if (!nota || !nota.adjuntoUrl) return;

  const esPDF = nota.adjuntoTipo === "application/pdf" || nota.adjuntoUrl.startsWith("data:application/pdf");
  if (esPDF) {
    const w = window.open("");
    w.document.write(`<iframe src="${nota.adjuntoUrl}" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`);
  } else {
    verComprobanteGrande(nota.adjuntoUrl);
  }
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
    let adjuntoNombre = "";

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
      id: id,
      fecha: fecha,
      categoria: categoria,
      asunto: asunto,
      descripcion: descripcion,
      adjuntoUrl: adjuntoUrl,
      adjuntoTipo: adjuntoTipo,
      adjuntoNombre: adjuntoNombre,
      updatedAt: new Date().toISOString()
    };

    if (idExistente) {
      const idx = notasList.findIndex(n => n.id === idExistente);
      if (idx >= 0) notasList[idx] = { ...notasList[idx], ...payloadNota };
    } else {
      payloadNota.createdAt = new Date().toISOString();
      notasList.unshift(payloadNota);
    }

    // Persistencia local
    try {
      localStorage.setItem("condo_notas_protocolos", JSON.stringify(notasList));
    } catch (e) {}

    renderNotas();
    closeModalNota();

    // Sincronización Firestore
    if (db) {
      db.collection("notas_protocolos").doc(id).set(payloadNota, { merge: true }).catch(err => {
        console.warn("Error guardando nota en Firestore:", err);
      });
    }

  } catch (error) {
    console.error("Error al guardar nota:", error);
    alert("Error al guardar la nota: " + error.message);
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

  if (db) {
    db.collection("notas_protocolos").doc(id).delete().catch(err => {
      console.warn("Error eliminando nota en Firestore:", err);
    });
  }
};

// ==========================================
// 9. ACCIONES ADICIONALES Y PESTAÑAS
// ==========================================
window.verComprobanteGrande = function(url) {
  document.getElementById("img-ampliada").src = url;
  document.getElementById("modal-visor-img").classList.remove("hidden");
};

window.cerrarVisorImg = function() {
  document.getElementById("modal-visor-img").classList.add("hidden");
};

window.marcarTodosRecordatorio = function() {
  if (!jornadaActiva) return;
  const pagos = jornadaActiva.pagos || {};
  const aptos = apartamentosList.length > 0 ? apartamentosList : APARTAMENTOS_INICIALES;

  const pendientes = aptos.filter(a => (pagos[a.id]?.estadoPago || "PENDIENTE") === "PENDIENTE");

  if (pendientes.length === 0) {
    alert("¡Todos los apartamentos están al día en esta jornada!");
    return;
  }

  const texto = "📢 *RECORDATORIO DE COBRANZA - " + jornadaActiva.nombre.toUpperCase() + "*\n" +
    "Cuota por apartamento: " + formatUSD(jornadaActiva.cuotaCobradaPorApto) + "\n" +
    "Tasa oficial BCV: " + document.getElementById("header-bcv-rate").innerText + "\n\n" +
    "*Apartamentos pendientes (" + pendientes.length + "):*\n" +
    pendientes.map(a => "• " + a.numero + " - " + a.propietario).join("\n");

  navigator.clipboard.writeText(texto).then(() => {
    alert("¡Lista de pendientes copiada al portapapeles! Puedes pegarla en el grupo de WhatsApp del condominio.");
  });
};

window.switchTab = function(tab) {
  const tabs = ['jornadas', 'apartamentos', 'tasas', 'notas'];
  tabs.forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (t === tab) {
      if (el) el.classList.remove("hidden");
      if (btn) btn.className = "tab-btn px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-2 transition-all duration-200 bg-blue-50 text-blue-700 shadow-sm shadow-blue-500/10 border border-blue-200/60";
    } else {
      if (el) el.classList.add("hidden");
      if (btn) btn.className = "tab-btn px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center space-x-2 transition-all duration-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100/80";
    }
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.initApp = initApp;

// Arrancar inmediatamente cuando el DOM esté listo
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
