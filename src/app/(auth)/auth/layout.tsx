import BrandPanel from "../BrandPanel";

// La ESCENA (boletas cayendo) vive en el layout: persiste entre /auth/login y
// /auth/registro — navegar entre ellos no la remonta ni reinicia animaciones.
// Las páginas solo ponen su tarjeta encima.
export default function AuthPagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BrandPanel />
      {children}
    </>
  );
}
