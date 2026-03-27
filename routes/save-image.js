const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// POST /api/save-image/:id
// Reçoit un dataUrl (PNG base64) et écrase converted.png + régénère la miniature
router.post('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { dataUrl } = req.body;

    if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) {
      return res.status(400).json({ error: 'dataUrl PNG base64 requis' });
    }

    const jobDir = path.join(__dirname, '..', 'uploads', id);
    if (!fs.existsSync(jobDir)) {
      return res.status(404).json({ error: 'Dossier introuvable' });
    }

    // Décoder le base64 et écrire converted.png
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const convertedPath = path.join(jobDir, 'converted.png');
    fs.writeFileSync(convertedPath, buffer);

    // Régénérer la miniature avec sharp
    const sharp = require('sharp');
    const metadata = await sharp(buffer).metadata();
    const thumbWidth = Math.round(metadata.width / 2);
    const thumbHeight = Math.round(metadata.height / 2);
    const thumbnailPath = path.join(jobDir, 'thumbnail.png');

    await sharp(buffer)
      .resize(thumbWidth, thumbHeight, {
        kernel: sharp.kernel.lanczos3,
        fit: 'fill'
      })
      .withMetadata({ density: 150 })
      .png({ compressionLevel: 6 })
      .toFile(thumbnailPath);

    console.log(`[Save] Image ${id} sauvegardée (${metadata.width}x${metadata.height})`);
    res.json({ ok: true, width: metadata.width, height: metadata.height });
  } catch (err) {
    console.error('[Save] Erreur:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
