import { LegalSection, LegalShell } from "../LegalShell";

export default function TerminosPage() {
  return (
    <LegalShell title="Terminos de uso">
      <LegalSection title="Servicio">
        <p>
          MassDTE es una herramienta SaaS para procesar cartolas, comprobantes y
          documentos asociados a operaciones contables y tributarias en Chile. El
          usuario sigue siendo responsable de revisar la informacion antes de
          aprobar, emitir o usar documentos.
        </p>
      </LegalSection>

      <LegalSection title="Beta controlada">
        <p>
          Durante la beta, algunas funciones pueden requerir soporte directo,
          revision manual o ajustes. No debe considerarse un servicio de
          asesoria legal, tributaria o contable personalizada.
        </p>
      </LegalSection>

      <LegalSection title="Uso correcto">
        <p>
          El usuario debe cargar informacion propia o autorizada, mantener
          credenciales seguras, revisar propuestas antes de emitir y no usar la
          plataforma para fraude, suplantacion, evasion, manipulacion de folios,
          carga de malware o acceso a informacion de terceros.
        </p>
      </LegalSection>

      <LegalSection title="Uso competitivo, ingenieria inversa e IA">
        <p>
          MassDTE se licencia para el uso propio del usuario, no para estudiarlo
          como producto. Queda prohibido: (a) usar el servicio, su interfaz, sus
          flujos o sus resultados para construir, entrenar o mejorar un producto
          o servicio que compita con MassDTE; (b) realizar ingenieria inversa,
          descompilar, extraer o &laquo;destilar&raquo; el funcionamiento del
          sistema, incluyendo mediante herramientas de inteligencia artificial,
          scraping, automatizacion de sesiones o captura sistematica de
          pantallas, respuestas o comportamientos; (c) acceder al servicio por
          cuenta o encargo de un competidor, o facilitar el acceso a uno; y
          (d) sondear, escanear o probar la seguridad o los limites del sistema
          fuera de un canal acordado con nosotros.
        </p>
        <p>
          El incumplimiento faculta a MassDTE para suspender o terminar la
          cuenta de inmediato, sin reembolso del periodo en curso, y para
          ejercer las acciones legales que correspondan, incluida la proteccion
          de sus secretos comerciales conforme a la ley chilena. Nos reservamos
          el uso de mecanismos tecnicos de deteccion de estos usos.
        </p>
      </LegalSection>

      <LegalSection title="Emision y proveedores">
        <p>
          Algunas emisiones dependen del SII, configuraciones locales,
          certificados, CAF, SimpleAPI, navegador o extension. MassDTE registra
          estados y evidencias operativas, pero el usuario debe validar que el
          resultado tributario sea correcto para su caso.
        </p>
      </LegalSection>

      <LegalSection title="Emisor y responsabilidad">
        <p>
          El unico emisor de cada boleta o documento tributario ante el SII es el
          usuario (su RUT, sus credenciales, sus folios). MassDTE es una
          herramienta de apoyo que propone y automatiza pasos; la decision de
          emitir es siempre del usuario y ninguna boleta se emite sin su accion.
          MassDTE no responde por el contenido tributario de documentos emitidos
          a partir de informacion ingresada, aprobada o corregida por el usuario.
        </p>
      </LegalSection>

      <LegalSection title="Prueba gratis">
        <p>
          La prueba gratuita se otorga sin contraprestacion, con los limites de
          dias y boletas vigentes al momento de activarla, y puede ajustarse o
          retirarse por abuso. Al terminar la prueba no se realiza ningun cobro
          automatico: contratar un plan es siempre una accion voluntaria del
          usuario.
        </p>
      </LegalSection>

      <LegalSection title="Planes y pagos">
        <p>
          Los planes, cupos, add-ons y pagos se controlan por cuenta pagadora.
          MassDTE puede bloquear funciones si el plan esta inactivo, el cupo se
          agoto o existe un problema de pago.
        </p>
      </LegalSection>

      <LegalSection title="Suspension">
        <p>
          Podemos suspender acceso ante abuso, riesgo de seguridad, actividad
          fraudulenta, incumplimiento de estos terminos o requerimiento legal.
        </p>
      </LegalSection>
    </LegalShell>
  );
}

export const metadata = {
  title: "Terminos de uso | MassDTE",
};
