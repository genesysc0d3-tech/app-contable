import { LegalSection, LegalShell } from "../LegalShell";
import { POLICY_VERSION } from "@/lib/legal/version";

export default function PrivacidadExtensionPage() {
  return (
    <LegalShell title="Privacidad de la extensión — App Contable Motor Local">
      <p style={{ marginTop: 0, fontSize: 13, fontWeight: 700 }}>Última actualización: {POLICY_VERSION}</p>

      <p>
        Esta política describe cómo la extensión de Chrome <strong>App Contable Motor Local</strong>{" "}
        (&laquo;la Extensión&raquo;) trata los datos. La Extensión es parte del servicio MassDTE,
        operado por AlphaCode SpA, y complementa la{" "}
        <a href="/legal/privacidad">Política de privacidad general</a>. Durante la beta controlada,
        el contacto para asuntos de datos personales es el canal de soporte de MassDTE.
      </p>

      <LegalSection title="1. Qué datos maneja la Extensión">
        <p>
          Tus credenciales del SII (RUT y Clave Tributaria) y, si usás emisión por certificado, la
          contraseña del certificado, que ingresás vos en la Extensión; más su configuración local
          (proveedor de emisión, estado de la bóveda). La Extensión no recolecta tu historial de
          navegación, no lee cookies del SII hacia la app y no solicita permisos sobre
          &laquo;todos los sitios&raquo;.
        </p>
      </LegalSection>

      <LegalSection title="2. Cómo se protegen">
        <p>
          Las credenciales se guardan cifradas en tu equipo (AES-GCM) bajo un esquema de llave
          partida (envelope): la llave para descifrarlas está dividida en dos, y una mitad vive solo
          en el servidor de MassDTE, que la entrega únicamente a tu sesión iniciada con permiso de
          emisión. Sin iniciar sesión, lo guardado en tu equipo no puede descifrarse. MassDTE nunca
          ve tus credenciales del SII en texto claro. Podés desconectar tu clave en todos tus
          equipos en cualquier momento (kill-switch), lo que revoca la mitad del servidor y deja lo
          local inservible.
        </p>
      </LegalSection>

      <LegalSection title="3. Para qué se usan">
        <p>
          Exclusivamente para autenticarte y emitir boletas electrónicas en el Portal del SII por tu
          cuenta, a partir de las propuestas que aprobaste en la app. La Extensión abre una ventana
          del Portal del SII con tu sesión, completa la boleta y devuelve el folio emitido a la app.
        </p>
      </LegalSection>

      <LegalSection title="4. Qué NO hacemos">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>No vendemos ni transferimos tus datos a terceros.</li>
          <li>No los usamos para publicidad, evaluación de solvencia ni fines ajenos a la emisión.</li>
          <li>No ejecutamos código remoto: todo el código de la Extensión viaja en el paquete.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Terceros">
        <p>
          La Extensión interactúa con el Portal del SII (sii.cl / eboleta.sii.cl) &mdash; el
          organismo tributario ante el cual emitís &mdash; y con el servidor de MassDTE para recibir
          los trabajos de emisión y guardar el folio. No hay otros terceros.
        </p>
      </LegalSection>

      <LegalSection title="6. Tus derechos">
        <p>
          Podés acceder, rectificar, eliminar y portar tus datos, y revocar la conexión de tu clave,
          a través del canal de soporte de MassDTE o desde la app (Ley 19.628 y Ley 21.719).
        </p>
      </LegalSection>

      <LegalSection title="7. Cambios">
        <p>Publicaremos cualquier cambio en esta misma URL con su fecha de actualización.</p>
      </LegalSection>
    </LegalShell>
  );
}

export const metadata = {
  title: "Privacidad de la extensión | MassDTE",
};
