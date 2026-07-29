"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import { useToast } from "@/components/Toast";
import { setEmisionConfig, type BoletasEmisionProveedor, type FacturasEmisionProveedor } from "./actions";
import { EXTENSION_ZIP_DOWNLOAD_PROPS, EXTENSION_VERSION_ACTUAL } from "@/lib/extension";

export interface EmissionProviderState {
  boletasProveedor: BoletasEmisionProveedor;
  facturasProveedor: FacturasEmisionProveedor;
  baseapiSandbox: boolean;
}

type ExtensionStatus = "checking" | "ready" | "missing";

type SimpleApiVaultStatus = {
  configured: boolean;
  encrypted: boolean;
  has_pfx: boolean;
  has_caf: boolean;
  updated_at: string | null;
  unlocked?: boolean;
  unlocked_until?: string | null;
};

type ExtensionWindowMessage = {
  source?: string;
  type?: string;
  extension_version?: string;
  capabilities?: string[];
  nonce?: string;
  status?: SimpleApiVaultStatus;
  ok?: boolean;
  error?: string | null;
};

export default function EmissionProviderConfig({
  inicial,
  devMode = false,
  onProveedorChange,
}: {
  inicial: EmissionProviderState;
  devMode?: boolean;
  onProveedorChange?: (p: { boletas: string; facturas: string }) => void;
}) {
  const { toast } = useToast();
  const [state, setState] = useState(inicial);
  const [pending, start] = useTransition();
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus>("checking");
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null);
  const [vaultStatus, setVaultStatus] = useState<SimpleApiVaultStatus | null>(null);
  const [confirmReal, setConfirmReal] = useState<{ grupo: "boletas" | "facturas"; proveedor: BoletasEmisionProveedor | FacturasEmisionProveedor } | null>(null);
  // Capturado al montar (useState con inicializador: legal en render, a diferencia
  // de leer un ref) — la opción "Modo de prueba" no desaparece dentro de la sesión.
  const [inicialAlMontar] = useState(inicial);
  const pingRef = useRef<{ nonce: string; timeoutId: number } | null>(null);

  function requestVaultStatus() {
    window.postMessage({ source: "app-contable", type: "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS", protocol_version: 1 }, window.location.origin);
  }

  function sendPing() {
    if (pingRef.current) window.clearTimeout(pingRef.current.timeoutId);
    const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
    const timeoutId = window.setTimeout(() => setExtensionStatus((current) => current === "checking" ? "missing" : current), 1200);
    pingRef.current = { nonce, timeoutId };
    window.postMessage({ source: "app-contable", type: "APP_CONTABLE_EXTENSION_PING", protocol_version: 1, nonce }, window.location.origin);
  }

  useEffect(() => {
    function onMessage(event: MessageEvent<ExtensionWindowMessage>) {
      if (event.source !== window) return;
      const data = event.data;
      if (data?.source !== "app-contable-extension") return;

      if (data.type === "APP_CONTABLE_EXTENSION_PONG" && pingRef.current && data.nonce === pingRef.current.nonce) {
        window.clearTimeout(pingRef.current.timeoutId);
        setExtensionStatus("ready");
        setExtensionVersion(data.extension_version ?? null);
        requestVaultStatus();
      }

      if (data.type === "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS_RESULT") {
        setExtensionStatus("ready");
        setVaultStatus(data.status ?? null);
      }

      if (data.type === "APP_CONTABLE_OPEN_EXTENSION_OPTIONS_RESULT") {
        if (data.ok === false) toast(data.error || "No se pudo abrir la configuración de la extensión", "error");
      }
    }

    window.addEventListener("message", onMessage);
    sendPing();
    return () => {
      if (pingRef.current) window.clearTimeout(pingRef.current.timeoutId);
      window.removeEventListener("message", onMessage);
    };
  }, [toast]);

  function refreshMotorStatus() {
    if (extensionStatus === "ready") {
      requestVaultStatus();
      return;
    }
    setExtensionStatus("checking");
    sendPing();
  }

  function openExtensionOptions() {
    if (extensionStatus !== "ready") {
      toast("Instala o recarga la extensión App Contable Motor Local", "error");
      return;
    }
    window.postMessage({ source: "app-contable", type: "APP_CONTABLE_OPEN_EXTENSION_OPTIONS", protocol_version: 1 }, window.location.origin);
  }

  const [revoking, setRevoking] = useState(false);
  // Kill-switch alcanzable desde cualquier dispositivo (incl. el teléfono): revoca
  // la llave del servidor en TODOS los equipos. La bóveda local queda inservible sin
  // ella. Úsalo si pierdes un equipo o cierras un computador compartido.
  async function revokeVaultEverywhere() {
    if (!window.confirm("Esto desconecta tu clave del SII en TODOS tus equipos. Tendrás que volver a conectarla (RUT + Clave Tributaria) la próxima vez que emitas. Úsalo si perdiste un equipo. ¿Continuar?")) return;
    setRevoking(true);
    try {
      const res = await fetch("/api/extension/revoke", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        toast(json.error === "NO_AUTH" ? "Inicia sesión para revocar." : "No se pudo revocar. Intenta de nuevo.", "error");
        return;
      }
      // Además, limpia la bóveda local de ESTE equipo si la extensión está presente
      // (mensaje dedicado que el bridge sí relaya; CLEAR está gateado a páginas de
      // la extensión). El WS ya fue revocado arriba: sin él, lo local es inservible.
      if (extensionStatus === "ready") {
        window.postMessage({ source: "app-contable", type: "APP_CONTABLE_SII_VAULT_LOCAL_WIPE", protocol_version: 1 }, window.location.origin);
      }
      toast("Clave del SII desconectada en todos tus equipos.", "success");
    } catch {
      toast("Error de red al revocar.", "error");
    } finally {
      setRevoking(false);
    }
  }

  function save(next: EmissionProviderState) {
    const previous = state;
    setState(next);
    start(async () => {
      const r = await setEmisionConfig(next);
      if (r.error) {
        setState(previous);
        toast(r.error, "error");
      } else {
        toast("Configuración de emisión actualizada");
        onProveedorChange?.({ boletas: next.boletasProveedor, facturas: next.facturasProveedor });
      }
    });
  }

  function selectBoletas(proveedor: BoletasEmisionProveedor) {
    if (state.boletasProveedor === "mock" && proveedor !== "mock" && !(confirmReal?.grupo === "boletas" && confirmReal.proveedor === proveedor)) {
      setConfirmReal({ grupo: "boletas", proveedor });
      return;
    }
    setConfirmReal(null);
    save({ ...state, boletasProveedor: proveedor });
  }

  function selectFacturas(proveedor: FacturasEmisionProveedor) {
    if (state.facturasProveedor === "mock" && proveedor !== "mock" && !(confirmReal?.grupo === "facturas" && confirmReal.proveedor === proveedor)) {
      setConfirmReal({ grupo: "facturas", proveedor });
      return;
    }
    setConfirmReal(null);
    save({ ...state, facturasProveedor: proveedor });
  }

  const showMockBoletas = devMode || inicialAlMontar.boletasProveedor === "mock" || state.boletasProveedor === "mock";
  const showMockFacturas = devMode || inicialAlMontar.facturasProveedor === "mock" || state.facturasProveedor === "mock";
  const combinedMode = state.boletasProveedor === "sii_local" && state.facturasProveedor === "simpleapi";

  return (
    <div style={{
      borderRadius: 22,
      border: "1px solid var(--border, rgba(255,255,255,.06))",
      background: "color-mix(in srgb, var(--text, #e8eaf0) 3%, transparent)",
      boxShadow: "inset 0 1px 0 var(--border, rgba(255,255,255,.06))",
    }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "28px 36px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 20, marginBottom: 24 }}>
          <div style={{
            width: 48, height: 48, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 16,
            border: "1px solid color-mix(in srgb, var(--blue, #5b9cf6) 25%, transparent)",
            background: "color-mix(in srgb, var(--blue, #5b9cf6) 12%, transparent)",
            color: "var(--blue, #5b9cf6)",
          }}>
            <svg viewBox="0 0 24 24" fill="none" width={21} height={21}>
              <path d="M4 7h16M7 4v16M17 4v16M4 17h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M9 12h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </div>
          <div style={{ minWidth: 0, paddingTop: 4, flex: 1 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <h3 style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.2, letterSpacing: "-0.04em", color: "var(--text, #e8eaf0)" }}>
                Proveedor de emisión
              </h3>
              <span style={{
                display: "inline-block", borderRadius: 9999,
                border: `1px solid ${combinedMode ? "rgba(232,85,62,0.28)" : "color-mix(in srgb, var(--green, #22c55e) 20%, transparent)"}`,
                background: combinedMode ? "rgba(232,85,62,0.12)" : "color-mix(in srgb, var(--green, #22c55e) 15%, transparent)",
                padding: "4px 10px", fontSize: 11, fontWeight: 700,
                color: combinedMode ? "var(--accent, #E8553E)" : "var(--green, #22c55e)",
              }}>
                {combinedMode ? "Modo combinado" : "Rutas separadas"}
              </span>
              {devMode && <span style={{ display: "inline-block", borderRadius: 9999, border: "1px solid color-mix(in srgb, var(--lime, #b4f027) 28%, transparent)", background: "color-mix(in srgb, var(--lime, #b4f027) 10%, transparent)", padding: "4px 9px", fontSize: 10, fontWeight: 800, color: "var(--lime, #b4f027)" }}>DEV</span>}
            </div>
            <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4, color: "var(--text3, #697080)" }}>
              Define qué motor usa cada tipo de documento. Boletas y facturas pueden ir por carriles distintos.
            </p>
          </div>
        </div>

        <LocalMotorPanel
          status={extensionStatus}
          version={extensionVersion}
          vault={vaultStatus}
          onOpenOptions={openExtensionOptions}
          onRefresh={refreshMotorStatus}
        />

        {/* Seguridad de la clave del SII: cómo se protege + kill-switch remoto.
            Transparencia (Ley 21.719 Art. 14 ter) + revocación (Art. 14 sexies). */}
        <section style={{
          marginBottom: 16, borderRadius: 14,
          border: "1px solid var(--border, rgba(255,255,255,.06))",
          background: "color-mix(in srgb, var(--text, #e8eaf0) 3%, transparent)",
          padding: "14px 16px",
          display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text, #e8eaf0)" }}>Seguridad de tu clave del SII</div>
            <p style={{ margin: "5px 0 0", fontSize: 11, lineHeight: 1.5, color: "var(--text3, #697080)" }}>
              Tu Clave Tributaria se cifra solo en tu equipo; nunca llega a nuestros servidores. Se desbloquea sola con tu sesión mientras la tengas iniciada. Si pierdes un computador, desconéctala desde aquí (o desde tu teléfono): la clave quedará inservible en todos tus equipos.
            </p>
          </div>
          <button type="button" onClick={() => { void revokeVaultEverywhere(); }} disabled={revoking}
            style={{
              border: "1px solid color-mix(in srgb, var(--red, #ef4444) 40%, transparent)",
              borderRadius: 999, background: "color-mix(in srgb, var(--red, #ef4444) 10%, transparent)",
              color: "var(--red, #ef4444)", padding: "9px 14px", fontSize: 11, fontWeight: 850,
              cursor: revoking ? "wait" : "pointer", opacity: revoking ? 0.6 : 1, whiteSpace: "nowrap",
            }}>
            {revoking ? "Desconectando…" : "Desconectar en todos mis equipos"}
          </button>
        </section>

        <ProviderGroup
          title="Boletas"
          code="DTE 39/41"
          subtitle="Recomendado: SII local para e-Boleta/MiPyme."
          footer={state.boletasProveedor === "sii_local" && extensionStatus === "missing" ? (
            <div style={{
              marginTop: 8,
              borderRadius: 10,
              border: "1px solid color-mix(in srgb, var(--amber, #f59e0b) 30%, transparent)",
              background: "color-mix(in srgb, var(--amber, #f59e0b) 8%, transparent)",
              padding: "9px 12px",
              fontSize: 11,
              lineHeight: 1.45,
              fontWeight: 650,
              color: "var(--amber, #f59e0b)",
            }}>
              Sin la extensión instalada no podrás emitir — instálala antes de tu primera boleta.
            </div>
          ) : null}
        >
          {showMockBoletas && (
            <ProviderButton
              active={state.boletasProveedor === "mock"}
              title="Modo de prueba"
              description={devMode ? "Simula boletas sin informar al SII. Visible para desarrollo." : "Simula boletas sin informar al SII."}
              disabled={pending}
              onClick={() => selectBoletas("mock")}
            />
          )}
          <ProviderButton
            active={state.boletasProveedor === "sii_local"}
            title="SII local"
            description="Usa tu sesión SII en el navegador con la extensión."
            disabled={pending}
            confirming={confirmReal?.grupo === "boletas" && confirmReal.proveedor === "sii_local"}
            onClick={() => selectBoletas("sii_local")}
          />
          <ProviderButton
            active={state.boletasProveedor === "simpleapi"}
            title="SimpleAPI"
            badge="Próximamente"
            description="Alternativa con CAF 39/41 y certificado local. Disponible pronto."
            disabled={pending || !devMode}
            confirming={confirmReal?.grupo === "boletas" && confirmReal.proveedor === "simpleapi"}
            onClick={() => selectBoletas("simpleapi")}
          />
        </ProviderGroup>

        {/* Facturas 33/34 DESACTIVADO para clientes (decisión founder 2026-07-04:
            el carril existe pero no está pulido — no se ofrece hasta pulirlo).
            Solo visible con dev_mode; NO borrar. */}
        {devMode && <ProviderGroup title="Facturas" code="DTE 33/34" subtitle="Recomendado: SimpleAPI con certificado y CAF de facturas.">
          {showMockFacturas && (
            <ProviderButton
              active={state.facturasProveedor === "mock"}
              title="Modo de prueba"
              description={devMode ? "Simula facturas sin informar al SII. Visible para desarrollo." : "Simula facturas sin informar al SII."}
              disabled={pending}
              onClick={() => selectFacturas("mock")}
            />
          )}
          <ProviderButton
            active={state.facturasProveedor === "simpleapi"}
            title="SimpleAPI"
            description="Emitirá con nuestra API key y datos cifrados en la extensión."
            disabled={pending}
            confirming={confirmReal?.grupo === "facturas" && confirmReal.proveedor === "simpleapi"}
            onClick={() => selectFacturas("simpleapi")}
          />
        </ProviderGroup>}

        <div style={{
          marginTop: 12,
          borderRadius: 14,
          border: "1px solid var(--border, rgba(255,255,255,.06))",
          background: combinedMode ? "rgba(232,85,62,0.055)" : "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)",
          padding: "14px 16px",
          display: "block",
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 760, color: "var(--text, #e8eaf0)" }}>
              {combinedMode ? "Modo combinado recomendado" : "Configuración por documento"}
            </div>
            <div style={{ marginTop: 3, fontSize: 11, color: "var(--text3, #697080)", lineHeight: 1.45 }}>
              Boletas: {providerLabel(state.boletasProveedor)}. Facturas: {providerLabel(state.facturasProveedor)}. SimpleAPI usará la misma extensión como bóveda local cifrada.{devMode ? " El proxy efímero ya existe; falta conectarlo desde la extensión." : ""}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LocalMotorPanel({
  status,
  version,
  vault,
  onOpenOptions,
  onRefresh,
}: {
  status: ExtensionStatus;
  version: string | null;
  vault: SimpleApiVaultStatus | null;
  onOpenOptions: () => void;
  onRefresh: () => void;
}) {
  const [showInstall, setShowInstall] = useState(false);
  const ready = status === "ready";
  const missing = status === "missing";
  const vaultReady = Boolean(vault?.configured && vault.encrypted && vault.has_pfx && vault.has_caf);
  const label = status === "checking" ? "Buscando extensión" : ready ? "Motor local conectado" : "Extensión no detectada";
  const labelColor = ready ? "var(--green, #22c55e)" : status === "checking" ? "var(--amber, #f59e0b)" : "var(--red, #ef4444)";
  const labelBg = ready ? "color-mix(in srgb, var(--green, #22c55e) 12%, transparent)" : status === "checking" ? "color-mix(in srgb, var(--amber, #f59e0b) 10%, transparent)" : "color-mix(in srgb, var(--red, #ef4444) 10%, transparent)";

  return (
    <section style={{
      marginBottom: 16,
      borderRadius: 18,
      border: "1px solid var(--border, rgba(255,255,255,.06))",
      background: "linear-gradient(135deg, color-mix(in srgb, var(--text, #e8eaf0) 5%, transparent), rgba(232,85,62,0.055))",
      padding: 16,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 13, color: "var(--text, #e8eaf0)" }}>App Contable Motor Local</strong>
            <span style={{ borderRadius: 999, border: "1px solid var(--border, rgba(255,255,255,.06))", background: labelBg, color: labelColor, padding: "4px 9px", fontSize: 10, fontWeight: 850 }}>
              {label}
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 11, lineHeight: 1.45, color: "var(--text2, #8b92a3)" }}>
            Una sola extensión local maneja SII Local para boletas y la bóveda SimpleAPI para facturas. PFX, CAF y password se configuran dentro de la extensión, no en esta web.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" onClick={onRefresh} style={smallButtonStyle(false, false)}>
            Actualizar
          </button>
          {missing ? (
            <a
              {...EXTENSION_ZIP_DOWNLOAD_PROPS}
              onClick={() => setShowInstall(true)}
              style={{ ...smallButtonStyle(false, true), textDecoration: "none", whiteSpace: "nowrap" }}
            >
              Instalar extensión
            </a>
          ) : (
            <button type="button" onClick={onOpenOptions} disabled={!ready} style={smallButtonStyle(!ready, true)}>
              Configurar en extensión
            </button>
          )}
        </div>
      </div>

      {missing && showInstall && (
        <div style={{
          marginTop: 12,
          borderRadius: 12,
          border: "1px solid var(--border, rgba(255,255,255,.06))",
          background: "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)",
          padding: "12px 14px",
          fontSize: 11,
          lineHeight: 1.6,
          color: "var(--text2, #8b92a3)",
        }}>
          <div style={{ fontWeight: 800, color: "var(--text, #e8eaf0)", marginBottom: 4 }}>
            Instala la extensión App Contable Motor Local (v{EXTENSION_VERSION_ACTUAL}) en este Chrome
          </div>
          <ol style={{ margin: 0, paddingLeft: 16 }}>
            <li>El archivo <b>.zip</b> ya se descargó al presionar «Instalar extensión». Descomprímelo (doble clic) → queda una <b>carpeta</b>.</li>
            <li>En una pestaña nueva entra a <b>chrome://extensions</b> (solo Google Chrome, no Safari).</li>
            <li>Activa el «Modo de desarrollador» (arriba a la derecha).</li>
            <li>Presiona «Cargar descomprimida» y elige la <b>carpeta</b> descomprimida (no el .zip).</li>
            <li>Listo: la app se conecta sola. (Si no, presiona «Actualizar».)</li>
          </ol>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 13 }}>
        <MotorStatusCard title="SII Local" status={ready ? "Activo" : "Pendiente"} detail="Boletas 39/41 vía Portal SII/e-Boleta local." active={ready} />
        <MotorStatusCard title="SimpleAPI" status={vaultReady ? "Bóveda lista" : "Bóveda pendiente"} detail={vaultDetail(vault)} active={vaultReady} />
        <MotorStatusCard title="Versión" status={version ?? "-"} detail={`Última disponible: v${EXTENSION_VERSION_ACTUAL}${version && version !== EXTENSION_VERSION_ACTUAL ? " · reinstala para actualizar" : ""}`} active={ready} />
      </div>
    </section>
  );
}

function MotorStatusCard({ title, status, detail, active }: { title: string; status: string; detail: string; active: boolean }) {
  return (
    <div style={{ borderRadius: 14, border: "1px solid var(--border, rgba(255,255,255,.06))", background: "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)", padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 850, color: "var(--text, #e8eaf0)" }}>{title}</span>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: active ? "var(--green, #22c55e)" : "var(--amber, #f59e0b)" }} />
      </div>
      <div style={{ marginTop: 7, fontSize: 12, fontWeight: 820, color: active ? "var(--green, #22c55e)" : "var(--amber, #f59e0b)" }}>{status}</div>
      <div style={{ marginTop: 4, fontSize: 10, lineHeight: 1.35, color: "var(--text3, #697080)" }}>{detail}</div>
    </div>
  );
}

function vaultDetail(vault: SimpleApiVaultStatus | null) {
  if (!vault) return "Sin estado local todavía.";
  const pfx = vault.has_pfx ? "PFX ok" : "falta PFX";
  const caf = vault.has_caf ? "CAF ok" : "falta CAF";
  const encrypted = vault.encrypted ? "cifrado activo" : "cifrado pendiente";
  const unlocked = vault.unlocked ? "desbloqueada temporalmente" : "bloqueada";
  return `${pfx}, ${caf}, ${encrypted}, ${unlocked}.`;
}

function smallButtonStyle(disabled: boolean, primary: boolean): CSSProperties {
  return {
    border: primary ? "0" : "1px solid var(--border, rgba(255,255,255,.06))",
    borderRadius: 999,
    background: primary ? "var(--accent, #E8553E)" : "color-mix(in srgb, var(--text, #e8eaf0) 5%, transparent)",
    color: primary ? "#fff" : "var(--text, #e8eaf0)",
    padding: "8px 11px",
    fontSize: 11,
    fontWeight: 850,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}

function providerLabel(proveedor: BoletasEmisionProveedor | FacturasEmisionProveedor) {
  if (proveedor === "simpleapi") return "SimpleAPI";
  if (proveedor === "sii_local") return "SII local";
  return "Modo de prueba";
}

function ProviderGroup({ title, code, subtitle, footer, children }: { title: string; code?: string; subtitle: string; footer?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 850, color: "var(--text, #e8eaf0)" }}>
          {title}
          {code && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: "var(--text3, #697080)" }}>{code}</span>}
        </div>
        <div style={{ fontSize: 10, color: "var(--text3, #697080)", textAlign: "right" }}>{subtitle}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
        {children}
      </div>
      {footer}
    </section>
  );
}

function ProviderButton({ active, title, description, disabled, badge, confirming = false, onClick }: {
  active: boolean;
  title: string;
  description: string;
  disabled: boolean;
  badge?: string;
  confirming?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: "left",
        borderRadius: 14,
        border: `1px solid ${confirming ? "color-mix(in srgb, var(--amber, #f59e0b) 45%, transparent)" : active ? "rgba(232,85,62,0.42)" : "var(--border, rgba(255,255,255,.06))"}`,
        background: active ? "rgba(232,85,62,0.10)" : "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)",
        padding: "14px 16px",
        color: "var(--text, #e8eaf0)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.68 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {badge && (
            <span style={{ borderRadius: 999, border: "1px solid var(--border, rgba(255,255,255,.06))", background: "color-mix(in srgb, var(--text, #e8eaf0) 6%, transparent)", padding: "2px 7px", fontSize: 9, fontWeight: 800, color: "var(--text3, #697080)", whiteSpace: "nowrap" }}>
              {badge}
            </span>
          )}
          <span style={{ width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", border: `1px solid ${active ? "var(--accent, #E8553E)" : "color-mix(in srgb, var(--text, #e8eaf0) 25%, transparent)"}`, color: active ? "var(--accent, #E8553E)" : "transparent", fontSize: 11, fontWeight: 900 }}>
            {active ? "✓" : ""}
          </span>
        </span>
      </div>
      <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.4, fontWeight: confirming ? 700 : undefined, color: confirming ? "var(--amber, #f59e0b)" : "var(--text3, #697080)" }}>
        {confirming ? "¿Seguro? Emitirás documentos REALES ante el SII" : description}
      </div>
    </button>
  );
}
