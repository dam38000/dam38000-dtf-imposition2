const express = require('express');
const router = express.Router();
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { jsPDF } = require('jspdf');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const TMP_DIR = path.join(__dirname, '..', 'tmp');

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

    // Préparer les composites
    const composites = [];
    for (const item of items) {
      const convertedPath = path.join(UPLOADS_DIR, item.file_id, 'converted.png');
      if (!fs.existsSync(convertedPath)) {
        return res.status(404).json({ error: `Fichier non trouvé: ${item.file_id}` });
      }

      let imgBuffer;
      if (item.rotated) {
        // Pivoter 90° puis redimensionner : après rotation, W et H sont inversés
        imgBuffer = await sharp(convertedPath)
          .rotate(90)
          .resize(mmToPx(item.realW), mmToPx(item.realH), { fit: 'fill' })
          .toBuffer();
      } else {
        imgBuffer = await sharp(convertedPath)
          .resize(mmToPx(item.realW), mmToPx(item.realH), { fit: 'fill' })
          .toBuffer();
      }

      composites.push({
        input: imgBuffer,
        left: mmToPx(item.x),
        top: mmToPx(item.y),
      });
    }

    // Créer le canvas transparent et assembler
    const resultBuffer = await sharp({
      create: {
        width: canvasW,
        height: canvasH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .composite(composites)
      .withMetadata({ density: 300 })
      .png({ compressionLevel: 6 })
      .toBuffer();

    // Sauvegarder temporairement
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const outName = `dessin_${uuidv4()}.png`;
    const outPath = path.join(TMP_DIR, outName);
    fs.writeFileSync(outPath, resultBuffer);

    res.download(outPath, 'dessin_300dpi.png', () => {
      try { fs.unlinkSync(outPath); } catch {}
    });

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

    // Traits de coupe rouges
    doc.setDrawColor(255, 0, 0);
    doc.setLineWidth(0.1);

    for (const item of items) {
      const rx = item.x - margin;
      const ry = item.y - margin;
      let rw, rh;
      if (item.rotated) {
        rw = item.realW + 2 * margin;
        rh = item.realH + 2 * margin;
      } else {
        rw = item.realW + 2 * margin;
        rh = item.realH + 2 * margin;
      }
      doc.rect(rx, ry, rw, rh, 'S');
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

    const doc = new jsPDF({
      orientation: sheet_size.w >= sheet_size.h ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [sheet_size.w, sheet_size.h],
    });

    // 1. Ajouter les images
    for (const item of items) {
      const convertedPath = path.join(UPLOADS_DIR, item.file_id, 'converted.png');
      if (!fs.existsSync(convertedPath)) {
        return res.status(404).json({ error: `Fichier non trouvé: ${item.file_id}` });
      }

      let imgBuffer;
      if (item.rotated) {
        imgBuffer = await sharp(convertedPath).rotate(90).png().toBuffer();
      } else {
        imgBuffer = await sharp(convertedPath).png().toBuffer();
      }

      const base64 = imgBuffer.toString('base64');
      const dataUrl = 'data:image/png;base64,' + base64;

      doc.addImage(dataUrl, 'PNG', item.x, item.y, item.realW, item.realH);
    }

    // 2. Dessiner les traits de coupe par-dessus
    doc.setDrawColor(255, 0, 0);
    doc.setLineWidth(0.1);

    for (const item of items) {
      const rx = item.x - margin;
      const ry = item.y - margin;
      let rw, rh;
      if (item.rotated) {
        rw = item.realW + 2 * margin;
        rh = item.realH + 2 * margin;
      } else {
        rw = item.realW + 2 * margin;
        rh = item.realH + 2 * margin;
      }
      doc.rect(rx, ry, rw, rh, 'S');
    }

    const pdfBuffer = Buffer.from(doc.output('arraybuffer'));

    fs.mkdirSync(TMP_DIR, { recursive: true });
    const outName = `composite_${uuidv4()}.pdf`;
    const outPath = path.join(TMP_DIR, outName);
    fs.writeFileSync(outPath, pdfBuffer);

    res.download(outPath, 'composite.pdf', () => {
      try { fs.unlinkSync(outPath); } catch {}
    });

  } catch (err) {
    console.error('Erreur export composite:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
