import { LegalSection, LegalShell } from "./LegalShell";

export default function LegalPage() {
  return (
    <LegalShell title="Legal">
      <LegalSection title="Documentos publicos">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li><a href="/legal/privacidad">Politica de privacidad</a></li>
          <li><a href="/legal/terminos">Terminos de uso</a></li>
          <li><a href="/legal/seguridad">Seguridad e incidentes</a></li>
        </ul>
      </LegalSection>
    </LegalShell>
  );
}

export const metadata = {
  title: "Legal | MassDTE",
};
