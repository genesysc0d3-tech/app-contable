import { LegalSection, LegalShell } from "../LegalShell";

export default function PrivacidadPage() {
  return (
    <LegalShell title="Politica de privacidad">
      <LegalSection title="Que datos tratamos">
        <p>
          MassDTE trata datos de cuenta, empresa, clientes, documentos subidos,
          movimientos, comprobantes, configuracion tributaria, pagos, eventos de
          soporte y eventos operacionales necesarios para prestar el servicio.
        </p>
      </LegalSection>

      <LegalSection title="Para que los usamos">
        <p>
          Usamos los datos para operar la cuenta SaaS, procesar cartolas y
          comprobantes, generar propuestas, emitir o registrar documentos cuando
          el usuario lo solicita, controlar planes/cupos, cobrar, dar soporte,
          prevenir abusos y cumplir obligaciones legales o tributarias.
        </p>
      </LegalSection>

      <LegalSection title="IA y OCR">
        <p>
          Algunas funciones usan proveedores de OCR/IA para leer documentos y
          proponer clasificaciones. Enviamos solo el contenido necesario para la
          tarea y no usamos estos canales para almacenar claves, certificados,
          cookies, tokens ni documentos crudos en logs operacionales.
        </p>
      </LegalSection>

      <LegalSection title="Proveedores">
        <p>
          El servicio puede usar Supabase, Vercel, proveedores IA/OCR, Telegram,
          Mercado Pago y GitHub/CI. Cada proveedor se usa para una finalidad
          tecnica o contractual especifica. La lista puede cambiar si el
          producto evoluciona.
        </p>
      </LegalSection>

      <LegalSection title="Soporte">
        <p>
          El modo soporte de Genesys es de solo lectura, queda auditado y no debe
          usarse para modificar documentos, pagos, empresas, usuarios ni
          emisiones del cliente.
        </p>
      </LegalSection>

      <LegalSection title="Derechos de titulares">
        <p>
          Puedes solicitar acceso, rectificacion, supresion, oposicion,
          portabilidad o bloqueo cuando corresponda. Algunas solicitudes pueden
          limitarse si existen obligaciones tributarias, contables, contractuales,
          de seguridad o auditoria que obliguen a conservar informacion.
        </p>
      </LegalSection>

      <LegalSection title="Contacto">
        <p>
          Para solicitudes de privacidad o incidentes, usa el canal de soporte
          acordado con MassDTE durante la beta controlada. Registraremos la
          solicitud, verificaremos identidad y responderemos con el alcance que
          permita la ley aplicable.
        </p>
      </LegalSection>
    </LegalShell>
  );
}

export const metadata = {
  title: "Politica de privacidad | MassDTE",
};
