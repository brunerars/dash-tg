import * as XLSX from "xlsx";

self.onmessage = async (e: MessageEvent<ArrayBuffer[]>) => {
  const buffers = e.data;
  const allValues = new Set<string>();

  for (const buf of buffers) {
    try {
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets["Tips Enviadas"];
      if (!ws) continue;

      // Find "Horário Jogo" column index from header row
      const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      let colIdx = -1;
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
        const header = cell ? String(cell.v).trim() : "";
        if (header === "Horário Jogo" || header === "Horario Jogo") {
          colIdx = c;
          break;
        }
      }
      if (colIdx === -1) continue;

      // Read only that column
      for (let r = 1; r <= range.e.r; r++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c: colIdx })];
        if (!cell) continue;
        const val = cell.w ?? String(cell.v);
        if (val && val.trim()) allValues.add(val.trim());
      }
    } catch {
      // skip unreadable files
    }
  }

  self.postMessage(Array.from(allValues).sort());
};
