// ============================================================
//  useExport.js — Exports PNG 300 DPI, PDF coupe, PDF composite
// ============================================================

export function useExport({ sheets, currentSheetIndex, margin, sheetSize, productMode, selectedFormat, impositionMode, setIsCalculating, setErrorAlert }) {

  // ── Utilitaire : injecter DPI dans PNG (pHYs chunk) ──
  const pngSetDpi = (dataUrl, dpi) => {
    const base64 = dataUrl.split(',')[1];
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ppm = Math.round(dpi / 0.0254);
    const phys = new Uint8Array(21);
    const dv = new DataView(phys.buffer);
    dv.setUint32(0, 9);
    phys[4] = 0x70; phys[5] = 0x48; phys[6] = 0x59; phys[7] = 0x73;
    dv.setUint32(8, ppm); dv.setUint32(12, ppm); phys[16] = 1;
    const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
    let crc = 0xFFFFFFFF;
    for (let i = 4; i <= 16; i++) crc = crcTable[(crc ^ phys[i]) & 0xFF] ^ (crc >>> 8);
    crc ^= 0xFFFFFFFF;
    dv.setUint32(17, crc >>> 0);
    const insertPos = 33;
    let cleanBytes = bytes;
    let pos = 8;
    while (pos < cleanBytes.length - 12) {
      const chunkLen = (cleanBytes[pos] << 24) | (cleanBytes[pos+1] << 16) | (cleanBytes[pos+2] << 8) | cleanBytes[pos+3];
      const chunkType = String.fromCharCode(cleanBytes[pos+4], cleanBytes[pos+5], cleanBytes[pos+6], cleanBytes[pos+7]);
      if (chunkType === 'pHYs') { const before = cleanBytes.slice(0, pos); const after = cleanBytes.slice(pos + 12 + chunkLen); const merged = new Uint8Array(before.length + after.length); merged.set(before); merged.set(after, before.length); cleanBytes = merged; break; }
      pos += 12 + chunkLen;
    }
    const result = new Uint8Array(cleanBytes.length + phys.length);
    result.set(cleanBytes.slice(0, insertPos)); result.set(phys, insertPos); result.set(cleanBytes.slice(insertPos), insertPos + phys.length);
    let binStr = ''; for (let i = 0; i < result.length; i++) binStr += String.fromCharCode(result[i]);
    return 'data:image/png;base64,' + btoa(binStr);
  };

  // ── Utilitaire : pivoter une image 90° ──
  const rotateImage = (src, w, h) => {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas'), scale = 4;
        canvas.width = h * scale; canvas.height = w * scale;
        const ctx = canvas.getContext('2d');
        ctx.translate((h * scale) / 2, (w * scale) / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(img, -(w * scale) / 2, -(h * scale) / 2, w * scale, h * scale);
        res(canvas.toDataURL('image/png'));
      };
      img.src = src;
    });
  };

  // ── Mapper les items pour l'export ──
  const mapExportItems = () => {
    const sheet = sheets[currentSheetIndex];
    if (!sheet) return null;
    return sheet.items.map(item => ({
      file_id: item.fileId,
      x: item.x + margin,
      y: item.y + margin,
      realW: item.rotated ? item.realH : item.realW,
      realH: item.rotated ? item.realW : item.realH,
      rotated: item.rotated,
    }));
  };

  // ── Export 1 : Montage PNG 300 DPI ──
  const handleExportPNG = async () => {
    if (sheets.length === 0) return;
    setIsCalculating(true);
    try {
      const exportItems = mapExportItems();
      const resp = await fetch('/api/export/dessin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet_size: sheetSize, items: exportItems }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `montage-${productMode}-${selectedFormat}-dessin.png`;
      link.href = url; link.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error('Erreur Export PNG:', err); }
    finally { setIsCalculating(false); }
  };

  // ── Export 2 : Coupe PDF ──
  const handleExportCut = async () => {
    if (sheets.length === 0) return;
    setIsCalculating(true);
    try {
      const exportItems = mapExportItems();
      const resp = await fetch('/api/export/coupe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet_size: sheetSize, items: exportItems, margin, mode: impositionMode }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `montage-${productMode}-${selectedFormat}-coupe.pdf`;
      link.href = url; link.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error('Erreur Export Coupe:', err); }
    finally { setIsCalculating(false); }
  };

  // ── Export 3 : Composite PDF ──
  const handleExportComposite = async () => {
    if (sheets.length === 0) return;
    setIsCalculating(true);
    try {
      const exportItems = mapExportItems();
      const resp = await fetch('/api/export/composite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet_size: sheetSize, items: exportItems, margin, mode: impositionMode }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `montage-${productMode}-${selectedFormat}-composite.pdf`;
      link.href = url; link.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error('Erreur Export Composite:', err); }
    finally { setIsCalculating(false); }
  };

  return {
    pngSetDpi,
    rotateImage,
    handleExportPNG,
    handleExportCut,
    handleExportComposite,
  };
}
