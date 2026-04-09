const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

function im(cmd) {
  return execSync(cmd, { stdio: 'pipe' }).toString().trim();
}

// ============================================================
// Puppeteer : exécute le code ORIGINAL du montage.html dans un vrai Canvas
// ============================================================
let _browser = null;
async function getBrowser() {
  if (!_browser || !_browser.isConnected()) {
    const puppeteer = require('puppeteer');
    _browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security'],
    });
  }
  return _browser;
}

async function runPuppeteerCorrection(inputPath, type = 'finesses', thresholdMm = 0.3) {
  const imageBuffer = fs.readFileSync(inputPath);
  const base64 = imageBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${base64}`;

  const calculatedFinesse = (thresholdMm / 0.08) * 0.75;
  console.log(`[Puppeteer] thresholdMm=${thresholdMm} → calculatedFinesse=${calculatedFinesse.toFixed(2)}`);

  const helperPath = path.join(__dirname, '..', 'correction-helper.html');
  const fileUrl = 'file:///' + helperPath.replace(/\\/g, '/');

  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // Timeout long : la correction pixel-par-pixel peut prendre plusieurs minutes
    page.setDefaultTimeout(300000); // 5 minutes
    await page.goto(fileUrl, { waitUntil: 'domcontentloaded' });

    console.log(`[Puppeteer] Lancement correction ${type}, finesse=${calculatedFinesse}`);
    const startTime = Date.now();

    // Exécuter la correction dans le contexte du navigateur
    const resultDataUrl = await page.evaluate(async (imgDataUrl, calcFinesse, corrType) => {
      if (corrType === 'finesses') {
        return await window.correctImageFinesse(imgDataUrl, calcFinesse);
      } else {
        return await window.correctImageReserves(imgDataUrl, calcFinesse);
      }
    }, dataUrl, calculatedFinesse, type);

    console.log(`[Puppeteer] Correction ${type} terminée en ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
    return resultDataUrl;
  } finally {
    await page.close();
  }
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

  const debug = (name) => path.join(jobDir, `debug_${prefix}_${name}.png`);
  const overlayPath = path.join(jobDir, `${prefix}_overlay.png`);
  const pureDefectsPath = path.join(jobDir, `${prefix}_pure_defects.png`);
  const thumbOverlayPath = path.join(jobDir, `${prefix}_thumb.png`);

  const radius = Math.max(1, Math.round(thresholdMm / 25.4 * 300));
  const halfRadius = Math.max(1, Math.round(radius / 2));

  console.log(`[Analyze] ${prefix} : input=${inputPath}, seuil=${thresholdMm}mm, radius=${radius}px, halfRadius=${halfRadius}px`);

  const tmp = (name) => path.join(jobDir, `_tmp_${name}.png`);
  try {
    // a) Alpha full res + resize 50% pour morphologie rapide
    const alphaPath = tmp('alpha_full');
    const halfPath = tmp('alpha_half');
    im(`magick "${inputPath}" -colorspace sRGB -alpha extract -write "${alphaPath}" -resize 50% "${halfPath}"`);

    // b) Ouverture morphologique à demi-résolution
    const openedPath = tmp('opened');
    im(`magick "${halfPath}" -morphology Open Disk:${halfRadius} "${openedPath}"`);

    // c) Différence = finesses détectées
    const finPath = tmp('fin_diff');
    im(`magick "${halfPath}" "${openedPath}" -compose Difference -composite "${finPath}"`);

    // d) Stats finesses
    const statsRaw = im(`magick "${finPath}" "${halfPath}" -format "%[mean]\\n" info:`);
    const [finMean, alphaMean] = statsRaw.split('\n').map(v => parseFloat(v) || 0);

    const finesses_percent = alphaMean > 0 ? Math.round((finMean / alphaMean) * 1000) / 10 : 0;
    const has_finesses = finesses_percent >= 0.5; // seuil : ignorer si moins de 0.5% de pixels affectés
    console.log(`[Analyze] ${prefix}: has_finesses=${has_finesses}, percent=${finesses_percent}%`);

    // e) Overlay vert (finesses uniquement) — remonté à pleine résolution
    const dims = im(`magick identify -format "%wx%h" "${alphaPath}"`);
    const finFullPath = tmp('fin_full');
    im(`magick "${finPath}" -resize ${dims}! "${finFullPath}"`);

    // Sauvegarder le masque brut (non dilaté) pour la correction
    const rawMaskPath = path.join(jobDir, `${prefix}_raw_mask.png`);
    im(`magick "${finFullPath}" PNG32:"${rawMaskPath}"`);

    // Dilater les finesses de 3px pour l'affichage (plus visible)
    const greenPath = tmp('green');
    const finDilatedPath = tmp('fin_dilated');
    im(`magick "${finFullPath}" -morphology Dilate Disk:3 "${finDilatedPath}"`);
    im(`magick "${finDilatedPath}" -fill "rgb(0,255,0)" -colorize 100 "${greenPath}"`);
    im(`magick "${greenPath}" "${finDilatedPath}" -compose CopyOpacity -composite PNG32:"${overlayPath}"`);

    // f) Panneau DROIT : même overlay
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

    // h) Image dilatée 4px (pour SeriQuadri)
    const dilated4Path = path.join(jobDir, `${prefix}_dilated4.png`);
    // i) Contour rouge 20px (pour SeriLight)
    const contour7Path = path.join(jobDir, `${prefix}_contour7.png`);
    const tmpAlphaDil = tmp('alpha_dil');
    const tmpAlphaDil4 = tmp('alpha_dilated4');
    const tmpAlphaDil20 = tmp('alpha_dilated7');
    const tmpRgbProp4 = tmp('rgb_prop4');
    const tmpRedFill = tmp('red_fill');
    try {
      // Extraire l'alpha
      im(`magick "${inputPath}" -alpha extract "${tmpAlphaDil}"`);
      // Dilater 4px
      im(`magick "${tmpAlphaDil}" -morphology Dilate Disk:4 "${tmpAlphaDil4}"`);
      im(`magick "${inputPath}" -background white -alpha remove -negate -morphology Dilate Disk:4 -negate "${tmpRgbProp4}"`);
      im(`magick "${tmpRgbProp4}" "${tmpAlphaDil4}" -compose CopyOpacity -composite "${inputPath}" -compose Over -composite PNG32:"${dilated4Path}"`);
      console.log(`[Analyze] Image dilatée 4px: ${dilated4Path}`);
      // Masque dilaté 7px : juste la forme élargie (blanc + alpha)
      im(`magick "${tmpAlphaDil}" -morphology Dilate Disk:7 "${tmpAlphaDil20}"`);
      im(`magick "${tmpAlphaDil20}" -fill white -colorize 100 "${tmpRedFill}"`);
      im(`magick "${tmpRedFill}" "${tmpAlphaDil20}" -compose CopyOpacity -composite PNG32:"${contour7Path}"`);
      console.log(`[Analyze] Masque dilaté 7px: ${contour7Path}`);
    } catch (err) {
      console.warn(`[Analyze] Erreur génération dilatées: ${err.message}`);
    }

    // Nettoyage des fichiers temporaires
    for (const f of [alphaPath, halfPath, openedPath, finPath, finFullPath, greenPath, finDilatedPath, tmpAlphaDil, tmpAlphaDil4, tmpAlphaDil20, tmpRgbProp4, tmpRedFill]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }

    return {
      has_finesses, finesses_percent,
      overlay_url: `/uploads/${fileId}/${prefix}_overlay.png`,
      pure_defects_url: `/uploads/${fileId}/${prefix}_pure_defects.png`,
      dilated4_url: `/uploads/${fileId}/${prefix}_dilated4.png`,
      contour7_url: `/uploads/${fileId}/${prefix}_contour7.png`,
      finesses_thumb_url: `/uploads/${fileId}/${prefix}_thumb.png`,
      threshold_mm: thresholdMm, radius_px: radius,
    };
  } catch (err) {
    throw err;
  }
}

// ============================================================
// POST /compose-border — Composer l'image originale avec la dilatation et la bordure
// ============================================================
router.post('/compose-border', (req, res) => {
  const { file_id, border_opacity, dilated_opacity } = req.body;
  if (!file_id) return res.status(400).json({ error: 'file_id requis' });

  const jobDir = path.join(__dirname, '..', 'uploads', file_id);
  const convertedPath = path.join(jobDir, 'converted.png');
  const correctedPath = path.join(jobDir, 'corrected_preview.png');
  const inputPath = fs.existsSync(correctedPath) ? correctedPath : convertedPath;
  const dilatedPath = path.join(jobDir, 'finesses_dilated.png');
  const composedPath = path.join(jobDir, 'composed_border.png');

  if (!fs.existsSync(inputPath)) return res.status(404).json({ error: 'Image introuvable' });
  if (!fs.existsSync(dilatedPath)) return res.status(404).json({ error: 'Image dilatée introuvable' });

  const t = (name) => path.join(jobDir, `_tmp_compose_${name}.png`);

  try {
    const bOpacity = Math.max(0, Math.min(100, Math.round((border_opacity || 0) * 100)));
    const dOpacity = Math.max(0, Math.min(100, Math.round((dilated_opacity || 0) * 100)));

    console.log(`[Compose] border_opacity=${bOpacity}%, dilated_opacity=${dOpacity}%`);

    // 1) Préparer l'image dilatée avec l'opacité du slider
    if (dOpacity > 0) {
      im(`magick "${dilatedPath}" -channel A -evaluate Multiply ${dOpacity / 100} +channel PNG32:"${t('dilated_opacity')}"`);
    }

    // 2) Créer le masque de bordure intérieure (érosion de l'alpha de 5px)
    im(`magick "${inputPath}" -alpha extract "${t('alpha')}"`);
    im(`magick "${t('alpha')}" -morphology Erode Disk:5 "${t('alpha_eroded')}"`);
    // Bordure = alpha original - alpha érodé
    im(`magick "${t('alpha')}" "${t('alpha_eroded')}" -compose Difference -composite "${t('border_mask')}"`);

    // 3) Créer l'image originale avec la bordure rendue transparente
    if (bOpacity > 0) {
      // Réduire l'alpha dans la zone de bordure
      // border_mask * border_opacity = quantité d'alpha à retirer
      im(`magick "${t('border_mask')}" -channel A -evaluate Multiply ${bOpacity / 100} +channel "${t('border_scaled')}"`);
      // Alpha final = alpha original - border_scaled (clamped à 0)
      im(`magick "${t('alpha')}" "${t('border_scaled')}" -compose Minus -composite -clamp "${t('alpha_final')}"`);
      // Appliquer le nouvel alpha à l'image originale
      im(`magick "${inputPath}" "${t('alpha_final')}" -compose CopyOpacity -composite PNG32:"${t('original_bordered')}"`);
    } else {
      im(`magick "${inputPath}" PNG32:"${t('original_bordered')}"`);
    }

    // 4) Composer : dilatée (dessous) + originale avec bordure (dessus)
    if (dOpacity > 0) {
      im(`magick "${t('dilated_opacity')}" "${t('original_bordered')}" -compose Over -composite PNG32:"${composedPath}"`);
    } else {
      im(`magick "${t('original_bordered')}" PNG32:"${composedPath}"`);
    }

    console.log(`[Compose] OK → ${composedPath}`);

    // Nettoyage temporaires
    for (const name of ['dilated_opacity', 'alpha', 'alpha_eroded', 'border_mask', 'border_scaled', 'alpha_final', 'original_bordered']) {
      const f = t(name);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }

    res.json({
      composed_url: `/uploads/${file_id}/composed_border.png`,
      message: 'Composition réussie',
    });
  } catch (err) {
    console.error('[Compose]', err.message);
    res.status(500).json({ error: err.message });
  }
});

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
// POST /correct-finesses — Via ImageMagick (épaississement des traits fins)
// ============================================================
router.post('/correct-finesses', (req, res) => {
  const { file_id, threshold_mm, intensity = 1 } = req.body;
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

  try {
    const detectRadius = Math.max(1, Math.round(threshold_mm / 25.4 * 300));
    const halfRadius = Math.max(1, Math.round(detectRadius / 2));
    const radius = Math.max(1, Math.round(2 * intensity) - 1); // base 2px × intensité - 1
    const t = (name) => path.join(jobDir, `_correct_${name}.png`);

    const maskDilateRadius = radius + 2; // dilater le masque un peu plus large que la correction
    console.log(`[Correct Finesses IM] Début: seuil=${threshold_mm}mm, detectRadius=${detectRadius}px, correction radius=${radius}px, maskDilate=${maskDilateRadius}px`);

    // Approche : épaissir partout, puis masquer avec l'overlay finesses
    // pour ne garder l'épaississement QUE dans les zones de finesses.
    //
    // 1) Extraire l'alpha original
    im(`magick "${inputPath}" -alpha extract "${t('alpha')}"`);

    // 2) Récupérer le masque brut des finesses (non dilaté, pour une correction précise)
    const rawMaskPath = path.join(jobDir, 'finesses_raw_mask.png');
    if (!fs.existsSync(rawMaskPath)) {
      // Si le masque n'existe pas encore, lancer l'analyse d'abord
      analyzeImage(jobDir, file_id, threshold_mm, 'finesses');
    }
    // Utiliser le masque brut (pas l'overlay dilaté)
    im(`magick "${rawMaskPath}" "${t('finesse_mask')}"`);
    // Dilater le masque pour couvrir la zone de correction autour des finesses
    im(`magick "${t('finesse_mask')}" -morphology Dilate Disk:${maskDilateRadius} "${t('zone_mask')}"`);

    // 3) Créer l'image épaissie (comme avant, sur toute l'image)
    im(`magick "${t('alpha')}" -morphology Dilate Disk:${radius} "${t('alpha_dilated')}"`);
    im(`magick "${inputPath}" -background white -alpha remove "${t('rgb_white')}"`);
    im(`magick "${t('rgb_white')}" -negate -morphology Dilate Disk:${radius} -negate "${t('rgb_propagated')}"`);
    im(`magick "${t('rgb_propagated')}" "${inputPath}" -compose Over -composite -alpha off "${t('rgb_final')}"`);
    im(`magick "${t('rgb_final')}" "${t('alpha_dilated')}" -compose CopyOpacity -composite PNG32:"${t('thick_full')}"`);

    // 4) Composer avec masque : image épaissie dans les zones finesses, originale ailleurs
    //    - Commencer par l'image originale
    //    - Superposer l'image épaissie en utilisant zone_mask comme opacité
    //    thick_masked = thick_full avec alpha = zone_mask
    im(`magick "${t('thick_full')}" "${t('zone_mask')}" -compose CopyOpacity -composite PNG32:"${t('thick_masked')}"`);
    //    Composer : originale en base, thick_masked par-dessus
    im(`magick "${inputPath}" "${t('thick_masked')}" -compose Over -composite PNG32:"${t('composed')}"`);

    // 5) Nettoyage des poussières : ouverture morphologique sur l'alpha
    //    Erode puis Dilate supprime les pixels isolés (< 2px)
    im(`magick "${t('composed')}" -alpha extract "${t('alpha_pre_clean')}"`);
    im(`magick "${t('alpha_pre_clean')}" -morphology Open Disk:1 "${t('alpha_cleaned')}"`);
    im(`magick "${t('composed')}" "${t('alpha_cleaned')}" -compose CopyOpacity -composite PNG32:"${correctedPath}"`);

    console.log(`[Correct Finesses IM] OK (+ nettoyage poussières) → ${correctedPath}`);

    // Regénérer la thumbnail : même taille que converted.png divisé par 2 (= 150 DPI)
    const thumbnailPath = path.join(jobDir, 'thumbnail.png');
    const convertedDims = im(`magick identify -format "%wx%h" "${convertedPath}"`);
    const [cw, ch] = convertedDims.split('x').map(Number);
    const thumbW = Math.round(cw / 2);
    const thumbH = Math.round(ch / 2);
    im(`magick "${correctedPath}" -resize ${thumbW}x${thumbH}! -density 150 PNG32:"${thumbnailPath}"`);
    console.log(`[Correct Finesses IM] Thumbnail regénérée: ${thumbnailPath} (${thumbW}x${thumbH} depuis converted ${cw}x${ch})`);

    // Nettoyage des fichiers temporaires
    for (const name of ['alpha', 'finesse_mask', 'zone_mask', 'alpha_dilated', 'rgb_white', 'rgb_propagated', 'rgb_final', 'thick_full', 'thick_masked', 'composed', 'alpha_pre_clean', 'alpha_cleaned']) {
      const src = t(name);
      if (fs.existsSync(src)) fs.unlinkSync(src);
    }

    // Ré-analyser pour voir les finesses restantes
    const result = analyzeImage(jobDir, file_id, threshold_mm, 'corrected');
    result.corrected_url = `/uploads/${file_id}/corrected_preview.png`;
    result.thumbnail_url = `/uploads/${file_id}/thumbnail.png?t=${Date.now()}`;
    res.json(result);

  } catch (err) {
    console.error('[Correct Finesses IM]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /discard-correction — Annuler la correction (supprimer corrected_preview, restaurer thumbnail)
// ============================================================
router.post('/discard-correction', (req, res) => {
  const { file_id } = req.body;
  if (!file_id) return res.status(400).json({ error: 'file_id requis' });

  const jobDir = path.join(__dirname, '..', 'uploads', file_id);
  const correctedPath = path.join(jobDir, 'corrected_preview.png');
  const convertedPath = path.join(jobDir, 'converted.png');
  const thumbnailPath = path.join(jobDir, 'thumbnail.png');

  try {
    // Supprimer corrected_preview.png
    if (fs.existsSync(correctedPath)) {
      fs.unlinkSync(correctedPath);
      console.log(`[Discard] Supprimé: ${correctedPath}`);
    }

    // Regénérer la thumbnail depuis converted.png
    if (fs.existsSync(convertedPath)) {
      const dims = im(`magick identify -format "%wx%h" "${convertedPath}"`);
      const [cw, ch] = dims.split('x').map(Number);
      const thumbW = Math.round(cw / 2);
      const thumbH = Math.round(ch / 2);
      im(`magick "${convertedPath}" -resize ${thumbW}x${thumbH}! -density 150 PNG32:"${thumbnailPath}"`);
      console.log(`[Discard] Thumbnail restaurée depuis converted.png (${thumbW}x${thumbH})`);
    }

    res.json({ message: 'Correction annulée' });
  } catch (err) {
    console.error('[Discard]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /correct-reserves — Via ImageMagick (fermeture morphologique)
// ============================================================
router.post('/correct-reserves', (req, res) => {
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

  try {
    const radius = Math.max(1, Math.round(threshold_mm / 25.4 * 300));

    console.log(`[Correct Reserves IM] Début: seuil=${threshold_mm}mm, radius=${radius}px`);

    // Fermeture morphologique sur l'alpha (bouche les petits trous)
    // puis recomposer l'image avec le nouvel alpha
    const t = (name) => path.join(jobDir, `_correct_res_${name}.png`);

    im(`magick "${inputPath}" -alpha extract "${t('alpha')}"`);
    im(`magick "${t('alpha')}" -morphology Close Disk:${radius} "${t('closed')}"`);
    im(`magick "${inputPath}" "${t('closed')}" -compose CopyOpacity -composite PNG32:"${correctedPath}"`);

    console.log(`[Correct Reserves IM] OK → ${correctedPath}`);

    // Nettoyage
    for (const name of ['alpha', 'closed']) {
      try { fs.unlinkSync(t(name)); } catch {}
    }

    // Ré-analyser
    const result = analyzeImage(jobDir, file_id, threshold_mm, 'corrected');
    result.corrected_url = `/uploads/${file_id}/corrected_preview.png`;
    res.json(result);

  } catch (err) {
    console.error('[Correct Reserves Puppeteer]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /save-correction — Rendre la correction permanente
// ============================================================
router.post('/save-correction', async (req, res) => {
  const { file_id, source } = req.body;
  if (!file_id) return res.status(400).json({ error: 'file_id requis' });

  const jobDir = path.join(__dirname, '..', 'uploads', file_id);
  const correctedPath = path.join(jobDir, 'corrected_preview.png');
  const composedPath = path.join(jobDir, 'composed_border.png');
  const convertedPath = path.join(jobDir, 'converted.png');
  const thumbnailPath = path.join(jobDir, 'thumbnail.png');

  // Choisir la source : composé, corrigé, ou erreur
  const sourcePath = source === 'composed' && fs.existsSync(composedPath) ? composedPath
    : fs.existsSync(correctedPath) ? correctedPath : null;

  if (!sourcePath) {
    return res.status(404).json({ error: 'Pas de correction à sauvegarder' });
  }

  try {
    fs.copyFileSync(sourcePath, convertedPath);
    // Regénérer le thumbnail à 50% de converted (= taille réelle à 150 DPI)
    im(`magick "${convertedPath}" -resize 50% -density 150 PNG32:"${thumbnailPath}"`);
    console.log(`[Save Correction] Source: ${path.basename(sourcePath)} → converted.png`);
    try { fs.unlinkSync(correctedPath); } catch {}
    try { fs.unlinkSync(composedPath); } catch {}
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
