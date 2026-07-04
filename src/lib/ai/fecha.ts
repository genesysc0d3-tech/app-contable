const MESES: Record<string, string> = {
  enero: "01", ene: "01",
  febrero: "02", feb: "02",
  marzo: "03", mar: "03",
  abril: "04", abr: "04",
  mayo: "05", may: "05",
  junio: "06", jun: "06",
  julio: "07", jul: "07",
  agosto: "08", ago: "08",
  septiembre: "09", sep: "09", sept: "09",
  octubre: "10", oct: "10",
  noviembre: "11", nov: "11",
  diciembre: "12", dic: "12",
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function isValidDate(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function formatValid(y: number, m: number, d: number): string | null {
  if (!isValidDate(y, m, d)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseFecha(raw: string): string {
  if (!raw || typeof raw !== "string") return today();

  const s = raw.trim();

  // Already YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const r = formatValid(+isoMatch[1], +isoMatch[2], +isoMatch[3]);
    if (r) return r;
  }

  // YYYY/MM/DD or YYYY:MM:DD
  const isoAlt = s.match(/^(\d{4})[/:](\d{1,2})[/:](\d{1,2})/);
  if (isoAlt) {
    const r = formatValid(+isoAlt[1], +isoAlt[2], +isoAlt[3]);
    if (r) return r;
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy) {
    const r = formatValid(+dmy[3], +dmy[2], +dmy[1]);
    if (r) return r;
  }

  // DD/MM/YY or DD-MM-YY
  const dmy2 = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2})$/);
  if (dmy2) {
    const year = +dmy2[3] + (+dmy2[3] > 50 ? 1900 : 2000);
    const r = formatValid(year, +dmy2[2], +dmy2[1]);
    if (r) return r;
  }

  // "06 de noviembre 2025", "6 noviembre 2025", "06-nov-2025", "6 nov. 2025"
  const textDate = s
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/ de /g, " ");
  const textMatch = textDate.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (textMatch) {
    const mes = MESES[textMatch[2]];
    if (mes) {
      const r = formatValid(+textMatch[3], +mes, +textMatch[1]);
      if (r) return r;
    }
  }

  // "noviembre 06, 2025" or "nov 6, 2025"
  const textMatch2 = textDate.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (textMatch2) {
    const mes = MESES[textMatch2[1]];
    if (mes) {
      const r = formatValid(+textMatch2[3], +mes, +textMatch2[2]);
      if (r) return r;
    }
  }

  // Fallback: try native Date parse
  const native = new Date(s);
  if (!isNaN(native.getTime())) {
    const r = formatValid(native.getFullYear(), native.getMonth() + 1, native.getDate());
    if (r) return r;
  }

  return today();
}
