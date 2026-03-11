const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

function im(cmd) {
  return execSync(cmd, { stdio: 'pipe' }).toString().trim();
}

// Extension pour fichiers temp : MIFF = format natif IM, pas de compression → 5-10x plus rapide que PNG
const T = '.png';

// ============================================================
// Fonction d'analyse partagée (finesses + réserves) — DEMI-RÉSOLUTION
// ============================================================
function analyzeImage(jobDir, fileId, thresholdMm, prefix = 'finesses') {
  const convertedPath = path.join(jobDir, 'converted.png');
  const correctedPath = path.join(jobDir, 'corrected_preview.png');
  const inputPath = prefix === 'corrected' && fs.existsSync(correctedPath) ? correctedPath : convertedPath;

  const tmp = (name) => path.join(jobDir, `_${prefix}_${name}${T}`);
  const overlayPath = path.join(jobDir, `${prefix}_overlay.png`);
  const pureDefectsPath = path.join(jobDir, `${prefix}_pure_defects.png`);
  const thumbOverlayPath = path.join(jobDir, `${prefix}_thumb.png`);

  const radius = Math.max(1, Math.round(thresholdMm / 25.4 * 300));
  const halfRadius = Math.max(1, Math.round(radius / 2));
  const tempFiles = [];
  const t = (name) => { const p = tmp(name); tempFiles.push(p); return p; };

  try {
    // a) Alpha full res + resize 50% pour morphologie rapide
    im(`magick "${inputPath}" -colorspace sRGB -alpha extract -write "${t('alpha')}" -resize 50% "${t('half')}"`);

    // b) Finesses à demi-résolution : Open + Difference en 1 appel
    im(`magick "${t('half')}" ( +clone -morphology Open Disk:${halfRadius} ) -compose Difference -composite "${t('fin')}"`);

    // c) Réserves à demi-résolution : Close + Difference (symétrique des finesses)
    // Close bouche les petits trous transparents, Difference montre ce qui a été bouché = réserves
    im(`magick "${t('half')}" ( +clone -morphology Close Disk:${halfRadius} ) -compose Difference -composite "${t('res')}"`);

    // d) 3 stats à demi-résolution (mean invariant à l'échelle)
    const statsRaw = im(`magick "${t('fin')}" "${t('res')}" "${t('half')}" -format "%[mean]\\n" info:`);
    const [finMean, resMean, alphaMean] = statsRaw.split('\n').map(v => parseFloat(v) || 0);

    const has_finesses = finMean > 0;
    const has_reserves = resMean > 0;
    const finesses_percent = alphaMean > 0 ? Math.round((finMean / alphaMean) * 1000) / 10 : 0;
    const reserves_percent = alphaMean > 0 ? Math.round((resMean / alphaMean) * 1000) / 10 : 0;

    // e) Overlay combiné : finesses (magenta) + réserves (vert fluo)
    const dims = im(`magick identify -format "%wx%h" "${t('alpha')}"`);
    // Créer couche magenta (finesses) à pleine résolution
    im(`magick "${t('fin')}" -resize ${dims}! ( +clone -fill "rgb(255,0,255)" -colorize 100 ) +swap -compose CopyOpacity -composite PNG32:"${t('fin_color')}"`);
    // Créer couche vert fluo (réserves) à pleine résolution
    im(`magick "${t('res')}" -resize ${dims}! ( +clone -fill "rgb(0,255,0)" -colorize 100 ) +swap -compose CopyOpacity -composite PNG32:"${t('res_color')}"`);
    // Composer : vert (réserves) en base, magenta (finesses) par-dessus
    im(`magick "${t('res_color')}" "${t('fin_color')}" -compose Over -composite PNG32:"${overlayPath}"`);

    // f) Panneau DROIT : même overlay combiné
    fs.copyFileSync(overlayPath, pureDefectsPath);

    // g) Miniature (seulement pour l'analyse principale)
    if (prefix === 'finesses') {
      const thumbnailPath = path.join(jobDir, 'thumbnail.png');
      if (fs.existsSync(thumbnailPath)) {
        const thumbDims = im(`magick identify -format "%wx%h" "${thumbnailPath}"`);
        im(`magick "${overlayPath}" -resize ${thumbDims}! PNG32:"${thumbOverlayPath}"`);
      } else {
        im(`magick "${overlayPath}" -resize 50% PNG32:"${thumbOverlayPath}"`);
      }
    }

    // Nettoyage
    for (const f of tempFiles) { try { fs.unlinkSync(f); } catch {} }

    return {
      has_finesses, has_reserves, finesses_percent, reserves_percent,
      overlay_url: `/uploads/${fileId}/${prefix}_overlay.png`,
      pure_defects_url: `/uploads/${fileId}/${prefix}_pure_defects.png`,
      finesses_overlay_url: `/uploads/${fileId}/${prefix}_overlay.png`,
      finesses_thumb_url: `/uploads/${fileId}/${prefix}_thumb.png`,
      threshold_mm: thresholdMm, radius_px: radius,
    };
  } catch (err) {
    for (const f of tempFiles) { try { fs.unlinkSync(f); } catch {} }
    throw err;
  }
}

// ============================================================
// POST /finesses — Analyse principale
// ============================================================
router.post('/finesses', async (req, res) => {
  const { file_id, threshold_mm } = req.body;
  if (!file_id || threshold_mm == null) {
    return res.status(400).json({ error: 'file_id et threshold_mm requis' });
  }
  const jobDir = path.join(__dirname, '..', 'uploads', file_id);
  if (!fs.existsSync(jobDir) || !fs.existsSync(path.join(jobDir, 'converted.png'))) {
    return res.status(404).json({ error: 'Fichier introuvable' });
  }
  try {
    const result = analyzeImage(jobDir, file_id, threshold_mm, 'finesses');
    res.json(result);
  } catch (err) {
    console.error('[Analyze] Erreur finesses:', err.message);
    res.status(500).json({ error: `Erreur analyse: ${err.message}` });
  }
});

// ============================================================
// POST /correct-finesses — Correction PROPORTIONNELLE — OPTIMISÉE
// Multi-niveaux : 2 appels IM par niveau au lieu de 4
// ============================================================
router.post('/correct-finesses', async (req, res) => {
  const { file_id, threshold_mm } = req.body;
  if (!file_id || threshold_mm == null) {
    return res.status(400).json({ error: 'file_id et threshold_mm requis' });
  }

  const jobDir = path.join(__dirname, '..', 'uploads', file_id);
  const convertedPath = path.join(jobDir, 'converted.png');
  const correctedPath = path.join(jobDir, 'corrected_preview.png');
  const inputPath = fs.existsSync(correctedPath) ? correctedPath : convertedPath;

  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: 'Fichier introuvable' });
  }

  const tmp = (name) => path.join(jobDir, `_cf_${name}${T}`);
  const tmpFiles = [tmp('alpha'), tmp('dilated'), tmp('spread')];

  try {
    // Correction fixe : Dilate 2px par clic (~0.17mm, cumulatif)
    // 1. Extraire alpha
    im(`magick "${inputPath}" -colorspace sRGB -alpha extract "${tmp('alpha')}"`);

    // 2. Dilater l'alpha de 2px (épaissit tous les bords de ~0.17mm)
    im(`magick "${tmp('alpha')}" -morphology Dilate Disk:2 "${tmp('dilated')}"`);

    // 3. Propager les couleurs pour remplir les nouveaux pixels
    im(`magick "${inputPath}" -channel A -threshold 50% +channel ( +clone -alpha extract ) -compose Multiply -composite -alpha off -morphology Dilate Square:5 "${tmp('spread')}"`);

    // 4. Appliquer le nouvel alpha dilaté
    im(`magick "${tmp('spread')}" "${tmp('dilated')}" -compose CopyOpacity -composite PNG32:"${correctedPath}"`);

    // Nettoyage
    for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch {} }

    // Ré-analyser
    const result = analyzeImage(jobDir, file_id, threshold_mm, 'corrected');
    result.corrected_url = `/uploads/${file_id}/corrected_preview.png`;
    res.json(result);

  } catch (err) {
    for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch {} }
    console.error('[Correct Finesses]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /correct-reserves — Élargir les espaces fins — DEMI-RÉSOLUTION
// ============================================================
router.post('/correct-reserves', async (req, res) => {
  const { file_id, threshold_mm } = req.body;
  if (!file_id || threshold_mm == null) {
    return res.status(400).json({ error: 'file_id et threshold_mm requis' });
  }

  const jobDir = path.join(__dirname, '..', 'uploads', file_id);
  const convertedPath = path.join(jobDir, 'converted.png');
  const correctedPath = path.join(jobDir, 'corrected_preview.png');
  const inputPath = fs.existsSync(correctedPath) ? correctedPath : convertedPath;

  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: 'Fichier introuvable' });
  }

  const tmp = (name) => path.join(jobDir, `_cr_${name}${T}`);
  const tmpFiles = [tmp('alpha'), tmp('half'), tmp('opened'), tmp('closed'), tmp('protected'), tmp('reserves'), tmp('toremove'), tmp('toremove_full'), tmp('newalpha')];

  try {
    // Correction fixe : 0.1mm par clic (indépendant du slider de détection)
    const CORRECTION_MM = 0.1;
    const radius = Math.max(1, Math.round(CORRECTION_MM / 25.4 * 300));
    const halfRadius = Math.max(1, Math.round(radius / 2));

    // 1. Alpha full res + resize 50% pour morphologie rapide
    im(`magick "${inputPath}" -colorspace sRGB -alpha extract -write "${tmp('alpha')}" -resize 50% "${tmp('half')}"`);

    // 2. Open + Close à demi-résolution
    im(`magick "${tmp('half')}" -morphology Open Disk:${halfRadius} "${tmp('opened')}"`);
    im(`magick "${tmp('half')}" -morphology Close Disk:${halfRadius} "${tmp('closed')}"`);

    // 3. Protected à demi-résolution = alpha>49% AND opened<49%
    im(`magick ( "${tmp('half')}" -threshold 49% ) ( "${tmp('opened')}" -threshold 49% -negate ) -compose Multiply -composite "${tmp('protected')}"`);

    // 4. Reserves à demi-résolution + Dilate Square:1 (≈ Square:2 pleine résolution)
    im(`magick ( "${tmp('half')}" -threshold 49% -negate ) ( "${tmp('closed')}" -threshold 49% ) -compose Multiply -composite -morphology Dilate Square:1 "${tmp('reserves')}"`);

    // 5. ToRemove à demi-résolution
    im(`magick "${tmp('reserves')}" ( "${tmp('half')}" -threshold 49% ) -compose Multiply -composite ( "${tmp('protected')}" -negate ) -compose Multiply -composite "${tmp('toremove')}"`);

    // 6. Upscale toremove à pleine résolution
    const dims = im(`magick identify -format "%wx%h" "${tmp('alpha')}"`);
    im(`magick "${tmp('toremove')}" -resize ${dims}! -threshold 49% "${tmp('toremove_full')}"`);

    // 7. Nouvel alpha + appliquer à pleine résolution
    im(`magick "${tmp('alpha')}" ( "${tmp('toremove_full')}" -negate ) -compose Multiply -composite "${tmp('newalpha')}"`);
    im(`magick "${inputPath}" "${tmp('newalpha')}" -compose CopyOpacity -composite PNG32:"${correctedPath}"`);

    // Nettoyage
    for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch {} }

    // Ré-analyser
    const result = analyzeImage(jobDir, file_id, threshold_mm, 'corrected');
    result.corrected_url = `/uploads/${file_id}/corrected_preview.png`;
    res.json(result);

  } catch (err) {
    for (const f of tmpFiles) { try { fs.unlinkSync(f); } catch {} }
    console.error('[Correct Reserves]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /save-correction — Rendre la correction permanente
// ============================================================
router.post('/save-correction', async (req, res) => {
  const { file_id } = req.body;
  if (!file_id) return res.status(400).json({ error: 'file_id requis' });

  const jobDir = path.join(__dirname, '..', 'uploads', file_id);
  const correctedPath = path.join(jobDir, 'corrected_preview.png');
  const convertedPath = path.join(jobDir, 'converted.png');
  const thumbnailPath = path.join(jobDir, 'thumbnail.png');

  if (!fs.existsSync(correctedPath)) {
    return res.status(404).json({ error: 'Pas de correction à sauvegarder' });
  }

  try {
    fs.copyFileSync(correctedPath, convertedPath);
    im(`magick "${convertedPath}" -thumbnail 150x150 -background none -gravity center PNG32:"${thumbnailPath}"`);
    try { fs.unlinkSync(correctedPath); } catch {}
    for (const f of ['corrected_overlay.png', 'corrected_pure_defects.png', 'corrected_thumb.png']) {
      try { fs.unlinkSync(path.join(jobDir, f)); } catch {}
    }
    res.json({ ok: true, message: 'Correction sauvegardée' });
  } catch (err) {
    console.error('[Save Correction]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /discard-correction — Annuler la correction
// ============================================================
router.post('/discard-correction', async (req, res) => {
  const { file_id } = req.body;
  if (!file_id) return res.status(400).json({ error: 'file_id requis' });

  const jobDir = path.join(__dirname, '..', 'uploads', file_id);
  for (const f of ['corrected_preview.png', 'corrected_overlay.png', 'corrected_pure_defects.png', 'corrected_thumb.png']) {
    try { fs.unlinkSync(path.join(jobDir, f)); } catch {}
  }
  res.json({ ok: true });
});

module.exports = router;
