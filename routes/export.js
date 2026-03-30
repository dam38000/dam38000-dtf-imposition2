const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { jsPDF } = require('jspdf');
const { execSync } = require('child_process');

const zlib = require('zlib');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const TMP_DIR = path.join(__dirname, '..', 'tmp');
const ECIRGB_PROFILE = path.join(__dirname, '..', 'profiles', 'eciRGB_v2.icc');

// Conversion mm → pixels à 300 DPI
function mmToPx(mm) {
  return Math.round(mm * 300 / 25.4);
}

// =============================================================
// ROUTE 1 : POST /api/export/dessin
// Génère un PNG 300 DPI avec les images placées sur la planche
// =============================================================
router.post('/dessin', async (req, res) => {
  try {
    const { sheet_size, items } = req.body;
    if (!sheet_size || !items) {
      return res.status(400).json({ error: 'sheet_size et items requis' });
    }

    const canvasW = mmToPx(sheet_size.w);
    const canvasH = mmToPx(sheet_size.h);

    fs.mkdirSync(TMP_DIR, { recursive: true });
    const jobId = uuidv4();
    const tmpFiles = [];

    // Créer le canvas transparent avec le profil eciRGB v2 (évite conversion couleur à la composition)
    const canvasPath = path.join(TMP_DIR, `canvas_${jobId}.png`);
    execSync(`magick -size ${canvasW}x${canvasH} xc:none -profile "${ECIRGB_PROFILE}" -density 300 -units PixelsPerInch PNG32:"${canvasPath}"`, { stdio: 'pipe' });
    tmpFiles.push(canvasPath);

    // Composer chaque image sur le canvas
    let currentCanvas = canvasPath;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const convertedPath = path.join(UPLOADS_DIR, item.file_id, 'converted.png');
      if (!fs.existsSync(convertedPath)) {
        tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
        return res.status(404).json({ error: `Fichier non trouvé: ${item.file_id}` });
      }

      const pxW = mmToPx(item.realW);
      const pxH = mmToPx(item.realH);
      const pxX = mmToPx(item.x);
      const pxY = mmToPx(item.y);

      // Préparer l'image : strip profil + resize (pas de conversion couleur)
      const preparedPath = path.join(TMP_DIR, `prep_${jobId}_${i}.png`);
      if (item.rotated) {
        execSync(`magick "${convertedPath}" -rotate 90 -resize ${pxW}x${pxH}! "${preparedPath}"`, { stdio: 'pipe' });
      } else {
        execSync(`magick "${convertedPath}" -resize ${pxW}x${pxH}! "${preparedPath}"`, { stdio: 'pipe' });
      }
      tmpFiles.push(preparedPath);

      // Composer sur le canvas
      const nextCanvas = path.join(TMP_DIR, `canvas_${jobId}_${i}.png`);
      execSync(`magick "${currentCanvas}" "${preparedPath}" -geometry +${pxX}+${pxY} -composite "${nextCanvas}"`, { stdio: 'pipe' });
      tmpFiles.push(nextCanvas);
      currentCanvas = nextCanvas;
    }

    // Densité 300 DPI sur le résultat final
    const outPath = path.join(TMP_DIR, `dessin_${jobId}.png`);
    execSync(`magick "${currentCanvas}" -density 300 -units PixelsPerInch "${outPath}"`, { stdio: 'pipe' });
    tmpFiles.push(outPath);

    // Injecter le profil ICC eciRGB v2 dans le PNG (sans conversion de pixels)
    injectIccProfile(outPath, ECIRGB_PROFILE);

    // Debug : garder les fichiers temporaires
    res.download(outPath, 'dessin_300dpi.png');

  } catch (err) {
    console.error('Erreur export dessin:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// ROUTE 2 : POST /api/export/coupe
// Génère un PDF vectoriel avec les traits de coupe
// =============================================================
router.post('/coupe', async (req, res) => {
  try {
    const { sheet_size, items, margin = 5, mode = 'massicot' } = req.body;
    if (!sheet_size || !items) {
      return res.status(400).json({ error: 'sheet_size et items requis' });
    }

    const doc = new jsPDF({
      orientation: sheet_size.w >= sheet_size.h ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [sheet_size.w, sheet_size.h],
    });

    // Recalculer les coordonnées de cellule (item.x/y sont le coin de l'image, la cellule inclut la marge)
    const cells = items.map(item => ({
      x: item.x - margin,
      y: item.y - margin,
      w: item.realW + 2 * margin,
      h: item.realH + 2 * margin,
    }));

    // 1. Traits rouges — bordure au bord de chaque cellule (se superposent entre adjacents)
    doc.setDrawColor(220, 38, 38); // #dc2626
    doc.setLineWidth(0.15);
    for (const cell of cells) {
      doc.rect(cell.x, cell.y, cell.w, cell.h, 'S');
    }

    // 2. Traits bleus — coupes massicot récursives (uniquement en mode massicot)
    if (mode === 'massicot') {
      const EPSILON = 0.5;
      const cuts = [];

      const findCuts = (zone, zoneItems) => {
        if (zoneItems.length <= 1) return;
        const candidatesY = new Set();
        const candidatesX = new Set();
        zoneItems.forEach(c => {
          candidatesY.add(Math.round(c.y * 10) / 10);
          candidatesY.add(Math.round((c.y + c.h) * 10) / 10);
          candidatesX.add(Math.round(c.x * 10) / 10);
          candidatesX.add(Math.round((c.x + c.w) * 10) / 10);
        });
        const hValid = Array.from(candidatesY).filter(y => {
          if (y <= zone.top + EPSILON || y >= zone.bottom - EPSILON) return false;
          return !zoneItems.some(c => y > c.y + EPSILON && y < c.y + c.h - EPSILON);
        }).sort((a, b) => a - b);
        const vValid = Array.from(candidatesX).filter(x => {
          if (x <= zone.left + EPSILON || x >= zone.right - EPSILON) return false;
          return !zoneItems.some(c => x > c.x + EPSILON && x < c.x + c.w - EPSILON);
        }).sort((a, b) => a - b);

        if (hValid.length > 0) {
          hValid.forEach(y => cuts.push({ type: 'h', pos: y, left: zone.left, right: zone.right }));
          const bands = [zone.top, ...hValid, zone.bottom];
          for (let i = 0; i < bands.length - 1; i++) {
            const sub = { left: zone.left, right: zone.right, top: bands[i], bottom: bands[i + 1] };
            const subItems = zoneItems.filter(c => c.y >= sub.top - EPSILON && c.y + c.h <= sub.bottom + EPSILON);
            if (subItems.length > 1) findCuts(sub, subItems);
          }
          return;
        }
        if (vValid.length > 0) {
          vValid.forEach(x => cuts.push({ type: 'v', pos: x, top: zone.top, bottom: zone.bottom }));
          const cols = [zone.left, ...vValid, zone.right];
          for (let i = 0; i < cols.length - 1; i++) {
            const sub = { left: cols[i], right: cols[i + 1], top: zone.top, bottom: zone.bottom };
            const subItems = zoneItems.filter(c => c.x >= sub.left - EPSILON && c.x + c.w <= sub.right + EPSILON);
            if (subItems.length > 1) findCuts(sub, subItems);
          }
          return;
        }
      };

      findCuts({ left: 0, top: 0, right: sheet_size.w, bottom: sheet_size.h }, cells);

      doc.setDrawColor(37, 99, 235); // #2563eb
      doc.setLineWidth(0.2);
      cuts.forEach(cut => {
        if (cut.type === 'h') doc.line(cut.left, cut.pos, cut.right, cut.pos);
        else doc.line(cut.pos, cut.top, cut.pos, cut.bottom);
      });
    }

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    fs.mkdirSync(TMP_DIR, { recursive: true });
    const outName = `coupe_${uuidv4()}.pdf`;
    const outPath = path.join(TMP_DIR, outName);
    fs.writeFileSync(outPath, pdfBuffer);

    res.download(outPath, 'coupe.pdf', () => {
      try { fs.unlinkSync(outPath); } catch {}
    });

  } catch (err) {
    console.error('Erreur export coupe:', err);
    res.status(500).json({ error: err.message });
  }
});

// =============================================================
// ROUTE 3 : POST /api/export/composite
// Génère un PDF avec images + traits de coupe superposés
// =============================================================
router.post('/composite', async (req, res) => {
  try {
    const { sheet_size, items, margin = 5, mode = 'massicot' } = req.body;
    if (!sheet_size || !items) {
      return res.status(400).json({ error: 'sheet_size et items requis' });
    }

    fs.mkdirSync(TMP_DIR, { recursive: true });
    const jobId = uuidv4();
    const tmpFiles = [];

    const doc = new jsPDF({
      orientation: sheet_size.w >= sheet_size.h ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [sheet_size.w, sheet_size.h],
    });

    // 1. Ajouter les images (ImageMagick pour rotation, lecture directe sinon)
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const convertedPath = path.join(UPLOADS_DIR, item.file_id, 'converted.png');
      if (!fs.existsSync(convertedPath)) {
        tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
        return res.status(404).json({ error: `Fichier non trouvé: ${item.file_id}` });
      }

      let imgBuffer;
      if (item.rotated) {
        const rotatedPath = path.join(TMP_DIR, `rot_${jobId}_${i}.png`);
        execSync(`magick "${convertedPath}" -rotate 90 "${rotatedPath}"`, { stdio: 'pipe' });
        tmpFiles.push(rotatedPath);
        imgBuffer = fs.readFileSync(rotatedPath);
      } else {
        imgBuffer = fs.readFileSync(convertedPath);
      }

      const base64 = imgBuffer.toString('base64');
      const dataUrl = 'data:image/png;base64,' + base64;

      doc.addImage(dataUrl, 'PNG', item.x, item.y, item.realW, item.realH);
    }

    // 2. Traits rouges — bordure au bord de chaque cellule
    const cells = items.map(item => ({
      x: item.x - margin,
      y: item.y - margin,
      w: item.realW + 2 * margin,
      h: item.realH + 2 * margin,
    }));

    doc.setDrawColor(220, 38, 38); // #dc2626
    doc.setLineWidth(0.15);
    for (const cell of cells) {
      doc.rect(cell.x, cell.y, cell.w, cell.h, 'S');
    }

    // 3. Traits bleus — coupes massicot récursives (uniquement en mode massicot)
    if (mode === 'massicot') {
      const EPSILON = 0.5;
      const cuts = [];

      const findCuts = (zone, zoneItems) => {
        if (zoneItems.length <= 1) return;
        const candidatesY = new Set();
        const candidatesX = new Set();
        zoneItems.forEach(c => {
          candidatesY.add(Math.round(c.y * 10) / 10);
          candidatesY.add(Math.round((c.y + c.h) * 10) / 10);
          candidatesX.add(Math.round(c.x * 10) / 10);
          candidatesX.add(Math.round((c.x + c.w) * 10) / 10);
        });
        const hValid = Array.from(candidatesY).filter(y => {
          if (y <= zone.top + EPSILON || y >= zone.bottom - EPSILON) return false;
          return !zoneItems.some(c => y > c.y + EPSILON && y < c.y + c.h - EPSILON);
        }).sort((a, b) => a - b);
        const vValid = Array.from(candidatesX).filter(x => {
          if (x <= zone.left + EPSILON || x >= zone.right - EPSILON) return false;
          return !zoneItems.some(c => x > c.x + EPSILON && x < c.x + c.w - EPSILON);
        }).sort((a, b) => a - b);

        if (hValid.length > 0) {
          hValid.forEach(y => cuts.push({ type: 'h', pos: y, left: zone.left, right: zone.right }));
          const bands = [zone.top, ...hValid, zone.bottom];
          for (let i = 0; i < bands.length - 1; i++) {
            const sub = { left: zone.left, right: zone.right, top: bands[i], bottom: bands[i + 1] };
            const subItems = zoneItems.filter(c => c.y >= sub.top - EPSILON && c.y + c.h <= sub.bottom + EPSILON);
            if (subItems.length > 1) findCuts(sub, subItems);
          }
          return;
        }
        if (vValid.length > 0) {
          vValid.forEach(x => cuts.push({ type: 'v', pos: x, top: zone.top, bottom: zone.bottom }));
          const cols = [zone.left, ...vValid, zone.right];
          for (let i = 0; i < cols.length - 1; i++) {
            const sub = { left: cols[i], right: cols[i + 1], top: zone.top, bottom: zone.bottom };
            const subItems = zoneItems.filter(c => c.x >= sub.left - EPSILON && c.x + c.w <= sub.right + EPSILON);
            if (subItems.length > 1) findCuts(sub, subItems);
          }
          return;
        }
      };

      findCuts({ left: 0, top: 0, right: sheet_size.w, bottom: sheet_size.h }, cells);

      doc.setDrawColor(37, 99, 235); // #2563eb
      doc.setLineWidth(0.2);
      cuts.forEach(cut => {
        if (cut.type === 'h') doc.line(cut.left, cut.pos, cut.right, cut.pos);
        else doc.line(cut.pos, cut.top, cut.pos, cut.bottom);
      });
    }

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    const outPath = path.join(TMP_DIR, `composite_${jobId}.pdf`);
    fs.writeFileSync(outPath, pdfBuffer);

    res.download(outPath, 'composite.pdf', () => {
      tmpFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
      try { fs.unlinkSync(outPath); } catch {}
    });

  } catch (err) {
    console.error('Erreur export composite:', err);
    res.status(500).json({ error: err.message });
  }
});

// Injecte un profil ICC dans un PNG sans convertir les pixels
// Crée un chunk iCCP avec le profil compressé et l'insère après le IHDR
function injectIccProfile(pngPath, iccPath) {
  const png = fs.readFileSync(pngPath);
  const iccData = fs.readFileSync(iccPath);
  const profileName = 'eciRGB v2';

  // Compresser le profil ICC avec zlib deflate
  const compressed = zlib.deflateSync(iccData);

  // Construire le chunk iCCP : nom + null + compression_method(0) + données compressées
  const nameBuf = Buffer.from(profileName, 'ascii');
  const nullByte = Buffer.from([0x00]); // séparateur null
  const compMethod = Buffer.from([0x00]); // méthode compression = deflate
  const chunkData = Buffer.concat([nameBuf, nullByte, compMethod, compressed]);

  // Chunk = length(4) + type(4) + data + crc(4)
  const chunkType = Buffer.from('iCCP', 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(chunkData.length);

  const crcInput = Buffer.concat([chunkType, chunkData]);
  const crc = zlib.crc32(crcInput);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc >>> 0);

  const iccpChunk = Buffer.concat([lenBuf, chunkType, chunkData, crcBuf]);

  // Trouver la fin du chunk IHDR (signature PNG = 8 octets, puis IHDR)
  // IHDR est toujours le premier chunk : pos=8, length=4bytes, type=4bytes, data=13bytes, crc=4bytes
  const ihdrLen = png.readUInt32BE(8);
  const afterIhdr = 8 + 4 + 4 + ihdrLen + 4; // après signature + IHDR complet

  // Supprimer un éventuel iCCP existant
  let cleanPng = png;
  let pos = 8;
  while (pos < cleanPng.length) {
    const cLen = cleanPng.readUInt32BE(pos);
    const cType = cleanPng.toString('ascii', pos + 4, pos + 8);
    const chunkTotal = 4 + 4 + cLen + 4;
    if (cType === 'iCCP' || cType === 'sRGB') {
      // Supprimer ce chunk
      cleanPng = Buffer.concat([cleanPng.slice(0, pos), cleanPng.slice(pos + chunkTotal)]);
      // Ne pas avancer pos, le prochain chunk est maintenant à la même position
    } else {
      pos += chunkTotal;
    }
  }

  // Recalculer afterIhdr sur le PNG nettoyé
  const cleanIhdrLen = cleanPng.readUInt32BE(8);
  const cleanAfterIhdr = 8 + 4 + 4 + cleanIhdrLen + 4;

  // Insérer le chunk iCCP juste après IHDR
  const before = cleanPng.slice(0, cleanAfterIhdr);
  const after = cleanPng.slice(cleanAfterIhdr);
  const result = Buffer.concat([before, iccpChunk, after]);

  fs.writeFileSync(pngPath, result);
}

module.exports = router;
