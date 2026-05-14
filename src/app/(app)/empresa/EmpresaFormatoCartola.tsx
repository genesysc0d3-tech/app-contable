"use client";

import CartolaMapperDragDrop from "@/components/mapping/CartolaMapperDragDrop";

export default function EmpresaFormatoCartola({ empresaId }: { empresaId: string }) {
  return <CartolaMapperDragDrop empresaId={empresaId} />;
}
