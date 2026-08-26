// Skeleton instantáneo de la mesa de trabajo: aparece al toque en cada
// navegación del calendario (día/semana/mes, ‹ ›, elegir día) Y en el F5
// (streaming del App Router) mientras el server resuelve los datos. Mata la
// sensación de "congelado" y habilita el prefetch de la ruta.
// El markup vive en MesaSkeleton (compartido con /shell, el fallback offline
// del Service Worker) — antes estaba clavado en tema oscuro y con una grilla
// que no calzaba con la real; ambos bugs arreglados en el componente.
import MesaSkeleton from "@/components/MesaSkeleton";

export default function MesaLoading() {
  return <MesaSkeleton />;
}
