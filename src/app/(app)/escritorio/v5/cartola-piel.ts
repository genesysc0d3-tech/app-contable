// Piel premium de las filas del popup Editar (CartolaEditor) y de la pantalla Preguntas.
/* Piel premium (2026-09-01, pedido fundador: el estilo del landing con TODA
   la info): filas como cards con profundidad y aire, tipografía legible,
   acciones que aparecen al hover — cero dato eliminado. */
export const CE_CSS = `
.ce-scroll{scrollbar-width:thin;padding:4px 0 10px;}
.ce-row{display:flex;align-items:center;gap:9px;padding:10px 13px;margin:5px 14px 0;cursor:pointer;
  border:1px solid color-mix(in srgb, var(--text) 8%, transparent);border-radius:12px;
  background:linear-gradient(165deg, color-mix(in srgb, var(--text) 4%, var(--surface)), var(--surface));
  transition:border-color .18s, box-shadow .18s, transform .18s;}
.ce-row:hover{border-color:color-mix(in srgb, var(--text) 18%, transparent);box-shadow:0 6px 18px rgba(0,0,0,.28);transform:translateY(-1px);}
.ce-row.ce-fin{cursor:default;background:transparent;border-color:color-mix(in srgb, var(--text) 5%, transparent);}
.ce-row.ce-fin:hover{border-color:color-mix(in srgb, var(--text) 5%, transparent);box-shadow:none;transform:none;}
.ce-reject{opacity:.22;transition:opacity .15s;}
.ce-row:hover .ce-reject,.ce-reject:hover{opacity:1;}
.ce-stat{display:inline-flex;align-items:center;gap:6px;border:1px solid transparent;background:transparent;cursor:pointer;font-size:12px;font-weight:600;color:var(--text2);padding:4px 9px;border-radius:99px;}
.ce-stat:hover{background:color-mix(in srgb, var(--text) 6%, transparent);border-color:color-mix(in srgb, var(--text) 10%, transparent);color:var(--text);}
`;

