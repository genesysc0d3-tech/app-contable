import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getUsuario } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";
import { getDevSupportMode } from "@/lib/dev/support-mode";
import V5Root from "./V5Root";
import MpVueltaToast from "./MpVueltaToast";
import GlowWrap from "./GlowWrap";
import MesaController from "./MesaController";
import { fetchMesaDateDependent } from "./mesa-data";
import RcvViewWrapper from "./RcvViewWrapper";
import RegistrosToggleCard from "./RegistrosToggleCard";
import EmpresaBrand from "./EmpresaBrand";
import TeamBusinessPanel from "./TeamBusinessPanel";
import UsageCountersPanel from "./UsageCountersPanel";
import { EmisionDirectaAction, MassDTEAction, HeaderActionsRow, RCVButton } from "./LeftQuickActions";
import type { SearchItem } from "@/lib/tree-structure";
import { estadoEleccionEmpresa, listarEmpresasSelector, listarEquipoBusiness, listarResumenCupos } from "./actions";
import EleccionEmpresaModal from "./EleccionEmpresaModal";
import { chileDateString } from "@/lib/chile-date";
import type { BoletasEmisionProveedor, FacturasEmisionProveedor } from "../../empresa/actions";
import type { CAFRow } from "../../empresa/CAFPanel";

function mapBoletasProveedor(raw: string | null | undefined): BoletasEmisionProveedor {
  if (raw === "sii_local") return "sii_local";
  if (raw === "simpleapi") return "simpleapi";
  return "mock";
}

function mapFacturasProveedor(raw: string | null | undefined): FacturasEmisionProveedor {
  if (raw === "simpleapi") return "simpleapi";
  return "mock";
}

type BoletaRow = {
  id: string;
  folio: number | null;
  tipo_dte: number;
  fecha_emision: string;
  created_at?: string | null;
  receptor_rut?: string | null;
  receptor_razon_social: string | null;
  monto_total: number;
  estado: string;
};

type SearchData = Record<string, unknown>;

function searchData(value: unknown): SearchData {
  return value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : {};
}

export default async function V5Page({ searchParams }: {
  searchParams: Promise<{ date?: string; month?: string; view?: string; mesa?: string }>;
}) {
  // Perf F5: auth y modo soporte en paralelo (no dependen entre sí).
  const [sessionUsuarioRaw, support] = await Promise.all([getUsuario(), getDevSupportMode()]);
  const sessionUsuario = sessionUsuarioRaw!;
  const supportMode = support?.ok ? support : null;
  const usuario = supportMode
    ? ({ ...sessionUsuario, empresa_id: supportMode.empresaId, empresas: supportMode.empresa } as typeof sessionUsuario)
    : sessionUsuario;
  if (!usuario.empresas) notFound();
  const supportReadOnlyReason = supportMode ? "Modo soporte: solo lectura" : undefined;
  const empresaId = usuario.empresa_id;
  const boletasProveedor = mapBoletasProveedor(usuario.empresas.boletas_emision_proveedor ?? usuario.empresas.emision_proveedor);
  const facturasProveedor = mapFacturasProveedor(usuario.empresas.facturas_emision_proveedor);
  const { date: dateParam, month: monthParam, view, mesa: mesaQuery } = await searchParams;
  // Solo "factura" exacto abre esa mesa; cualquier otra cosa cae a boleta.
  const mesaParam: "boleta" | "factura" = mesaQuery === "factura" ? "factura" : "boleta";

  const supabase = supportMode ? supportMode.sb : await createClient();

  // Año/mes actuales EN CHILE (no UTC del server, que en Vercel corre): base
  // del mes RCV (resumen de ventas + visor), date-independiente del calendario.
  const nowChile = chileDateString(new Date());
  const curYear = Number(nowChile.slice(0, 4));
  const curMonth = Number(nowChile.slice(5, 7)) - 1; // 0-indexed

  // RCV: mes actual de Chile.
  const firstThisMonth = `${curYear}-${String(curMonth + 1).padStart(2, "0")}-01`;
  const firstNextMonth = curMonth === 11 ? `${curYear + 1}-01-01` : `${curYear}-${String(curMonth + 2).padStart(2, "0")}-01`;

  // Perf F5: TODO el bundle inicial va en UN solo Promise.all — antes eran 4
  // etapas seriales (mesa → clientes/cafs → 4 actions → rcv/búsqueda) que no
  // dependían entre sí: la latencia era la SUMA de las etapas; ahora es el MÁXIMO.
  // Grupos:
  //  - mesaInicial: bundle date-dependiente (panel derecho + calendario); el
  //    toggle día/semana/mes lo recarga client-side vía `cargarMesa` sin navegar.
  //  - clientes + CAFs: date-independientes, se cargan una vez.
  //  - 4 server actions de cuenta (selector de empresas, equipo, cupos, elección).
  //  - RCV del mes + triple de búsqueda/historial (últimos 100 c/u).
  const [
    mesaInicial,
    [clData, cafsData],
    [empresasSelector, equipoBusiness, resumenCupos, eleccionEmpresa],
    [boletasRcvRes, searchTriple],
  ] = await Promise.all([
    fetchMesaDateDependent(supabase, empresaId, {
      giro: usuario.empresas.giro,
      razon_social: usuario.empresas.razon_social,
      tipo_contribuyente: usuario.empresas.tipo_contribuyente,
    }, { date: dateParam, month: monthParam, view, mesa: mesaParam }),
    Promise.all([
      supabase.from("clientes").select("id,nombre,rut").eq("empresa_id", empresaId).order("nombre",{ascending:true}),
      supabase.from("boletas_caf_mock")
        .select("id, tipo_dte, folio_desde, folio_hasta, folio_actual, estado, fecha_vence")
        .eq("empresa_id", empresaId).order("fecha_solicitud", { ascending: false }),
    ]),
    Promise.all([
      listarEmpresasSelector(),
      listarEquipoBusiness(),
      listarResumenCupos(),
      estadoEleccionEmpresa(),
    ]),
    Promise.all([
    supabase.from("boletas_emitidas")
      .select("id,folio,tipo_dte,fecha_emision,created_at,receptor_rut,receptor_razon_social,monto_total,estado")
      .eq("empresa_id", empresaId)
      .gte("fecha_emision", firstThisMonth)
      .lt("fecha_emision", firstNextMonth)
      .order("fecha_emision",{ascending:false})
      .order("folio",{ascending:false})
      .limit(1000),
    Promise.all([
      supabase.from("documentos_subidos").select("id,nombre_archivo,tipo,estado,movimientos_detectados,created_at,progreso_ia,tipo_operacion_hint,glosa_comun,glosa_activa,medio_pago_comun")
        .eq("empresa_id", empresaId).order("created_at",{ascending:false}).limit(100),
      supabase.from("boletas_emitidas").select("id,folio,tipo_dte,fecha_emision,created_at,receptor_rut,receptor_razon_social,monto_total,estado")
        .eq("empresa_id", empresaId).order("fecha_emision",{ascending:false}).order("folio",{ascending:false}).limit(100),
      // Perf F5: columnas EXACTAS que consume SearchHistoryView (antes iba
      // select * + movimientos_raw(*) + join a documentos_subidos que la vista
      // ni miraba — cientos de KB de RSC payload al pedo por cada F5).
      supabase.from("propuestas_ia").select("id,created_at,confianza,estado,tipo_dte,movimientos_raw(fecha,monto,descripcion,n_documento,tipo_flujo)")
        .eq("empresa_id", empresaId).order("created_at",{ascending:false}).limit(100),
      ]),
    ]),
  ]);

  const empresaLogoUrl = `/api/empresa/logo/${empresaId}`;
  const empresasSelectorItems = empresasSelector.ok ? empresasSelector.empresas : [];
  const cuentaMultiempresa = empresasSelector.ok ? empresasSelector.multiempresa : false;
  const cuentaPuedeAgregar = empresasSelector.ok ? empresasSelector.puedeAgregar : false;
  const esRcvExento = usuario.empresas.tipo_contribuyente === "exento";
  const boletasRcvData = boletasRcvRes.data;
  const [searchDocsData, searchBoletasData, searchPropsData] = searchTriple;

  // Search & history items
  const searchHistoryItems: SearchItem[] = [];
  for (const doc of (searchDocsData.data ?? []).slice(0, 100)) {
    searchHistoryItems.push({
      id: "doc-" + doc.id, label: doc.nombre_archivo,
      subtitle: (doc.movimientos_detectados ?? 0) + " movimientos · " + doc.estado,
      type: "documento", fecha: doc.created_at, data: searchData(doc),
    });
  }
  for (const bol of (searchBoletasData.data ?? []).slice(0, 100)) {
    const fechaRegistro = bol.created_at ?? bol.fecha_emision;
    searchHistoryItems.push({
      id: "bol-" + bol.id,
      label: "Boleta #" + bol.folio + " · " + (bol.receptor_razon_social ?? "—"),
      subtitle: (bol.tipo_dte === 39 ? "AFECTA" : "EXENTA") + " · $" + Math.round(bol.monto_total).toLocaleString("es-CL"),
      type: "boleta", fecha: fechaRegistro, monto: bol.monto_total, data: searchData(bol),
    });
  }
  for (const prop of (searchPropsData.data ?? []).slice(0, 100)) {
    searchHistoryItems.push({
      id: "prop-" + prop.id,
      label: "Propuesta · " + (prop.movimientos_raw?.descripcion ?? "—"),
      subtitle: "Confianza " + Math.round((prop.confianza ?? 0) * 100) + "%",
      type: "propuesta", fecha: prop.created_at, data: searchData(prop),
    });
  }
  searchHistoryItems.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

  // RCV content for right column
  const rcvContent = (
    <RcvViewWrapper boletas={(boletasRcvData ?? []) as BoletaRow[]} boletasYear={curYear} boletasMonth={curMonth} initialYear={mesaInicial.calendar.y} initialMonth={mesaInicial.calendar.m} />
  );

  const dashboardContent = (
    <>
      <style>{`
*{margin:0;padding:0;box-sizing:border-box}
.ep-glow-card{transition:box-shadow 600ms cubic-bezier(0.22,1,0.36,1)}
.ep-glow-card:hover{box-shadow:0 0 40px -8px rgba(232,85,62,0.40)!important}
.app{display:grid;grid-template-columns:minmax(0,2.3fr) minmax(0,7.7fr);max-width:1400px;margin:0 auto;gap:20px;height:calc(100vh - 94px);padding:0 0;position:relative;background:transparent;min-height:0;overflow:visible}
/* Móvil/tablet: una sola columna apilada con scroll vertical; el panel de
   trabajo (tabs) conserva una altura útil propia. */
@media (max-width: 900px){
  .app{grid-template-columns:1fr;height:auto;gap:14px;padding:0 10px 24px}
  .app .left-col{padding-left:0!important}
  .app > :last-child{height:78vh;min-height:480px}
}
.v5-calendar-wrap,.left-col{transition:opacity .28s cubic-bezier(.22,1,.36,1),transform .28s cubic-bezier(.22,1,.36,1)}
:root.v5-dashboard-fullscreen .v5-calendar-wrap{opacity:0;transform:translateY(-8px);pointer-events:none}
:root.v5-dashboard-fullscreen .left-col{opacity:0;transform:translateX(-10px);pointer-events:none}
/* Los HIJOS también: la tarjeta interior del calendario re-activa pointer-events
   inline (pointerEvents:"auto", necesario en modo normal por el aire del wrap) y
   en fullscreen el calendario INVISIBLE seguía comiendo clicks — en pantallas
   angostas quedaba encima de "Volver a dashboard" y el botón parecía roto. */
:root.v5-dashboard-fullscreen .v5-calendar-wrap *{pointer-events:none!important}
:root.v5-dashboard-fullscreen .left-col *{pointer-events:none!important}
.left-glass{background:rgba(255,255,255,.5);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid var(--border);border-radius:20px;box-shadow:inset 0 1px 0 var(--border),0 8px 32px var(--shadow)}
.dark .left-glass{background:rgba(255,255,255,.03)}
.panel-hd-txt .plantilla{margin-left:auto;display:flex;align-items:center;gap:3px;padding:4px 8px;border-radius:5px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:9px;font-weight:500;cursor:pointer;white-space:nowrap;transition:all .15s}
.panel-hd-txt .plantilla:hover{background:var(--bg-muted);color:var(--text)}
.panel-hd-txt .plantilla svg{width:11px;height:11px}
.e-scroll{overflow-y:auto;flex:1;scrollbar-width:none}
.e-scroll::-webkit-scrollbar{display:none}
.e-scroll .sec{padding:10px 16px}
.e-scroll .sec:first-child{padding-top:14px}
.e-scroll .sec:last-child{padding-bottom:14px}
.dz{padding:14px;border-radius:10px;border:1.5px dashed var(--border);display:flex;align-items:center;gap:10px;cursor:pointer;transition:all .2s}
.dz:hover{border-color:color-mix(in srgb,var(--lime) 30%,transparent);background:color-mix(in srgb,var(--lime) 2%,transparent)}
.dz:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-color:color-mix(in srgb,var(--lime) 40%,transparent)}
.dz-icon{width:32px;height:32px;border-radius:8px;background:color-mix(in srgb,var(--lime) 6%,transparent);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.dz-icon svg{width:16px;height:16px;color:var(--lime)}
/* Acciones de cada archivo en cola (renombrar / quitar). Antes eran 16px con
   fuente 8: casi invisibles y difíciles de apuntar. */
.dz-icon-btn{width:28px;height:28px;border-radius:7px;border:none;cursor:pointer;font-size:14px;line-height:1;background:transparent;color:var(--text2);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s,color .15s}
.dz-icon-btn:hover{background:var(--bg-muted);color:var(--text)}
.dz-icon-btn:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
/* Botón de contexto para la IA. El degradado se ancla en el rojo de marca: un
   arcoíris genérico se ve pegado de otra app. */
.dz-ia-btn{box-shadow:0 0 0 0 transparent;display:inline-flex;align-items:center;gap:5px;font-size:10px;font-weight:600;padding:5px 9px;border-radius:7px;white-space:nowrap;cursor:pointer;border:1px solid color-mix(in srgb,#A78BFA 30%,transparent);background:color-mix(in srgb,#A78BFA 7%,transparent);color:var(--text2);flex-shrink:0;transition:border-color .15s,background .15s,box-shadow .25s}
.dz-ia-btn:hover{border-color:color-mix(in srgb,#A78BFA 55%,transparent);background:color-mix(in srgb,#A78BFA 14%,transparent);box-shadow:0 0 16px -4px rgba(167,139,250,.55)}
.dz-ia-btn:focus-visible{outline:2px solid #A78BFA;outline-offset:1px}
.dz-ia-btn.puesto{border-color:color-mix(in srgb,#A78BFA 55%,transparent);background:color-mix(in srgb,#A78BFA 14%,transparent);color:#C4B5FD}
.dz-ia-sp{font-size:10px;background:linear-gradient(90deg,#E8553E,#F59E0B,#A78BFA,#60A5FA);-webkit-background-clip:text;background-clip:text;color:transparent}
/* Loop sin costura: el degradado arranca y termina en el MISMO color (el tile
   calza consigo mismo), el tile mide 160px fijos, y la animación desplaza
   exactamente esos 160px. Con background-position en % el navegador lo calcula
   contra (ancho caja - ancho imagen), que es negativo cuando la imagen es más
   ancha — por eso el salto no caía en el tile y se veía el corte. */
.dz-ia-word{font-weight:800;letter-spacing:.02em;background-image:linear-gradient(90deg,#E8553E,#F59E0B,#A78BFA,#60A5FA,#A78BFA,#F59E0B,#E8553E);background-size:160px 100%;background-repeat:repeat;-webkit-background-clip:text;background-clip:text;color:transparent;animation:dz-ia-corre 5s linear infinite}
@keyframes dz-ia-corre{from{background-position:0 0}to{background-position:160px 0}}
@media (prefers-reduced-motion:reduce){.dz-ia-word{animation:none}}

/* Popup de contexto. Calca el overlay del modal de la app (.ed-overlay/.ed-panel):
   mismo velo con blur, mismo radio de 20px, misma superficie. */
.dz-ctx-velo{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.58);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);animation:dzFadeIn .2s ease both}
.dz-ctx{width:min(440px,96vw);max-height:88vh;overflow-y:auto;padding:20px;border-radius:20px;border:1px solid var(--border);background:var(--surface);box-shadow:0 30px 90px rgba(0,0,0,.45);animation:dzPopIn .22s cubic-bezier(.2,.8,.3,1) both,dzGlow 7s linear infinite}
@keyframes dzFadeIn{from{opacity:0}to{opacity:1}}
@keyframes dzPopIn{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
/* Glow arcoíris: el color viaja por fuera del popup, pero el BORDE se queda
   neutro como el resto de la app (el contorno de colores se veía cargado).
   Cierra en el color inicial para que el ciclo no tenga salto. La sombra negra se repite en cada
   paso porque la animación reemplaza el box-shadow completo. */
@keyframes dzGlow{
0%{box-shadow:0 30px 90px rgba(0,0,0,.45),0 0 52px -6px rgba(232,85,62,.5)}
25%{box-shadow:0 30px 90px rgba(0,0,0,.45),0 0 52px -6px rgba(245,158,11,.5)}
50%{box-shadow:0 30px 90px rgba(0,0,0,.45),0 0 52px -6px rgba(167,139,250,.55)}
75%{box-shadow:0 30px 90px rgba(0,0,0,.45),0 0 52px -6px rgba(96,165,250,.5)}
100%{box-shadow:0 30px 90px rgba(0,0,0,.45),0 0 52px -6px rgba(232,85,62,.5)}}
@media (prefers-reduced-motion:reduce){.dz-ctx-velo{animation:none}.dz-ctx{animation:none;box-shadow:0 30px 90px rgba(0,0,0,.45),0 0 46px -8px rgba(167,139,250,.5)}}
.dz-ctx h4{font-size:14px;font-weight:700;margin:0 0 4px;color:var(--text)}
.dz-ctx-ph{font-size:11.5px;color:var(--text2);margin:0 0 12px;line-height:1.45}
.dz-ctx-ph b{color:var(--text)}
.dz-ctx-chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:11px}
.dz-ctx-chip{font-size:10px;padding:5px 10px;border-radius:14px;border:1px solid var(--border);background:transparent;color:var(--text2);cursor:pointer;transition:border-color .15s,background .15s,color .15s}
.dz-ctx-chip:hover{border-color:color-mix(in srgb,#A78BFA 45%,transparent);color:var(--text)}
.dz-ctx-chip.on{border-color:color-mix(in srgb,#A78BFA 45%,transparent);background:color-mix(in srgb,#A78BFA 13%,transparent);color:#C4B5FD}
.dz-ctx-ta{width:100%;min-height:74px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 11px;color:var(--text);font-size:11.5px;line-height:1.55;font-family:inherit;resize:none;transition:border-color .15s}
.dz-ctx-ta:focus{outline:none;border-color:color-mix(in srgb,#A78BFA 45%,transparent)}
.dz-ctx-cta{font-size:10px;color:var(--text3);margin-top:7px}
.dz-ctx-cta b{color:var(--text2)}
.dz-ctx-priv{display:flex;gap:7px;font-size:10px;color:var(--text3);margin-top:10px;line-height:1.45}
.dz-ctx-priv b{color:var(--text2)}
/* Switch calcado del "Detalle" del visor (GlosaComunControl): 26x15 con la
   bolita que se corre. Es una preferencia, no una selección — por eso switch y
   no checkbox. La bolita se mueve con transform: justify-content NO anima,
   salta de un lado al otro. */
.dz-ctx-sw{display:inline-flex;align-items:center;gap:8px;margin-top:12px;border:none;background:transparent;cursor:pointer;font-size:10.5px;font-weight:600;color:var(--text3);padding:0;font-family:inherit;transition:color .2s ease}
.dz-ctx-sw.on{color:#C4B5FD}
.dz-ctx-sw:focus-visible{outline:2px solid #A78BFA;outline-offset:3px;border-radius:4px}
.dz-ctx-sw-track{width:26px;height:15px;border-radius:999px;padding:2px;background:var(--bg-muted);border:1px solid var(--border);display:inline-flex;align-items:center;justify-content:flex-start;transition:background .22s ease,border-color .22s ease,box-shadow .22s ease;flex-shrink:0}
.dz-ctx-sw.on .dz-ctx-sw-track{background:color-mix(in srgb,#A78BFA 35%,transparent);border-color:color-mix(in srgb,#A78BFA 45%,transparent);box-shadow:0 0 12px -2px rgba(167,139,250,.5)}
.dz-ctx-sw-knob{width:11px;height:11px;border-radius:50%;background:var(--text3);transition:transform .22s cubic-bezier(.34,1.4,.5,1),background .22s ease}
.dz-ctx-sw.on .dz-ctx-sw-knob{transform:translateX(9px);background:#A78BFA}
@media (prefers-reduced-motion:reduce){.dz-ctx-sw-knob{transition:background .22s ease}}
.dz-ctx-pie{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.dz-ctx-b{font-size:11.5px;font-weight:600;padding:9px 16px;border-radius:10px;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text2);transition:background .15s,color .15s}
.dz-ctx-b:hover{background:var(--bg-muted);color:var(--text)}
.dz-ctx-b.p{background:linear-gradient(135deg,#8B5CF6,#6366F1);color:#fff;border:none}
.dz-ctx-b.p:hover{filter:brightness(1.1)}
.dz-txt h4{font-size:12px;font-weight:600}
.dz-txt p{font-size:10px;color:var(--text2);margin-top:1px}
.dz-fmts{display:flex;align-items:center;gap:5px;margin-top:5px;font-size:9px;color:var(--text3);flex-wrap:wrap}
.dz-fmts .f{display:flex;align-items:center;gap:2px;color:var(--text3);line-height:1}
.doc-card{background:var(--bg-muted);border:1px solid var(--border);border-radius:10px;overflow:hidden;transition:all .15s}
.doc-card:hover{border-color:var(--text3)}
.dh{display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:pointer}
.dh:hover{background:var(--bg-muted)}
.dh .dt{width:4px;height:4px;border-radius:50%;flex-shrink:0}
.dh .nm{flex:1;font-size:11px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dh .st{font-size:9px;font-weight:600}.dh .st.ls{color:var(--green)}.dh .st.pc{color:var(--blue)}.dh .st.er{color:var(--red)}.dh .st.pd{color:var(--amber)}
.dh .mt{font-size:9px;color:var(--text2);flex-shrink:0}
.db{padding:0 10px 8px;display:flex;flex-direction:column;gap:4px}
.da{display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:2px 0}
.da button{font-size:9px;padding:3px 8px;border-radius:5px;border:none;cursor:pointer;font-weight:500;display:flex;align-items:center;gap:4px;transition:all .15s}
.da .ht{background:rgba(245,158,11,.06);color:var(--amber);font-size:8px}
.da .ud{background:rgba(239,68,68,.06);color:var(--red);font-size:8px}
.da .mp{background:rgba(180,240,39,.06);color:var(--lime);font-size:8px}
.da .cl{background:rgba(239,68,68,.06);color:var(--red);font-size:8px}
.da button:hover{filter:brightness(1.2)}
.om-btn{display:flex;align-items:center;gap:4px;font-size:9px;color:var(--amber);background:none;border:none;cursor:pointer;padding:2px 4px;border-radius:4px;transition:all .15s}
.om-btn:hover{background:rgba(245,158,11,.06)}
.om-list{display:flex;flex-direction:column;gap:2px;padding:2px 0}
.om-it{display:flex;align-items:center;gap:6px;padding:4px 6px;font-size:9px;color:var(--text2);border-radius:4px}
.om-it:hover{background:var(--bg-muted)}
.om-it .dt{width:3px;height:3px;border-radius:50%;background:var(--amber);flex-shrink:0}
.om-it .nm{flex:1;color:var(--text2)}
.om-it .ifo{color:var(--text3);font-size:8px}
.warn{padding:6px 8px;border-radius:6px;background:rgba(245,158,11,.04);border:1px solid rgba(245,158,11,.08);font-size:9px;color:var(--amber);display:flex;align-items:flex-start;gap:4px;line-height:1.4}
.pr{display:flex;flex-direction:column;gap:2px}
.prh{display:flex;justify-content:space-between;font-size:9px;color:var(--text2)}
.prh span:last-child{color:var(--accent);font-weight:600}
.prb{height:3px;overflow:hidden;border-radius:3px;background:var(--border)}
.prf{height:100%;border-radius:3px;background:var(--accent);position:relative;transition:width .7s ease-out}
.prs{position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.15),transparent);animation:sh 2s infinite}
@keyframes sh{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.prl{font-size:8px;color:var(--text2);display:flex;align-items:center;gap:3px}
.prl .pd{width:4px;height:4px;border-radius:50%;background:var(--accent);animation:pl 1.5s infinite}
@keyframes pl{0%{opacity:1}50%{opacity:.3}100%{opacity:1}}
.hist-btn{width:100%;display:flex;align-items:center;justify-content:space-between;padding:6px 0;border:none;background:none;cursor:pointer;font-size:10px;font-weight:600;color:var(--text);border-top:1px solid var(--bg-muted);transition:all .15s}
.hist-btn:hover{color:var(--lime)}
.btn-cancel{padding:8px 14px;border:none;border-radius:8px;background:var(--surface2);font-size:10px;font-weight:600;color:var(--text2);cursor:pointer;transition:all .2s}
.btn-cancel:hover{background:var(--surface);color:var(--text)}
.ac-row{display:flex;gap:6px;justify-content:flex-end}
.cal{padding:12px 16px;border-bottom:1px solid var(--bg-muted);flex-shrink:0}
.cal-h{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.cal-h .m{font-size:11px;font-weight:600;color:var(--text)}
.cal-h .nv{font-size:9px;color:var(--text2);cursor:pointer;padding:2px 4px;border-radius:3px;text-decoration:none}
.cal-h .nv:hover{color:var(--text);background:var(--bg-muted)}
.cal-h .cl{font-size:9px;color:var(--text2);cursor:pointer;margin-left:auto;padding:2px 6px;border-radius:3px;text-decoration:none}
.cal-h .cl:hover{color:var(--lime);background:color-mix(in srgb,var(--lime) 6%,transparent)}
.cal-days{display:flex;gap:1px;overflow-x:auto;scrollbar-width:none}
.cal-days::-webkit-scrollbar{display:none}
.cal-day{width:26px;padding:3px 0;display:flex;flex-direction:column;align-items:center;border-radius:4px;cursor:pointer;text-decoration:none;color:var(--text2);transition:all .15s}
.cal-day:hover{background:var(--bg-muted)}
.cal-day .wd{font-size:6px;text-transform:uppercase;line-height:1;color:var(--text3)}
.cal-day .d{font-size:10px;font-weight:500;line-height:1;margin-top:1px}
.cal-day.today .d{color:var(--lime);font-weight:700}
.cal-day.sel{background:var(--lime);color:#fff}
.cal-day.sel .wd{color:rgba(255,255,255,.6)}
.cal-day.sel .d{color:#fff}
.dark .cal-day.sel{color:#000}
.dark .cal-day.sel .wd{color:rgba(0,0,0,.5)}
.dark .cal-day.sel .d{color:#000}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--bg-muted);flex-shrink:0}
.topbar-l{display:flex;align-items:center;gap:8px}
.topbar-l .dot{width:7px;height:7px;border-radius:50%;background:var(--lime);box-shadow:0 0 8px rgba(180,240,39,.4)}
.topbar-l h1{font-size:12px;font-weight:600}
.topbar-r{display:flex;align-items:center;gap:12px}
.topbar-r .stat{display:flex;align-items:baseline;gap:4px}
.topbar-r .stat .num{font-size:16px;font-weight:300}
.topbar-r .stat .lbl{font-size:10px;color:var(--text2)}
.topbar-r .sep{color:var(--text3);font-size:9px}
.topbar-r .date{font-size:10px;color:var(--text2)}
.tab-bar{display:flex;gap:3px;padding:10px 16px;border-bottom:1px solid var(--bg-muted);flex-shrink:0}
.r-tab-content{display:none;flex-direction:column;overflow:hidden;min-height:0}
.r-tab-content.act{display:flex}
.r-scroll{overflow-y:auto;flex:1;min-height:0;scrollbar-width:none}
.r-scroll::-webkit-scrollbar{display:none}
.dtabs{display:flex;gap:4px;padding:8px 16px;border-bottom:1px solid var(--bg-muted);overflow-x:auto;scrollbar-width:none;flex-shrink:0}
.dtabs::-webkit-scrollbar{display:none}
.dtab{padding:4px 10px;border-radius:6px;border:1px solid var(--bg-muted);cursor:pointer;font-size:9px;white-space:nowrap;background:transparent;color:var(--text2);display:flex;align-items:center;gap:4px;transition:all .15s;flex-shrink:0}
.dtab:hover{border-color:rgba(0,0,0,.14);color:var(--text)}
.dark .dtab:hover{border-color:rgba(255,255,255,.1)}
.dtab.act{border-color:var(--accent);background:var(--accent-light);color:var(--accent)}
.dtab .cnt{font-size:7px;padding:1px 4px;border-radius:4px;background:var(--accent-light);color:var(--accent);font-weight:700;line-height:1}
.r-scroll .sec{padding:6px 16px}
.r-scroll .sec:first-child{padding-top:10px}
.r-scroll .sec:last-child{padding-bottom:10px}
.em-header{display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--border)}
.em-header .big{font-size:22px;font-weight:600;letter-spacing:-.02em;color:var(--text)}
.em-header .lbl{font-size:11px;color:var(--text2)}
.em-header .blk{font-size:10px;padding:2px 8px;border-radius:12px;background:rgba(245,158,11,.1);color:var(--amber);display:flex;align-items:center;gap:3px}
.em-header .rf{width:26px;height:26px;border-radius:7px;border:1px solid var(--border);cursor:pointer;display:flex;align-items:center;justify-content:center;background:var(--bg-muted);color:var(--text2);font-size:13px;margin-left:auto}
.em-header .rf:hover{background:var(--surface2);color:var(--text)}
.em-pills{display:flex;align-items:center;gap:4px;flex-wrap:wrap}
.em-pills .pl{font-size:10px;height:24px;padding:0 12px 2px;border-radius:999px;border:1px solid transparent;cursor:pointer;font-weight:600;display:inline-flex;align-items:center;box-sizing:border-box;transition:all .15s}
.em-pills .pl.act{background:var(--surface2);color:var(--text);border-color:var(--border)}
.em-pills .pl.ina{background:transparent;color:var(--text2)}
.em-pills .pl.ina:hover{background:var(--bg-muted);color:var(--text)}
.em-pills .sc{font-size:10px;color:var(--text2);display:flex;align-items:center;gap:5px;margin-left:auto;padding:4px 8px;border-radius:7px;cursor:pointer}
.em-pills .sc:hover{background:var(--bg-muted)}
.em-grid{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.em-grid.cols2{display:grid;grid-template-columns:1fr 1fr;gap:6px 16px}
.em-item{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:10px;border:1px solid var(--border);background:var(--bg-muted);transition:border-color .15s,background .15s}
.em-item:hover{border-color:var(--text3)}
.em-item.sel{border-color:var(--accent);background:var(--accent-light)}
.em-item.dis{opacity:.7;border-color:rgba(245,158,11,.22);background:rgba(245,158,11,.04);cursor:not-allowed}
.em-item .cb{width:18px;height:18px;border-radius:5px;border:1.5px solid var(--text2);cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:var(--surface2);color:#fff;font-size:11px;transition:all .15s}
.em-item .cb.sel{background:var(--accent);border-color:var(--accent)}
.em-item .cb.dis{cursor:not-allowed;opacity:.3}
.em-item .inf{flex:1;min-width:0}
.em-item .inf .tt{font-size:11px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.em-item .inf .sub{font-size:10px;color:var(--text2);margin-top:2px}
.em-item .inf .sub.rn{color:var(--amber);font-size:9px;font-weight:500;display:flex;align-items:center;gap:4px;margin-top:4px}
.em-item .mo{font-size:12px;font-weight:600;color:var(--text);text-align:right;min-width:84px;font-variant-numeric:tabular-nums}
.em-bar{position:sticky;bottom:0;padding:12px 16px;background:var(--surface);border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:10px;z-index:2;box-shadow:0 -8px 24px var(--shadow)}
.em-bar .l{font-size:11px;color:var(--text2)}
.em-bar .l .b{font-weight:600;color:var(--text)}
.em-bar .r button{font-size:13px;padding:10px 20px;border-radius:10px;border:none;cursor:pointer;font-weight:700;display:flex;align-items:center;gap:6px;min-height:38px;transition:all .15s}
.em-bar .r .emit{background:var(--accent);color:#fff}
.em-bar .r .emit:hover{filter:brightness(1.08)}
.em-bar .r .emit:disabled{opacity:.4;cursor:not-allowed}
.em-bar .r .emit .sp{width:12px;height:12px;border:2px solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;animation:sp .5s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
.em-empty{text-align:center;padding:24px 16px}
.em-empty .ic{width:40px;height:40px;border-radius:10px;background:var(--bg-muted);display:flex;align-items:center;justify-content:center;margin:0 auto 8px;color:var(--text2)}
.em-empty .ic svg{width:18px;height:18px}
.em-empty h4{font-size:12px;font-weight:500;margin-bottom:4px}
.em-empty p{font-size:10px;color:var(--text2);max-width:280px;margin:0 auto;line-height:1.4}
.em-empty .wrn{margin-top:8px;padding:8px 10px;border-radius:6px;background:rgba(245,158,11,.04);border:1px solid rgba(245,158,11,.08);font-size:9px;color:var(--amber);text-align:left;line-height:1.4}
`}</style>

      <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", color: "var(--text)", minHeight: "100vh", padding: "20px 20px 20px" }}>

        {/* MESA: calendario (toggle sin navegar) + columnas izquierda/derecha */}
        <MesaController
          // key por empresa: al cambiar de empresa activa (cuentas multiempresa),
          // fuerza remount para re-sembrar el estado client-held y el cache de rangos
          // (router.refresh NO re-siembra la mesa) — evita mostrar datos de la empresa
          // anterior en Check/Emitir/Boletas.
          key={`${empresaId}:${mesaParam}`}
          initialMesa={mesaInicial}
          empresaId={empresaId}
          empresaGiro={usuario.empresas.giro}
          empresaRazon={usuario.empresas.razon_social}
          empresaTipo={usuario.empresas.tipo_contribuyente}
          clientes={clData.data ?? []}
          rcvContent={rcvContent}
          searchHistoryItems={searchHistoryItems}
          empresaNombre={usuario.empresas.razon_social}
          empresaLogoUrl={empresaLogoUrl}
          brandSlot={<div key="brand" style={{position:"absolute",left:0,top:0,height:38,width:137,display:"flex",alignItems:"center",justifyContent:"flex-start",minWidth:0,overflow:"visible",zIndex:"auto",pointerEvents:"none"}}><span style={{pointerEvents:"auto",display:"flex",alignItems:"center",minWidth:0}}><EmpresaBrand nombre={usuario.empresas.razon_social} logoUrl={empresaLogoUrl} empresas={empresasSelectorItems} multiempresa={cuentaMultiempresa} puedeAgregar={cuentaPuedeAgregar} size={38} maxWidth={137} mesa={mesaParam} empresaRut={usuario.empresas.rut} /></span></div>}
          actionsSlot={<div key="actions" style={{position:"absolute",right:0,top:0,height:38,width:178,display:"flex",justifyContent:"flex-end",minWidth:0,zIndex:2,pointerEvents:"none"}}><span style={{pointerEvents:"auto",display:"flex",alignItems:"center"}}><HeaderActionsRow /></span></div>}
          leftColumn={
          <div key="left" className="left-col" style={{display:"flex",flexDirection:"column",gap:10,overflow:"visible",minHeight:0,scrollbarWidth:"none",paddingLeft:8}}>

            {/* REGISTROS — arriba de TODAS las cards (actividad + ventas) */}
            <RegistrosToggleCard
              esRcvExento={esRcvExento}
              ventasDocs={mesaInicial.ventasDocs}
              ventasTotal={mesaInicial.ventasTotal}
              actividadCount={mesaInicial.actividadItems.length}
              actividadUltimo={mesaInicial.actividadItems[0]?.descripcion}
              periodo={mesaInicial.calendar.selectedDateLabel}
            />

            {/* EMITIR PANEL — massDTE arriba de boleta única */}
             <GlowWrap glow style={{borderRadius:16,overflow:"visible"}}><div style={{background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"inset 0 1px 0 var(--border),0 8px 32px var(--shadow)"}}>
              <MassDTEAction empresaId={empresaId} readOnlyReason={supportReadOnlyReason} mesa={mesaParam} />
            </div></GlowWrap>
             {mesaParam === "factura" && <GlowWrap glow style={{borderRadius:16,overflow:"visible"}}><div style={{background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"inset 0 1px 0 var(--border),0 8px 32px var(--shadow)"}}>
              <EmisionDirectaAction
                mesa="factura"
                empresaTipo={usuario.empresas.tipo_contribuyente}
                empresaId={empresaId}
                empresaRut={usuario.empresas.rut}
                empresaRazonSocial={usuario.empresas.razon_social}
                empresaGiro={usuario.empresas.giro}
                empresaDireccion={usuario.empresas.direccion}
                empresaComuna={usuario.empresas.comuna}
                readOnlyReason={supportReadOnlyReason}
              />
            </div></GlowWrap>}
             {mesaParam === "boleta" && <GlowWrap glow style={{borderRadius:16,overflow:"visible"}}><div style={{background:"var(--surface)",borderRadius:16,border:"1px solid var(--border)",display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"inset 0 1px 0 var(--border),0 8px 32px var(--shadow)"}}>
              <EmisionDirectaAction
                empresaTipo={usuario.empresas.tipo_contribuyente}
                empresaId={empresaId}
                emisionProveedor={boletasProveedor}
                facturasProveedor={facturasProveedor}
                devMode={usuario.dev_mode === true}
                empresaRut={usuario.empresas.rut}
                empresaRazonSocial={usuario.empresas.razon_social}
                empresaGiro={usuario.empresas.giro}
                empresaDireccion={usuario.empresas.direccion}
                empresaComuna={usuario.empresas.comuna}
                readOnlyReason={supportReadOnlyReason}
              />
            </div></GlowWrap>}
            <div style={{display:"none"}}><RCVButton /></div>
            {equipoBusiness.ok && equipoBusiness.equipo && (
              <TeamBusinessPanel
                cuentaId={equipoBusiness.cuentaId}
                usuarioId={equipoBusiness.usuarioId}
                empresaActivaId={equipoBusiness.empresaActivaId}
                empresaActivaNombre={equipoBusiness.empresaActivaNombre}
                personas={equipoBusiness.personas}
              />
            )}

            {/* USO DEL MES — al final, debajo de todas las cards */}
            {resumenCupos.ok && <UsageCountersPanel resumen={resumenCupos.resumen} />}
          </div>
          }
        />
      </div>
    </>
  );

  return (
    <>
    <Suspense fallback={null}><MpVueltaToast /></Suspense>
    {eleccionEmpresa.pendiente && (
      <EleccionEmpresaModal esTitular={eleccionEmpresa.esTitular} empresas={eleccionEmpresa.empresas} />
    )}
    <V5Root
      dashboardContent={dashboardContent}
      empresaInicial={{ rut: usuario.empresas.rut, razon_social: usuario.empresas.razon_social, giro: usuario.empresas.giro, direccion: usuario.empresas.direccion, comuna: usuario.empresas.comuna, email_sii: usuario.empresas.email_sii, tipo_contribuyente: usuario.empresas.tipo_contribuyente ?? "auto", operacion_hint_default: usuario.empresas.operacion_hint_default ?? null }}
      empresaCafs={(cafsData.data ?? []) as CAFRow[]}
      empresaId={empresaId}
      empresaEmisionConfig={{ boletasProveedor, facturasProveedor, baseapiSandbox: false }}
      devMode={usuario.dev_mode === true}
    />
    </>
  );
}
