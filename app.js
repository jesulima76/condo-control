// Configuración de conexión con Firebase
const firebaseConfig = {
  apiKey: "AIzaSyBLWrf7c-FL7C2xDWERzjnCiRmUX_6flVc",
  authDomain: "condominio-cobranzas.firebaseapp.com",
  projectId: "condominio-cobranzas",
  storageBucket: "condominio-cobranzas.firebasestorage.app",
  messagingSenderId: "980591655193",
  appId: "1:980591655193:web:8d8df30e733497ba6fad88"
};

// Inicializar Firebase Compat (Compatible con doble clic directo a index.html)
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
let unsubscribeJornada = null;
let tasaBCVHoy = 897.54;

// Lista inicial de los 13 apartamentos de la Torre 7 (basado en el Excel)
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

// Formateadores de moneda
const formatUSD = (num) => `$${(Number(num) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatBS = (num) => `Bs. ${(Number(num) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ==========================================
// 1. OBTENCIÓN AUTOMÁTICA DE TASA BCV
// ==========================================
async function fetchTasaBCV() {
  const headerTasaEl = document.getElementById("header-bcv-rate");
  if (headerTasaEl) headerTasaEl.innerText = `${tasaBCVHoy.toFixed(2)} Bs./$`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch("https://ve.dolarapi.com/v1/dolares/oficial", { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data && data.promedio) {
        tasaBCVHoy = Number(data.promedio);
        if (headerTasaEl) headerTasaEl.innerText = `${tasaBCVHoy.toFixed(2)} Bs./$`;
        guardarTasaEnMemoriaYFirebase(new Date().toISOString().split('T')[0], tasaBCVHoy, "API Oficial BCV");
      }
    }
  } catch (err) {
    console.warn("Consulta API BCV falló o demoró, usando valor de respaldo:", err);
  }
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

  // 1. Mostrar inmediatamente datos en pantalla
  apartamentosList = [...APARTAMENTOS_INICIALES];
  renderDirectorioApartamentos();

  const jornadaLocalInicial = {
    id: "jornada_bolsas_basura_nov_2026",
    nombre: "Bolsas de Basura y Limpieza",
    montoFactura: 55.00,
    numAptos: 13,
    margenProteccion: 6.2,
    cuotaCobradaPorApto: 4.50,
    tasaCierreProyectada: 897.54,
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
        metodoRef: "",
        comprobanteUrl: ""
      }
    }
  };

  jornadasList = [jornadaLocalInicial];
  jornadaActiva = jornadaLocalInicial;
  actualizarSelectorJornadas();
  renderJornadaActiva();

  // Historial de tasas inicial
  tasasHistorial["2026-11-09"] = 897.54;
  renderHistorialTasas();

  // 2. Consultar tasa BCV en background sin bloquear
  try { fetchTasaBCV(); } catch (e) {}

  // 3. Conexión en vivo con Firestore (protegida)
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
      }, (err) => console.warn("Firestore apartamentos:", err));

      db.collection("tasas_bcv").onSnapshot((snapshot) => {
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          tasasHistorial[data.fecha] = data.tasa;
        });
        renderHistorialTasas();
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
    } catch (errDb) {
      console.warn("Error iniciando listeners de Firestore:", errDb);
    }
  }

  // Listener para el botón de refrescar tasa
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
    document.getElementById("select-jornada").value = id;
    renderJornadaActiva();
  }

  if (db) {
    unsubscribeJornada = db.collection("jornadas").doc(id).onSnapshot((docSnap) => {
      if (docSnap.exists) {
        jornadaActiva = { id: docSnap.id, ...docSnap.data() };
        document.getElementById("select-jornada").value = id;
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

    // Si el pago está pendiente, aseguramos que refleje la cuota cobrada vigente
    const montoFijadoVigente = (p.estadoPago === "PAGADO" && p.montoFijadoUSD)
      ? p.montoFijadoUSD
      : (jornadaActiva.cuotaCobradaPorApto || 0);

    totalFijadoUSD += Number(montoFijadoVigente || 0);

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

  // Estadísticas
  document.getElementById("stat-presupuesto").textContent = formatUSD(jornadaActiva.montoFactura || 0);
  document.getElementById("stat-cuota-cobrada").textContent = `${formatUSD(jornadaActiva.cuotaCobradaPorApto || 0)} / apto`;
  document.getElementById("stat-recaudado-bs").textContent = formatBS(totalRecaudadoBS);
  document.getElementById("stat-recaudado-usd").textContent = formatUSD(totalRealUSD);

  const tasaCierre = jornadaActiva.tasaCierreProyectada || tasaBCVHoy || 897.54;
  document.getElementById("stat-tasa-cierre").textContent = `${Number(tasaCierre).toFixed(2)} Bs./$`;

  const superavit = totalRealUSD - (jornadaActiva.montoFactura || 0);
  const elSuperavit = document.getElementById("stat-superavit");
  elSuperavit.textContent = `${superavit >= 0 ? '+' : ''}${formatUSD(superavit)}`;
  elSuperavit.className = `font-bold ${superavit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`;

  // Avance
  const totalAptos = aptos.length;
  document.getElementById("stat-avance-cobro").textContent = `${aptosPagados} / ${totalAptos}`;
  const pct = totalAptos > 0 ? (aptosPagados / totalAptos) * 100 : 0;
  document.getElementById("stat-progreso-barra").style.width = `${pct}%`;

  // Totales
  const tfoot = document.getElementById("tabla-pagos-tfoot");
  if (tfoot) {
    tfoot.innerHTML = `
      <tr class="bg-slate-50/80 border-t-2 border-slate-200">
        <td colspan="4" class="py-3 px-5 text-xs font-extrabold text-slate-500 uppercase tracking-widest">TOTALES RECAUDACIÓN</td>
        <td class="py-3 px-5 text-right font-extrabold text-slate-900 font-mono">${formatUSD(totalFijadoUSD)}</td>
        <td class="py-3 px-5 text-right font-extrabold text-emerald-600 font-mono">${formatBS(totalRecaudadoBS)}</td>
        <td class="py-3 px-5 text-right font-extrabold text-indigo-600 font-mono">${formatUSD(totalRealUSD)}</td>
        <td colspan="3"></td>
      </tr>
    `;
  }

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

  const tasaFecha = pago.tasaBCV || tasasHistorial[fechaPago] || tasaBCVHoy || 897.54;
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

  // Mostrar o esconder el botón de Revertir Pago
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

    // Si seleccionó archivo nuevo, lo convertimos a Base64 de inmediato (rápido y seguro)
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      try {
        comprobanteUrl = await fileToBase64(file);
      } catch (errFile) {
        console.warn("No se pudo leer archivo en Base64:", errFile);
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

    // 1. Actualizar memoria y tabla INMEDIATAMENTE
    if (!jornadaActiva.pagos) jornadaActiva.pagos = {};
    jornadaActiva.pagos[aptoId] = payloadPago;
    renderJornadaActiva();

    // 2. Cerrar el modal de inmediato para no hacer esperar al usuario
    closeModalPago();

    // 3. Sincronizar en segundo plano con Firebase Firestore sin congelar la pantalla
    if (db) {
      const updatePath = `pagos.${aptoId}`;
      db.collection("jornadas").doc(jornadaActiva.id).update({
        [updatePath]: payloadPago
      }).catch(err => {
        console.warn("Firestore update error en background:", err);
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
  document.getElementById("modal-jornada-titulo").textContent = "Editar Jornada Activa";
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
      // Modificar jornada existente
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
      // Crear nueva jornada
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
        tasaCierreProyectada: tasaBCVHoy || 897.54,
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
// 8. ACCIONES ADICIONALES
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
    "Tasa del día: " + document.getElementById("header-bcv-rate").innerText + "\n\n" +
    "*Apartamentos pendientes (" + pendientes.length + "):*\n" +
    pendientes.map(a => "• " + a.numero + " - " + a.propietario).join("\n");

  navigator.clipboard.writeText(texto).then(() => {
    alert("¡Lista de pendientes copiada al portapapeles! Puedes pegarla en el grupo de WhatsApp del condominio.");
  });
};

window.switchTab = function(tab) {
  const tabs = ['jornadas', 'apartamentos', 'tasas'];
  tabs.forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (t === tab) {
      el.classList.remove("hidden");
      btn.className = "tab-btn px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center space-x-2 transition-all duration-200 bg-blue-50 text-blue-700 shadow-sm shadow-blue-500/10 border border-blue-200/60";
    } else {
      el.classList.add("hidden");
      btn.className = "tab-btn px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold flex items-center space-x-2 transition-all duration-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100/80";
    }
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
};

window.initApp = initApp;

// Arrancar inmediatamente
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
