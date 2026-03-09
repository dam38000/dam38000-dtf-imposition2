const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

router.post('/finesses', async (req, res) => {
  const { file_id, threshold_mm } = req.body;

  if (!file_id || threshold_mm == null) {
    return res.status(400).json({ error: 'file_id et threshold_mm requis' });
  }

  const jobDir = path.join(__dirname, '..', 'uploads', file_id);
  const convertedPath = path.join(jobDir, 'converted.png');

  if (!fs.existsSync(jobDir) || !fs.existsSync(convertedPath)) {
    return res.status(404).json({ error: 'Fichier introuvable ou pas encore converti' });
  }

  const alphaPath = path.join(jobDir, '_finesses_alpha.png');
  const openedPath = path.join(jobDir, '_finesses_opened.png');
  const finessesRawPath = path.join(jobDir, '_finesses_raw.png');
  const overlayPath = path.join(jobDir, 'finesses_overlay.png');
  const thumbOverlayPath = path.join(jobDir, 'finesses_thumb.png');

  try {
    const radius = Math.max(1, Math.round(threshold_mm / 25.4 * 300));

    // a) Extraire le canal alpha (colorspace sRGB par sécurité)
    execSync(`magick "${convertedPath}" -colorspace sRGB -alpha extract "${alphaPath}"`, { stdio: 'pipe' });

    // b) Ouverture morphologique
    execSync(`magick "${alphaPath}" -morphology Open Disk:${radius} "${openedPath}"`, { stdio: 'pipe' });

    // c) Différence : zones fines
    execSync(`magick "${alphaPath}" "${openedPath}" -compose Difference -composite "${finessesRawPath}"`, { stdio: 'pipe' });

    // d) Compter les pixels de finesses
    const meanStr = execSync(`magick "${finessesRawPath}" -format "%[mean]" info:`, { stdio: 'pipe' }).toString().trim();
    const mean = parseFloat(meanStr) || 0;
    // QuantumRange dépend de la profondeur IM, lire aussi le max
    const maxRangeStr = execSync(`magick "${finessesRawPath}" -format "%[max]" info:`, { stdio: 'pipe' }).toString().trim();

    // Calculer le % de surface alpha qui est fine
    // mean est sur l'ensemble de l'image ; on veut le % par rapport à la surface alpha non-nulle
    const alphaMeanStr = execSync(`magick "${alphaPath}" -format "%[mean]" info:`, { stdio: 'pipe' }).toString().trim();
    const alphaMean = parseFloat(alphaMeanStr) || 1;

    const has_finesses = mean > 0;
    const finesses_percent = alphaMean > 0 ? Math.round((mean / alphaMean) * 1000) / 10 : 0;

    // e) Overlay rouge pour visualisation
    if (has_finesses) {
      execSync(`magick "${finessesRawPath}" ( +clone -fill "rgb(255,60,60)" -colorize 100 ) +swap -compose CopyOpacity -composite PNG32:"${overlayPath}"`, { stdio: 'pipe' });
    } else {
      // Créer un overlay transparent vide (même dimensions)
      execSync(`magick "${finessesRawPath}" -alpha transparent PNG32:"${overlayPath}"`, { stdio: 'pipe' });
    }

    // f) Miniature overlay (même taille que thumbnail.png)
    const thumbnailPath = path.join(jobDir, 'thumbnail.png');
    if (fs.existsSync(thumbnailPath)) {
      const thumbDims = execSync(`magick identify -format "%wx%h" "${thumbnailPath}"`, { stdio: 'pipe' }).toString().trim();
      execSync(`magick "${overlayPath}" -resize ${thumbDims}! PNG32:"${thumbOverlayPath}"`, { stdio: 'pipe' });
    } else {
      // Fallback : réduire de moitié
      execSync(`magick "${overlayPath}" -resize 50% PNG32:"${thumbOverlayPath}"`, { stdio: 'pipe' });
    }

    // g) Nettoyage fichiers temporaires
    try { fs.unlinkSync(alphaPath); } catch {}
    try { fs.unlinkSync(openedPath); } catch {}
    try { fs.unlinkSync(finessesRawPath); } catch {}

    res.json({
      has_finesses,
      finesses_percent,
      finesses_overlay_url: `/uploads/${file_id}/finesses_overlay.png`,
      finesses_thumb_url: `/uploads/${file_id}/finesses_thumb.png`,
      threshold_mm,
      radius_px: radius,
    });

  } catch (err) {
    // Nettoyage en cas d'erreur
    try { fs.unlinkSync(alphaPath); } catch {}
    try { fs.unlinkSync(openedPath); } catch {}
    try { fs.unlinkSync(finessesRawPath); } catch {}

    console.error('[Analyze] Erreur finesses:', err.message);
    res.status(500).json({ error: `Erreur analyse finesses: ${err.message}` });
  }
});

module.exports = router;
