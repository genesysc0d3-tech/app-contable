"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { useToast } from "@/components/Toast";
import { setEmisionConfig, type BoletasEmisionProveedor, type FacturasEmisionProveedor } from "./actions";

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
}: {
  inicial: EmissionProviderState;
  devMode?: boolean;
}) {
  const { toast } = useToast();
  const [state, setState] = useState(inicial);
  const [pending, start] = useTransition();
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus>("checking");
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null);
  const [vaultStatus, setVaultStatus] = useState<SimpleApiVaultStatus | null>(null);

  function requestVaultStatus() {
    window.postMessage({ source: "app-contable", type: "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS", protocol_version: 1 }, window.location.origin);
  }

  useEffect(() => {
    const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
    const timeout = window.setTimeout(() => setExtensionStatus((current) => current === "checking" ? "missing" : current), 1200);

    function onMessage(event: MessageEvent<ExtensionWindowMessage>) {
      if (event.source !== window) return;
      const data = event.data;
      if (data?.source !== "app-contable-extension") return;

      if (data.type === "APP_CONTABLE_EXTENSION_PONG" && data.nonce === nonce) {
        window.clearTimeout(timeout);
        setExtensionStatus("ready");
        setExtensionVersion(data.extension_version ?? null);
        requestVaultStatus();
      }

      if (data.type === "APP_CONTABLE_SIMPLEAPI_VAULT_STATUS_RESULT") {
        setExtensionStatus("ready");
        setVaultStatus(data.status ?? null);
      }

      if (data.type === "APP_CONTABLE_OPEN_EXTENSION_OPTIONS_RESULT") {
        if (data.ok === false) toast(data.error || "No se pudo abrir la configuracion de la extension", "error");
      }
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ source: "app-contable", type: "APP_CONTABLE_EXTENSION_PING", protocol_version: 1, nonce }, window.location.origin);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
    };
  }, [toast]);

  function openExtensionOptions() {
    if (extensionStatus !== "ready") {
      toast("Instala o recarga la extension App Contable Motor Local", "error");
      return;
    }
    window.postMessage({ source: "app-contable", type: "APP_CONTABLE_OPEN_EXTENSION_OPTIONS", protocol_version: 1 }, window.location.origin);
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
        toast("Configuracion de emision actualizada");
      }
    });
  }

  function selectBoletas(proveedor: BoletasEmisionProveedor) {
    save({ ...state, boletasProveedor: proveedor });
  }

  function selectFacturas(proveedor: FacturasEmisionProveedor) {
    save({ ...state, facturasProveedor: proveedor });
  }

  const showMockBoletas = devMode || state.boletasProveedor === "mock";
  const showMockFacturas = devMode || state.facturasProveedor === "mock";
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
                Proveedor de emision
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
              Define que motor usa cada tipo de documento. Boletas y facturas pueden ir por carriles distintos.
            </p>
          </div>
        </div>

        <LocalMotorPanel
          status={extensionStatus}
          version={extensionVersion}
          vault={vaultStatus}
          onOpenOptions={openExtensionOptions}
          onRefresh={requestVaultStatus}
        />

        <ProviderGroup title="Boletas 39/41" subtitle="Recomendado: SII local para e-Boleta/MiPyme.">
          {showMockBoletas && (
            <ProviderButton
              active={state.boletasProveedor === "mock"}
              title="Modo de prueba"
              description="Simula boletas sin informar al SII. Visible para desarrollo."
              disabled={pending}
              onClick={() => selectBoletas("mock")}
            />
          )}
          <ProviderButton
            active={state.boletasProveedor === "sii_local"}
            title="SII local"
            description="Usa tu sesion SII en el navegador con la extension."
            disabled={pending}
            onClick={() => selectBoletas("sii_local")}
          />
          <ProviderButton
            active={state.boletasProveedor === "simpleapi"}
            title="SimpleAPI"
            description="Alternativa con CAF 39/41 y certificado local. Falta conectar boveda."
            disabled={pending}
            onClick={() => selectBoletas("simpleapi")}
          />
        </ProviderGroup>

        <ProviderGroup title="Facturas 33/34" subtitle="Recomendado: SimpleAPI con certificado y CAF de facturas.">
          {showMockFacturas && (
            <ProviderButton
              active={state.facturasProveedor === "mock"}
              title="Modo de prueba"
              description="Simula facturas para desarrollo, sin informar al SII."
              disabled={pending}
              onClick={() => selectFacturas("mock")}
            />
          )}
          <ProviderButton
            active={state.facturasProveedor === "simpleapi"}
            title="SimpleAPI"
            description="Emitira con nuestra API key y datos cifrados en la extension."
            disabled={pending}
            onClick={() => selectFacturas("simpleapi")}
          />
        </ProviderGroup>

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
              {combinedMode ? "Modo combinado recomendado" : "Configuracion por documento"}
            </div>
            <div style={{ marginTop: 3, fontSize: 11, color: "var(--text3, #697080)", lineHeight: 1.45 }}>
              Boletas: {providerLabel(state.boletasProveedor)}. Facturas: {providerLabel(state.facturasProveedor)}. SimpleAPI usara la misma extension como boveda local cifrada; el proxy efimero ya existe, falta conectarlo desde la extension.
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
  const ready = status === "ready";
  const vaultReady = Boolean(vault?.configured && vault.encrypted && vault.has_pfx && vault.has_caf);
  const label = status === "checking" ? "Buscando extension" : ready ? "Motor local conectado" : "Extension no detectada";
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
            Una sola extension local maneja SII Local para boletas y la boveda SimpleAPI para facturas. PFX, CAF y password se configuran dentro de la extension, no en esta web.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" onClick={onRefresh} disabled={!ready} style={smallButtonStyle(!ready, false)}>
            Actualizar
          </button>
          <button type="button" onClick={onOpenOptions} disabled={!ready} style={smallButtonStyle(!ready, true)}>
            Configurar en extension
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10, marginTop: 13 }}>
        <MotorStatusCard title="SII Local" status={ready ? "Activo" : "Pendiente"} detail="Boletas 39/41 via Portal SII/e-Boleta local." active={ready} />
        <MotorStatusCard title="SimpleAPI" status={vaultReady ? "Boveda lista" : "Boveda pendiente"} detail={vaultDetail(vault)} active={vaultReady} />
        <MotorStatusCard title="Version" status={version ?? "-"} detail="Extension App Contable Motor Local." active={ready} />
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
  if (!vault) return "Sin estado local todavia.";
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

function ProviderGroup({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 850, color: "var(--text, #e8eaf0)" }}>{title}</div>
        <div style={{ fontSize: 10, color: "var(--text3, #697080)", textAlign: "right" }}>{subtitle}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
        {children}
      </div>
    </section>
  );
}

function ProviderButton({ active, title, description, disabled, onClick }: {
  active: boolean;
  title: string;
  description: string;
  disabled: boolean;
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
        border: `1px solid ${active ? "rgba(232,85,62,0.42)" : "var(--border, rgba(255,255,255,.06))"}`,
        background: active ? "rgba(232,85,62,0.10)" : "color-mix(in srgb, var(--text, #e8eaf0) 4%, transparent)",
        padding: "14px 16px",
        color: "var(--text, #e8eaf0)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.68 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <span style={{ width: 18, height: 18, borderRadius: "50%", display: "grid", placeItems: "center", border: `1px solid ${active ? "var(--accent, #E8553E)" : "color-mix(in srgb, var(--text, #e8eaf0) 25%, transparent)"}`, color: active ? "var(--accent, #E8553E)" : "transparent", fontSize: 11, fontWeight: 900 }}>
          {active ? "✓" : ""}
        </span>
      </div>
      <div style={{ marginTop: 5, fontSize: 11, lineHeight: 1.4, color: "var(--text3, #697080)" }}>
        {description}
      </div>
    </button>
  );
}
