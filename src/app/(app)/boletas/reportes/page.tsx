import ReportesClient from "./ReportesClient";

export default function BoletasReportesPage() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-6 pb-24 space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Reporte RCV</h1>
        <p className="text-sm text-[#888] dark:text-white/60 mt-1">
          Registro de ventas del mes — borrador para cuadrar con el RCV que el SII propone a fin de mes.
        </p>
      </header>
      <ReportesClient />
    </main>
  );
}
