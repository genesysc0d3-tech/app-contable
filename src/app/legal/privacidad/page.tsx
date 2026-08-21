import { LegalSection, LegalShell } from "../LegalShell";
import { POLICY_VERSION } from "@/lib/legal/version";

export default function PrivacidadPage() {
  return (
    <LegalShell title="Politica de privacidad">
      <p style={{ marginTop: 0, fontSize: 13, fontWeight: 700 }}>Ultima actualizacion: {POLICY_VERSION}</p>

      <LegalSection title="1. Responsable del tratamiento">
        <p>
          AlphaCode SpA es responsable del tratamiento de tus datos personales. Durante la beta
          controlada, el contacto para asuntos de datos personales es el canal de soporte de
          MassDTE; los datos de identificacion societaria (RUT y domicilio) se publican aqui al
          completarse la constitucion de la empresa.
        </p>
      </LegalSection>

      <LegalSection title="2. Que datos tratamos">
        <p>
          Nombre, correo electronico, RUT, y datos bancarios/tributarios que cargas o que se
          extraen de tus cartolas y comprobantes (movimientos, montos, nombres de contraparte,
          folios), ademas de datos de uso de la aplicacion. No tratamos datos sensibles (salud,
          biometricos) ni datos de ninos, ninas y adolescentes de forma intencionada.
        </p>
        <p>
          Origen: los datos los aportas tu directamente (registro, archivos que subes). Los datos
          de terceros que aparezcan dentro de tus cartolas o comprobantes (por ejemplo, el nombre
          de una contraparte bancaria) provienen de esos mismos archivos y se tratan solo para
          prestarte el servicio, con minimizacion segun el monto de la operacion.
        </p>
      </LegalSection>

      <LegalSection title="3. Finalidad y base de licitud">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Prestacion del servicio y gestion de tu cuenta &mdash; ejecucion de contrato.</li>
          <li>Procesar cartolas/comprobantes y proponer documentos tributarios &mdash; ejecucion de contrato.</li>
          <li>Emision de documentos tributarios electronicos (DTE) &mdash; obligacion legal (DL 825 / Codigo Tributario).</li>
          <li>Cobro de la suscripcion &mdash; ejecucion de contrato.</li>
          <li>Seguridad, prevencion de fraude y soporte &mdash; interes legitimo.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Con quien compartimos los datos">
        <p>
          Usamos proveedores que actuan como encargados: Supabase (base de datos y
          almacenamiento), Vercel (hosting), OpenCode (lectura por IA de cartolas/comprobantes),
          Telegram (recepcion de comprobantes) y Mercado Pago (pagos). Algunos procesan datos
          fuera de Chile (EE.UU., UE, Singapur, Brasil); la transferencia se ampara en las
          clausulas contractuales modelo aprobadas por el Ministerio de Economia. La lectura por
          IA se hace con proveedores de retencion cero que no usan tus datos para entrenar
          modelos. No vendemos datos personales.
        </p>
      </LegalSection>

      <LegalSection title="5. Por cuanto tiempo">
        <p>
          Conservamos los datos mientras dure la relacion contractual. Los documentos
          tributarios y la informacion contable se conservan 6 anos (Codigo Tributario). Luego
          se eliminan o anonimizan.
        </p>
      </LegalSection>

      <LegalSection title="6. Tus derechos">
        <p>
          Puedes ejercer acceso, rectificacion, supresion, oposicion, portabilidad y bloqueo, y
          retirar tu consentimiento cuando quieras, a traves del canal de soporte de MassDTE.
          Respondemos en 30 dias corridos (prorrogables una sola vez por 30 dias mas). La
          rectificacion, supresion y oposicion son siempre gratuitas; el acceso es gratuito al
          menos una vez por trimestre.
        </p>
      </LegalSection>

      <LegalSection title="7. Decisiones automatizadas (IA y OCR)">
        <p>
          Usamos tratamientos automatizados (OCR e IA) para leer y clasificar tus cartolas y
          comprobantes y proponer documentos. Las propuestas no se ejecutan solas: tu (o un
          usuario autorizado) revisas y apruebas antes de emitir. Tienes derecho a una
          explicacion, a intervencion humana y a oponerte.
        </p>
      </LegalSection>

      <LegalSection title="8. Cookies y almacenamiento local">
        <p>
          No usamos cookies de publicidad ni de seguimiento de terceros. La aplicacion utiliza
          unicamente el almacenamiento necesario para mantener tu sesion iniciada y tus
          preferencias de uso (por ejemplo, el tema visual). El sitio massdte.cl tampoco usa
          cookies de rastreo.
        </p>
      </LegalSection>

      <LegalSection title="9. Seguridad">
        <p>
          Aplicamos medidas tecnicas y organizativas: TLS/HSTS, cifrado en reposo, hashing de
          contrasenas, aislamiento por cuenta (RLS) verificado con pruebas, logs de auditoria,
          secretos fuera del codigo y minimizacion de datos.
        </p>
      </LegalSection>

      <LegalSection title="10. Cambios y reclamos">
        <p>
          Podemos actualizar esta politica; publicaremos la version vigente con su fecha. Puedes
          reclamar ante la Agencia de Proteccion de Datos Personales de Chile.
        </p>
      </LegalSection>
    </LegalShell>
  );
}

export const metadata = {
  title: "Politica de privacidad | MassDTE",
};
