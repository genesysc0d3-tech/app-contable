// Las pantallas de auth (login/registro) siguen la estética de la landing:
// fondo negro + acento coral + texto blanco, SIEMPRE en oscuro, independiente
// del toggle claro/oscuro del resto del app. Forzar `.dark` hace que glass /
// mesh-bg / glow-accent rindan sus variantes oscuras (coral).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark min-h-screen flex flex-col bg-[#0a0a0a] text-white">
      {children}
    </div>
  );
}
