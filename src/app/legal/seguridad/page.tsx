import { LegalSection, LegalShell } from "../LegalShell";

export default function SeguridadPage() {
  return (
    <LegalShell title="Seguridad e incidentes">
      <LegalSection title="Controles tecnicos">
        <p>
          MassDTE usa autenticacion Supabase, controles por cuenta/empresa,
          soporte read-only, auditoria operacional, rate limits, CI, builds
          verificados, cola durable para procesamiento pesado y politicas para
          no guardar secretos ni documentos crudos en artifacts o eventos ops.
        </p>
      </LegalSection>

      <LegalSection title="Datos sensibles operacionalmente">
        <p>
          Tratamos documentos tributarios, cartolas, comprobantes, RUTs, pagos y
          resultados de emision como informacion de alto cuidado. Los eventos de
          observabilidad deben contener solo resumen y metadata sanitizada.
        </p>
      </LegalSection>

      <LegalSection title="Reporte de incidentes">
        <p>
          Si detectas acceso indebido, exposicion de informacion, error de
          emision, abuso de soporte o problema de seguridad, reportalo por el
          canal de soporte acordado. Incluye fecha, cuenta, ruta afectada y una
          descripcion breve, sin enviar claves ni documentos innecesarios.
        </p>
      </LegalSection>

      <LegalSection title="Respuesta">
        <p>
          Ante un incidente, el equipo contendra el riesgo, preservara evidencia
          segura, clasificara datos afectados, evaluara notificaciones con apoyo
          legal cuando corresponda, corregira causa raiz y registrara cierre sin
          exponer datos personales crudos.
        </p>
      </LegalSection>
    </LegalShell>
  );
}

export const metadata = {
  title: "Seguridad | MassDTE",
};
