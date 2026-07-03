// Aplica el tema ANTES del primer paint (script inline al inicio del <body>,
// sin FOUC). El default de MARCA es OSCURO: sin preferencia guardada en
// localStorage("theme") se aplica .dark; solo "light" explícito lo quita
// (no se respeta prefers-color-scheme del OS). La clase .dark en <html> es
// la ÚNICA señal de tema: la consumen globals.css, Toast y los tokens del v5.
const THEME_SCRIPT = `try{document.documentElement.classList.toggle("dark",localStorage.getItem("theme")!=="light")}catch(e){document.documentElement.classList.add("dark")}`;

export default function ThemeInitializer() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
