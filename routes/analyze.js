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

async function runPuppeteerCorrection(inputPath, type = 'finesses') {
  const imageBuffer = fs.readFileSync(inputPath);
  const base64 = imageBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${base64}`;

  const finesse = 0.6;
  const calculatedFinesse = (finesse / 0.08) * 0.75; // = 5.625

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
// POST /correct-finesses — Via Puppeteer (code original montage.html)
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

  try {
    const resultDataUrl = await runPuppeteerCorrection(inputPath, 'finesses');

    // Convertir data URL → fichier PNG
    const base64Data = resultDataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(correctedPath, Buffer.from(base64Data, 'base64'));

    console.log(`[Correct Finesses Puppeteer] OK → ${correctedPath}`);

    // Ré-analyser
    const result = analyzeImage(jobDir, file_id, threshold_mm, 'corrected');
    result.corrected_url = `/uploads/${file_id}/corrected_preview.png`;
    res.json(result);

  } catch (err) {
    console.error('[Correct Finesses Puppeteer]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// POST /correct-reserves — Via Puppeteer (code original montage.html)
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

  try {
    const resultDataUrl = await runPuppeteerCorrection(inputPath, 'reserves');

    // Convertir data URL → fichier PNG
    const base64Data = resultDataUrl.replace(/^data:image\/png;base64,/, '');
    fs.writeFileSync(correctedPath, Buffer.from(base64Data, 'base64'));

    console.log(`[Correct Reserves Puppeteer] OK → ${correctedPath}`);

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
