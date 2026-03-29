const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { execSync } = require('child_process');
const zlib = require('zlib');

// Chemins des profils ICC
const PROFILES_DIR = path.join(__dirname, '..', 'profiles');
const SRGB_PROFILE = path.join(PROFILES_DIR, 'sRGB.icc');
const ECIRGB_PROFILE = path.join(PROFILES_DIR, 'eciRGB_v2.icc');
const FOGRA39_PROFILE = path.join(PROFILES_DIR, 'CoatedFOGRA39.icc');

// Résoudre un nom de profil ICC (depuis XMP/photoshop:ICCProfile) vers un fichier .icc sur disque
// Retourne { path, name, isEci } ou null si inconnu
function resolveIccProfile(profileName) {
  if (!profileName) return null;
  const lower = profileName.toLowerCase();

  // eciRGB (v1, v2, v4...)
  if (lower.includes('ecirgb') || lower.includes('eci-rgb') || lower.includes('eci rgb')) {
    // Préférer ICCv4 si le nom le mentionne
    if (lower.includes('v4') || lower.includes('iccv4')) {
      const v4 = path.join(PROFILES_DIR, 'eciRGB_v2_ICCv4.icc');
      if (fs.existsSync(v4)) return { path: v4, name: profileName, isEci: true };
    }
    // Sinon v1 si mentionné
    if (lower.includes('v1') || lower.includes('1.0')) {
      const v1 = path.join(PROFILES_DIR, 'ECI-RGB.V1.0.icc');
      if (fs.existsSync(v1)) return { path: v1, name: profileName, isEci: true };
    }
    return { path: ECIRGB_PROFILE, name: profileName, isEci: true };
  }

  // Adobe RGB
  if (lower.includes('adobe') && lower.includes('rgb')) {
    // Chercher un fichier AdobeRGB dans le dossier profiles
    const candidates = ['AdobeRGB1998.icc', 'AdobeRGB.icc', 'Adobe RGB (1998).icc'];
    for (const c of candidates) {
      const p = path.join(PROFILES_DIR, c);
      if (fs.existsSync(p)) return { path: p, name: profileName, isEci: false };
    }
    // Chercher tout fichier contenant "adobe" dans le dossier
    try {
      const files = fs.readdirSync(PROFILES_DIR);
      const match = files.find(f => f.toLowerCase().includes('adobe'));
      if (match) return { path: path.join(PROFILES_DIR, match), name: profileName, isEci: false };
    } catch {}
    console.warn(`[ICC] Profil AdobeRGB détecté mais aucun fichier .icc trouvé — fallback sRGB`);
    return null;
  }

  // sRGB
  if (lower.includes('srgb')) {
    return { path: SRGB_PROFILE, name: profileName, isEci: false };
  }

  // FOGRA39
  if (lower.includes('fogra39')) {
    return { path: FOGRA39_PROFILE, name: profileName, isEci: false };
  }

  // Profil inconnu — chercher un fichier dont le nom correspond
  try {
    const files = fs.readdirSync(PROFILES_DIR);
    const words = lower.split(/[\s,()]+/).filter(w => w.length > 2);
    const match = files.find(f => words.some(w => f.toLowerCase().includes(w)));
    if (match) {
      console.log(`[ICC] Profil "${profileName}" → fichier trouvé par correspondance : ${match}`);
      return { path: path.join(PROFILES_DIR, match), name: profileName, isEci: false };
    }
  } catch {}

  console.warn(`[ICC] Profil "${profileName}" inconnu — aucun fichier .icc trouvé`);
  return null;
}

// Multer : stockage temporaire en mémoire
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png' || file.mimetype === 'application/pdf' || file.mimetype === 'image/tiff') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers PNG, PDF et TIFF sont acceptés'));
    }
  }
});

router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier reçu' });
    }

    const id = uuidv4();
    const jobDir = path.join(__dirname, '..', 'uploads', id);
    fs.mkdirSync(jobDir, { recursive: true });

    const isPdf = req.file.mimetype === 'application/pdf';
    const isTiff = req.file.mimetype === 'image/tiff';

    let normalizedPath, normalizedWidth, normalizedHeight;
    let widthMm, heightMm, dpiSource, hasAlpha, iccProfile, iccSourceLabel;
    let convertedPath = path.join(jobDir, 'converted.png');
    let iccConversionOk = true;
    const targetDpi = 300;

    if (isTiff) {
      // ==================== PIPELINE TIFF ====================
      // 1. Sauvegarder l'original TIFF
      const originalPath = path.join(jobDir, 'original.tif');
      fs.writeFileSync(originalPath, req.file.buffer);

      // 2. Détecter le bon layer (celui avec alpha si multi-layer)
      let layerIndex = 0;
      let layerCount = 1;
      try {
        const identifyLines = execSync(`magick identify "${originalPath}"`, { stdio: 'pipe' }).toString().trim().split('\n');
        layerCount = identifyLines.length;
        console.log(`[TIFF] Nombre de layers détectés : ${layerCount}`);

        if (layerCount > 1) {
          // Chercher le layer avec canal alpha
          for (let i = 0; i < layerCount; i++) {
            try {
              const channels = execSync(`magick identify -format "%[channels]" "${originalPath}[${i}]"`, { stdio: 'pipe' }).toString().trim().toLowerCase();
              console.log(`[TIFF] Layer [${i}] channels : ${channels}`);
              if (channels.includes('a')) {
                layerIndex = i;
                console.log(`[TIFF] Layer avec alpha trouvé : [${i}]`);
                break;
              }
            } catch {}
          }
        }
      } catch (err) {
        console.warn(`[TIFF] Impossible de détecter les layers: ${err.message}`);
      }

      const layerSuffix = `[${layerIndex}]`;
      console.log(`[TIFF] Utilisation du layer ${layerSuffix}`);

      // 3. Lire les métadonnées du bon layer avec ImageMagick
      //    (Sharp ne supporte pas les layers Photoshop des TIFF)
      let widthPx, heightPx;
      try {
        const dimOut = execSync(`magick identify -format "%w %h %x %y" "${originalPath}${layerSuffix}"`, { stdio: 'pipe' }).toString().trim();
        const parts = dimOut.split(/\s+/);
        widthPx = parseInt(parts[0]);
        heightPx = parseInt(parts[1]);
        dpiSource = Math.round(parseFloat(parts[2])) || 72;
        console.log(`[TIFF] Layer ${layerSuffix} : ${widthPx}x${heightPx} @ ${dpiSource} DPI`);
      } catch (err) {
        console.warn(`[TIFF] Erreur lecture dimensions layer: ${err.message}`);
        // Fallback Sharp layer 0
        const metadata = await sharp(req.file.buffer).metadata();
        widthPx = metadata.width;
        heightPx = metadata.height;
        dpiSource = metadata.density || 72;
      }

      // Lire le profil ICC avec Sharp (layer 0, le profil est partagé)
      hasAlpha = layerCount > 1; // si multi-layer, le layer sélectionné a de l'alpha
      iccProfile = null;
      let sourceIccPath = null; // chemin vers le profil ICC extrait du fichier
      try {
        const metadata = await sharp(req.file.buffer).metadata();
        if (metadata.icc) {
          iccProfile = extractIccDescription(metadata.icc);
          // Sauvegarder le profil ICC embarqué pour l'utiliser comme source
          sourceIccPath = path.join(jobDir, 'source_profile.icc');
          fs.writeFileSync(sourceIccPath, metadata.icc);
          console.log(`[TIFF] Profil ICC embarqué extrait → source_profile.icc (${iccProfile})`);
        }
      } catch {}

      // Dimensions physiques en mm (depuis le bon layer)
      widthMm = round2((widthPx / dpiSource) * 25.4);
      heightMm = round2((heightPx / dpiSource) * 25.4);

      // 4. Détecter le colorspace avec ImageMagick sur le bon layer
      let colorspace = 'sRGB';
      try {
        const csOut = execSync(`magick identify -format "%[colorspace]" "${originalPath}${layerSuffix}"`, { stdio: 'pipe' }).toString().trim();
        if (csOut) colorspace = csOut;
        console.log(`[TIFF] Colorspace détecté : ${colorspace}`);
      } catch (err) {
        console.warn(`[TIFF] Impossible de détecter le colorspace, défaut sRGB: ${err.message}`);
      }

      const isCmyk = colorspace.toUpperCase() === 'CMYK';

      // 5. Normalisation 300 DPI — toujours via ImageMagick pour extraire le bon layer
      if (dpiSource !== targetDpi) {
        normalizedWidth = Math.round((widthMm / 25.4) * targetDpi);
        normalizedHeight = Math.round((heightMm / 25.4) * targetDpi);
      } else {
        normalizedWidth = widthPx;
        normalizedHeight = heightPx;
      }

      normalizedPath = path.join(jobDir, 'normalized.tif');
      if (dpiSource !== targetDpi) {
        const cmdNorm = `magick "${originalPath}${layerSuffix}" -resize ${normalizedWidth}x${normalizedHeight}! -density 300 -units PixelsPerInch "${normalizedPath}"`;
        try {
          execSync(cmdNorm, { stdio: 'pipe' });
          console.log(`[TIFF] Normalisation ${dpiSource} → 300 DPI OK (layer ${layerSuffix})`);
        } catch (err) {
          console.error(`[TIFF] ERREUR normalisation: ${err.message}`);
          try {
            execSync(`magick "${originalPath}${layerSuffix}" "${normalizedPath}"`, { stdio: 'pipe' });
          } catch { fs.copyFileSync(originalPath, normalizedPath); }
        }
      } else {
        // Extraire le bon layer même si déjà 300 DPI
        try {
          execSync(`magick "${originalPath}${layerSuffix}" "${normalizedPath}"`, { stdio: 'pipe' });
        } catch { fs.copyFileSync(originalPath, normalizedPath); }
        console.log(`[TIFF] Déjà 300 DPI, extraction layer ${layerSuffix}`);
      }

      // 6. Conversion ICC selon colorspace
      // Pour les commandes IM, le normalized.tif contient déjà le bon layer extrait,
      // donc pas besoin de [index] sur normalizedPath
      const tiffAlphaPath = path.join(jobDir, 'step1_alpha.png');
      const tiffColorPath = path.join(jobDir, 'step2_color.png');

      if (isCmyk) {
        console.log('[TIFF] Pipeline CMYK — procédure 3 étapes');
        if (iccProfile) {
          iccSourceLabel = iccProfile;
        } else {
          iccSourceLabel = 'CMYK / CoatedFOGRA39 (assigné)';
        }

        // Étape 1 : extraction alpha (forcer -colorspace sRGB)
        try {
          execSync(`magick "${normalizedPath}" -colorspace sRGB -alpha extract "${tiffAlphaPath}"`, { stdio: 'pipe' });
          console.log('[TIFF-CMYK] Étape 1/3 OK : extraction alpha → step1_alpha.png');
        } catch (err) {
          console.error(`[TIFF-CMYK] ERREUR extraction alpha: ${err.message}`);
          iccConversionOk = false;
        }

        // Étape 2 : conversion couleur CMYK → eciRGB v2
        if (iccConversionOk) {
          try {
            let profileCmd;
            if (sourceIccPath) {
              // Utiliser le profil ICC embarqué extrait du fichier source
              profileCmd = `-profile "${sourceIccPath}" -profile "${ECIRGB_PROFILE}"`;
              console.log(`[TIFF-CMYK] Source : profil embarqué (${iccProfile})`);
            } else {
              profileCmd = `-profile "${FOGRA39_PROFILE}" -profile "${ECIRGB_PROFILE}"`;
              console.log(`[TIFF-CMYK] Source : FOGRA39 assigné (pas de profil embarqué)`);
            }
            execSync(`magick "${normalizedPath}" -alpha off ${profileCmd} "${tiffColorPath}"`, { stdio: 'pipe' });
            console.log(`[TIFF-CMYK] Étape 2/3 OK : conversion couleur → step2_color.png`);
          } catch (err) {
            console.error(`[TIFF-CMYK] ERREUR conversion couleur: ${err.message}`);
            iccConversionOk = false;
          }
        }

        // Étape 3 : assemblage couleur + alpha
        if (iccConversionOk) {
          try {
            execSync(`magick "${tiffColorPath}" -alpha off "${tiffAlphaPath}" -compose CopyOpacity -composite PNG32:"${convertedPath}"`, { stdio: 'pipe' });
            console.log('[TIFF-CMYK] Étape 3/3 OK : assemblage final → converted.png');
          } catch (err) {
            console.error(`[TIFF-CMYK] ERREUR assemblage: ${err.message}`);
            iccConversionOk = false;
          }
        }
      } else {
        console.log('[TIFF] Pipeline RGB — procédure 3 étapes');
        if (iccProfile) {
          iccSourceLabel = iccProfile;
        } else {
          iccSourceLabel = 'sRGB (assigné)';
        }

        // Étape 1 : extraction alpha
        try {
          execSync(`magick "${normalizedPath}" -alpha extract "${tiffAlphaPath}"`, { stdio: 'pipe' });
          console.log('[TIFF-RGB] Étape 1/3 OK : extraction alpha → step1_alpha.png');
        } catch (err) {
          console.error(`[TIFF-RGB] ERREUR extraction alpha: ${err.message}`);
          iccConversionOk = false;
        }

        // Étape 2 : conversion couleur → eciRGB v2
        if (iccConversionOk) {
          try {
            let profileCmd;
            if (sourceIccPath) {
              // Utiliser le profil ICC embarqué extrait du fichier source
              profileCmd = `-profile "${sourceIccPath}" -profile "${ECIRGB_PROFILE}"`;
              console.log(`[TIFF-RGB] Source : profil embarqué (${iccProfile})`);
            } else {
              profileCmd = `-profile "${SRGB_PROFILE}" -profile "${ECIRGB_PROFILE}"`;
              console.log(`[TIFF-RGB] Source : sRGB assigné (pas de profil embarqué)`);
            }
            execSync(`magick "${normalizedPath}" -alpha off ${profileCmd} "${tiffColorPath}"`, { stdio: 'pipe' });
            console.log(`[TIFF-RGB] Étape 2/3 OK : conversion couleur → step2_color.png`);
          } catch (err) {
            console.error(`[TIFF-RGB] ERREUR conversion couleur: ${err.message}`);
            iccConversionOk = false;
          }
        }

        // Étape 3 : assemblage couleur + alpha
        if (iccConversionOk) {
          try {
            execSync(`magick "${tiffColorPath}" -alpha off "${tiffAlphaPath}" -compose CopyOpacity -composite PNG32:"${convertedPath}"`, { stdio: 'pipe' });
            console.log('[TIFF-RGB] Étape 3/3 OK : assemblage final → converted.png');
          } catch (err) {
            console.error(`[TIFF-RGB] ERREUR assemblage: ${err.message}`);
            iccConversionOk = false;
          }
        }
      }

      // Corriger le nom du profil iCCP
      if (iccConversionOk) {
        try {
          fixIccpProfileName(convertedPath, 'eciRGB v2');
          console.log('[TIFF] Nom du profil iCCP corrigé → "eciRGB v2"');
        } catch (err) {
          console.error(`[TIFF] ERREUR correction iCCP: ${err.message}`);
        }
      }

      // normalized.tif conservé pour debug dans uploads/{id}/
      console.log(`[TIFF] Fichiers intermédiaires conservés dans uploads/${id}/`);

    } else if (isPdf) {
      // ==================== PIPELINE PDF ====================
      // 1. Sauvegarder l'original PDF
      const originalPath = path.join(jobDir, 'original.pdf');
      fs.writeFileSync(originalPath, req.file.buffer);

      // 2. Détecter le colorspace et le profil ICC du PDF
      let colorspace = 'sRGB'; // défaut
      let pdfIccProfile = null; // profil ICC embarqué dans le PDF
      try {
        const csOut = execSync(`magick identify -format "%[colorspace]" "${originalPath}[0]"`, { stdio: 'pipe' }).toString().trim();
        if (csOut) colorspace = csOut;
        console.log(`[PDF] Colorspace détecté : ${colorspace}`);
      } catch (err) {
        console.warn(`[PDF] Impossible de détecter le colorspace, défaut sRGB: ${err.message}`);
      }
      try {
        const iccOut = execSync(`magick identify -format "%[photoshop:ICCProfile]" "${originalPath}[0]"`, { stdio: 'pipe' }).toString().trim();
        if (iccOut) {
          pdfIccProfile = iccOut;
          console.log(`[PDF] Profil ICC détecté dans le PDF : ${pdfIccProfile}`);
        }
      } catch {}

      const isCmyk = colorspace.toUpperCase() === 'CMYK';

      // 3. Rastérisation PDF → PNG avec conversion ICC selon colorspace
      if (isCmyk) {
        console.log('[PDF] Pipeline CMYK détecté — procédure 3 étapes (conversionpdfOK.bat)');
        iccSourceLabel = 'CMYK / CoatedFOGRA39 (assigné)';
        iccProfile = 'CoatedFOGRA39';

        const alphaPath = path.join(jobDir, 'step1_alpha.png');
        const colorPath = path.join(jobDir, 'step2_color.png');

        // Étape 1 : extraction alpha (forcer -colorspace sRGB pour que Ghostscript rastérise l'alpha correctement)
        try {
          execSync(`magick -quiet -density 300 -background none -colorspace sRGB "${originalPath}[0]" -alpha extract "${alphaPath}"`, { stdio: 'pipe' });
          console.log('[PDF-CMYK] Étape 1/3 OK : extraction alpha → step1_alpha.png');
        } catch (err) {
          console.error(`[PDF-CMYK] ERREUR extraction alpha: ${err.message}`);
          iccConversionOk = false;
        }

        // Étape 2 : conversion couleur (forcer -colorspace CMYK pour empêcher Ghostscript de pré-convertir)
        if (iccConversionOk) {
          try {
            execSync(`magick -quiet -density 300 -colorspace CMYK "${originalPath}[0]" -profile "${FOGRA39_PROFILE}" -profile "${ECIRGB_PROFILE}" "${colorPath}"`, { stdio: 'pipe' });
            console.log('[PDF-CMYK] Étape 2/3 OK : conversion couleur → step2_color.png');
          } catch (err) {
            console.error(`[PDF-CMYK] ERREUR conversion couleur: ${err.message}`);
            iccConversionOk = false;
          }
        }

        // Étape 3 : assemblage couleur + alpha
        if (iccConversionOk) {
          try {
            execSync(`magick "${colorPath}" -alpha off "${alphaPath}" -compose CopyOpacity -composite PNG32:"${convertedPath}"`, { stdio: 'pipe' });
            console.log('[PDF-CMYK] Étape 3/3 OK : assemblage final → converted.png');
          } catch (err) {
            console.error(`[PDF-CMYK] ERREUR assemblage: ${err.message}`);
            iccConversionOk = false;
          }
        }

        // Fichiers intermédiaires conservés pour debug dans uploads/{id}/
      } else {
        console.log('[PDF] Pipeline RGB détecté — procédure 4 étapes');

        const rasterPath = path.join(jobDir, 'step1_raster.png');
        const alphaPath = path.join(jobDir, 'step2_alpha.png');
        const colorPath = path.join(jobDir, 'step3_color.png');

        // Étape 1 : rastérisation PDF → PNG32 avec transparence
        try {
          execSync(`magick -quiet -density 300 -background none "${originalPath}[0]" PNG32:"${rasterPath}"`, { stdio: 'pipe' });
          console.log('[PDF-RGB] Étape 1/4 OK : rastérisation → step1_raster.png');
        } catch (err) {
          console.error(`[PDF-RGB] ERREUR rastérisation: ${err.message}`);
          iccConversionOk = false;
        }

        // Extraire le profil ICC embarqué dans le PNG rasterisé
        let pdfSourceIccPath = null;
        let pdfSourceIsEci = false;
        try {
          const rasterMeta = await sharp(rasterPath).metadata();
          if (rasterMeta.icc) {
            const embeddedName = extractIccDescription(rasterMeta.icc);
            pdfSourceIccPath = path.join(jobDir, 'source_profile.icc');
            fs.writeFileSync(pdfSourceIccPath, rasterMeta.icc);
            iccProfile = embeddedName;
            iccSourceLabel = embeddedName || 'profil embarqué (nom inconnu)';
            // Vérifier si c'est déjà eciRGB
            if (embeddedName && (embeddedName.toLowerCase().includes('ecirgb') || embeddedName.toLowerCase().includes('eci-rgb') || embeddedName.toLowerCase().includes('eci rgb'))) {
              pdfSourceIsEci = true;
            }
            console.log(`[PDF-RGB] Profil ICC embarqué extrait → source_profile.icc (${embeddedName}, isEci=${pdfSourceIsEci})`);
          }
        } catch {}

        // Fallback : détection XMP photoshop:ICCProfile si pas de profil embarqué
        if (!pdfSourceIccPath) {
          const resolved = resolveIccProfile(pdfIccProfile);
          if (resolved) {
            pdfSourceIccPath = resolved.path;
            iccProfile = resolved.name;
            iccSourceLabel = resolved.name;
            pdfSourceIsEci = resolved.isEci;
          } else {
            iccProfile = 'sRGB';
            iccSourceLabel = 'sRGB (assigné par défaut)';
          }
        }
        console.log(`[PDF-RGB] Profil source : ${iccSourceLabel} (isEci=${pdfSourceIsEci})`);

        // Étape 2 : extraction alpha
        if (iccConversionOk) {
          try {
            execSync(`magick "${rasterPath}" -alpha extract "${alphaPath}"`, { stdio: 'pipe' });
            console.log('[PDF-RGB] Étape 2/4 OK : extraction alpha → step2_alpha.png');
          } catch (err) {
            console.error(`[PDF-RGB] ERREUR extraction alpha: ${err.message}`);
            iccConversionOk = false;
          }
        }

        // Étape 3 : conversion couleur → eciRGB v2
        if (iccConversionOk) {
          try {
            let profileCmd;
            if (pdfSourceIsEci) {
              // Source déjà eciRGB → pas de conversion, juste réassigner le profil
              profileCmd = pdfSourceIccPath ? `-profile "${pdfSourceIccPath}"` : `-profile "${ECIRGB_PROFILE}"`;
              console.log(`[PDF-RGB] Source déjà eciRGB → pas de conversion`);
            } else if (pdfSourceIccPath) {
              // Profil embarqué extrait → utiliser comme source
              profileCmd = `-profile "${pdfSourceIccPath}" -profile "${ECIRGB_PROFILE}"`;
              console.log(`[PDF-RGB] Source : profil embarqué (${iccProfile}) → conversion vers eciRGB`);
            } else {
              // Pas de profil → fallback sRGB
              profileCmd = `-profile "${SRGB_PROFILE}" -profile "${ECIRGB_PROFILE}"`;
              console.log(`[PDF-RGB] Source : sRGB assigné → conversion vers eciRGB`);
            }
            execSync(`magick "${rasterPath}" -alpha off ${profileCmd} "${colorPath}"`, { stdio: 'pipe' });
            console.log(`[PDF-RGB] Étape 3/4 OK : conversion couleur → step3_color.png`);
          } catch (err) {
            console.error(`[PDF-RGB] ERREUR conversion couleur: ${err.message}`);
            iccConversionOk = false;
          }
        }

        // Étape 4 : assemblage couleur + alpha
        if (iccConversionOk) {
          try {
            execSync(`magick "${colorPath}" -alpha off "${alphaPath}" -compose CopyOpacity -composite PNG32:"${convertedPath}"`, { stdio: 'pipe' });
            console.log('[PDF-RGB] Étape 4/4 OK : assemblage final → converted.png');
          } catch (err) {
            console.error(`[PDF-RGB] ERREUR assemblage: ${err.message}`);
            iccConversionOk = false;
          }
        }

        // Fichiers intermédiaires conservés pour debug dans uploads/{id}/
      }

      // Corriger le nom du profil iCCP
      if (iccConversionOk) {
        try {
          fixIccpProfileName(convertedPath, 'eciRGB v2');
          console.log('[PDF] Nom du profil iCCP corrigé → "eciRGB v2"');
        } catch (err) {
          console.error(`[PDF] ERREUR correction iCCP: ${err.message}`);
        }
      }

      // Lire les dimensions du PNG rastérisé pour calculer les mm
      if (iccConversionOk) {
        const convertedMeta = await sharp(convertedPath).metadata();
        normalizedWidth = convertedMeta.width;
        normalizedHeight = convertedMeta.height;
        hasAlpha = convertedMeta.hasAlpha || false;
      } else {
        // Fallback: pas de fichier converti
        normalizedWidth = 0;
        normalizedHeight = 0;
        hasAlpha = false;
      }

      dpiSource = 300; // La rastérisation à -density 300 produit du 300 DPI
      widthMm = round2((normalizedWidth / 300) * 25.4);
      heightMm = round2((normalizedHeight / 300) * 25.4);

      // Pas de normalized.png pour les PDF (la rastérisation est directement à 300 DPI)
      normalizedPath = convertedPath;

    } else {
      // ==================== PIPELINE PNG (existant) ====================
      // 1. Sauvegarder l'original
      const originalPath = path.join(jobDir, 'original.png');
      fs.writeFileSync(originalPath, req.file.buffer);

      // 2. Lire les métadonnées avec Sharp
      const image = sharp(req.file.buffer);
      const metadata = await image.metadata();

      const widthPx = metadata.width;
      const heightPx = metadata.height;
      dpiSource = metadata.density || 72;
      hasAlpha = metadata.hasAlpha || false;

      // Profil ICC embarqué
      iccProfile = null;
      if (metadata.icc) {
        iccProfile = extractIccDescription(metadata.icc);
      }

      // Dimensions physiques en mm (basées sur le DPI réel lu dans les métadonnées/pHYs)
      widthMm = round2((widthPx / dpiSource) * 25.4);
      heightMm = round2((heightPx / dpiSource) * 25.4);

      // 3. Normalisation 300 DPI
      if (dpiSource !== targetDpi) {
        normalizedWidth = Math.round((widthMm / 25.4) * targetDpi);
        normalizedHeight = Math.round((heightMm / 25.4) * targetDpi);
      } else {
        normalizedWidth = widthPx;
        normalizedHeight = heightPx;
      }

      normalizedPath = path.join(jobDir, 'normalized.png');
      await sharp(req.file.buffer)
        .resize(normalizedWidth, normalizedHeight, {
          kernel: sharp.kernel.lanczos3,
          fit: 'fill'
        })
        .withMetadata({ density: targetDpi })
        .png({ compressionLevel: 6 })
        .toFile(normalizedPath);

      // 4. Conversion ICC avec ImageMagick (normalized.png → converted.png)
      // Extraire le profil ICC embarqué si présent
      let pngSourceIccPath = null;
      if (metadata.icc) {
        pngSourceIccPath = path.join(jobDir, 'source_profile.icc');
        fs.writeFileSync(pngSourceIccPath, metadata.icc);
        iccSourceLabel = iccProfile || 'profil embarqué';
        console.log(`[PNG] Profil ICC embarqué extrait → source_profile.icc (${iccProfile})`);
      } else {
        iccSourceLabel = 'sRGB (assigné)';
      }

      // Conversion 3 étapes (comme TIFF/PDF) pour cohérence
      const pngAlphaPath = path.join(jobDir, 'step1_alpha.png');
      const pngColorPath = path.join(jobDir, 'step2_color.png');

      try {
        // Étape 1 : extraction alpha
        execSync(`magick "${normalizedPath}" -alpha extract "${pngAlphaPath}"`, { stdio: 'pipe' });
        console.log('[PNG] Étape 1/3 OK : extraction alpha → step1_alpha.png');

        // Étape 2 : conversion couleur
        let profileCmd;
        if (pngSourceIccPath) {
          // Vérifier si déjà eciRGB
          const isEci = iccProfile && (iccProfile.toLowerCase().includes('ecirgb') || iccProfile.toLowerCase().includes('eci-rgb') || iccProfile.toLowerCase().includes('eci rgb'));
          if (isEci) {
            profileCmd = `-profile "${pngSourceIccPath}"`;
            console.log(`[PNG] Source déjà eciRGB → pas de conversion`);
          } else {
            profileCmd = `-profile "${pngSourceIccPath}" -profile "${ECIRGB_PROFILE}"`;
            console.log(`[PNG] Source : profil embarqué (${iccProfile}) → conversion vers eciRGB`);
          }
        } else {
          profileCmd = `-profile "${SRGB_PROFILE}" -profile "${ECIRGB_PROFILE}"`;
          console.log(`[PNG] Source : sRGB assigné → conversion vers eciRGB`);
        }
        execSync(`magick "${normalizedPath}" -alpha off ${profileCmd} "${pngColorPath}"`, { stdio: 'pipe' });
        console.log('[PNG] Étape 2/3 OK : conversion couleur → step2_color.png');

        // Étape 3 : assemblage
        execSync(`magick "${pngColorPath}" -alpha off "${pngAlphaPath}" -compose CopyOpacity -composite PNG32:"${convertedPath}"`, { stdio: 'pipe' });
        console.log('[PNG] Étape 3/3 OK : assemblage final → converted.png');
      } catch (err) {
        console.error(`[PNG] ERREUR conversion ICC: ${err.message}`);
        iccConversionOk = false;
      }

      // Corriger le nom du profil dans le chunk iCCP du PNG
      if (iccConversionOk) {
        try {
          fixIccpProfileName(convertedPath, 'eciRGB v2');
          console.log('[ICC] Nom du profil iCCP corrigé → "eciRGB v2"');
        } catch (err) {
          console.error(`[ICC] ERREUR correction iCCP: ${err.message}`);
        }
      }
    }

    // ==================== COMMUN : Miniature + Réponse ====================
    // Fallback : si la conversion ICC a échoué, utiliser normalized.png
    const sourceForThumb = iccConversionOk ? convertedPath : normalizedPath;
    if (!iccConversionOk) {
      console.warn('[ICC] CONVERSION ICC ÉCHOUÉE — fallback sur normalized.png');
    }

    // Miniature ~150 DPI à partir du converted.png (ou fallback)
    const thumbWidth = Math.round(normalizedWidth / 2);
    const thumbHeight = Math.round(normalizedHeight / 2);
    const thumbnailPath = path.join(jobDir, 'thumbnail.png');

    await sharp(sourceForThumb)
      .resize(thumbWidth, thumbHeight, {
        kernel: sharp.kernel.lanczos3,
        fit: 'fill'
      })
      .withMetadata({ density: 150 })
      .png({ compressionLevel: 6 })
      .toFile(thumbnailPath);

    // Réponse JSON
    res.json({
      id,
      name: req.file.originalname,
      type: isPdf ? 'pdf' : (isTiff ? 'tiff' : 'png'),
      width_mm: widthMm,
      height_mm: heightMm,
      width_px: normalizedWidth,
      height_px: normalizedHeight,
      dpi_source: dpiSource,
      has_alpha: hasAlpha,
      icc_profile: iccProfile,
      icc_source: iccSourceLabel,
      icc_target: 'eciRGB_v2',
      thumbnail_url: `/uploads/${id}/thumbnail.png`
    });

  } catch (err) {
    console.error('Erreur upload:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Endpoint trim (rognage) : rogne l'image, régénère la thumbnail, retourne les nouvelles dimensions ──
router.get('/trim/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const jobDir = path.join(__dirname, '..', 'uploads', id);
    if (!fs.existsSync(jobDir)) return res.status(404).json({ error: 'Fichier non trouvé' });

    // Chercher l'image source (converted.png ou normalized.png)
    const convertedPath = path.join(jobDir, 'converted.png');
    const normalizedPath = path.join(jobDir, 'normalized.png');
    const imgPath = fs.existsSync(convertedPath) ? convertedPath : normalizedPath;
    if (!fs.existsSync(imgPath)) return res.status(404).json({ error: 'Image non trouvée' });

    // Lire le DPI avant le trim
    const metaBefore = await sharp(imgPath).metadata();
    const dpi = metaBefore.density || 300;

    // Rogner l'image avec ImageMagick -trim +repage
    execSync(`magick "${imgPath}" -trim +repage PNG32:"${imgPath}"`, { stdio: 'pipe' });
    console.log(`[trim] Image rognée: ${imgPath}`);

    // Lire les nouvelles dimensions après trim
    const metaAfter = await sharp(imgPath).metadata();
    const cropW = metaAfter.width;
    const cropH = metaAfter.height;
    const newWidthMm = Math.round((cropW / dpi) * 25.4 * 10) / 10;
    const newHeightMm = Math.round((cropH / dpi) * 25.4 * 10) / 10;

    // Régénérer la thumbnail rognée
    const thumbnailPath = path.join(jobDir, 'thumbnail.png');
    const thumbWidth = Math.round(cropW / 2);
    const thumbHeight = Math.round(cropH / 2);
    await sharp(imgPath)
      .resize(thumbWidth, thumbHeight, { kernel: sharp.kernel.lanczos3, fit: 'fill' })
      .withMetadata({ density: 150 })
      .png({ compressionLevel: 6 })
      .toFile(thumbnailPath + '.tmp');
    fs.renameSync(thumbnailPath + '.tmp', thumbnailPath);
    console.log(`[trim] Thumbnail régénérée: ${thumbnailPath}`);

    res.json({
      trimmed: { width_mm: newWidthMm, height_mm: newHeightMm },
      pixels: { cropW, cropH },
      thumbnail_url: `/uploads/${id}/thumbnail.png?t=${Date.now()}`,
    });
  } catch (err) {
    console.error('Erreur trim:', err);
    res.status(500).json({ error: err.message });
  }
});

// Correction du nom de profil dans le chunk iCCP d'un fichier PNG
// ImageMagick écrit "icc" au lieu du vrai nom du profil (ex: "eciRGB v2")
function fixIccpProfileName(pngPath, newProfileName) {
  const buf = fs.readFileSync(pngPath);
  const PNG_SIG_LEN = 8;
  let pos = PNG_SIG_LEN;

  while (pos < buf.length) {
    const chunkLen = buf.readUInt32BE(pos);
    const chunkType = buf.toString('ascii', pos + 4, pos + 8);

    if (chunkType === 'iCCP') {
      // Trouver la fin du nom de profil (null-terminated)
      const dataStart = pos + 8;
      let nullPos = dataStart;
      while (nullPos < dataStart + chunkLen && buf[nullPos] !== 0x00) {
        nullPos++;
      }
      const oldName = buf.toString('ascii', dataStart, nullPos);
      const oldNameLen = nullPos - dataStart; // bytes du nom sans le null

      if (oldName === newProfileName) {
        return; // Déjà correct
      }

      const newNameBuf = Buffer.from(newProfileName, 'ascii');
      const sizeDiff = newNameBuf.length - oldNameLen;

      // Reste des données après le nom + null byte : compression method + compressed profile
      const restOfData = buf.slice(nullPos, dataStart + chunkLen);

      // Nouvelles données du chunk : nouveau nom + reste (null + compression + profile data)
      const newData = Buffer.concat([newNameBuf, restOfData]);
      const newChunkLen = newData.length;

      // Construire le nouveau chunk
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(newChunkLen);

      const typeBuf = Buffer.from('iCCP', 'ascii');

      // CRC32 couvre type + data
      const crcInput = Buffer.concat([typeBuf, newData]);
      const crc = zlib.crc32(crcInput);
      const crcBuf = Buffer.alloc(4);
      crcBuf.writeUInt32BE(crc >>> 0);

      // Reconstruire le fichier PNG : avant le chunk + nouveau chunk + après le chunk
      const before = buf.slice(0, pos);
      const after = buf.slice(pos + 4 + 4 + chunkLen + 4); // length + type + data + crc
      const newChunk = Buffer.concat([lenBuf, typeBuf, newData, crcBuf]);
      const result = Buffer.concat([before, newChunk, after]);

      fs.writeFileSync(pngPath, result);
      console.log(`[ICC] iCCP: nom de profil corrigé "${oldName}" → "${newProfileName}"`);
      return;
    }

    // Passer au chunk suivant : 4 (length) + 4 (type) + chunkLen (data) + 4 (crc)
    pos += 4 + 4 + chunkLen + 4;
  }

  console.warn('[ICC] Aucun chunk iCCP trouvé dans le PNG');
}

// Utilitaire : arrondir à 1 décimale
function round2(val) {
  return Math.round(val * 10) / 10;
}

// Extraction basique du nom de profil ICC depuis le buffer brut
function extractIccDescription(iccBuffer) {
  try {
    const tagCount = iccBuffer.readUInt32BE(128);
    let offset = 132;
    for (let i = 0; i < tagCount; i++) {
      const tagSig = iccBuffer.toString('ascii', offset, offset + 4);
      const tagOffset = iccBuffer.readUInt32BE(offset + 4);
      if (tagSig === 'desc') {
        const typeSig = iccBuffer.toString('ascii', tagOffset, tagOffset + 4);
        if (typeSig === 'desc') {
          const strLen = iccBuffer.readUInt32BE(tagOffset + 8);
          const desc = iccBuffer.toString('ascii', tagOffset + 12, tagOffset + 12 + strLen - 1);
          return desc || null;
        }
        if (typeSig === 'mluc') {
          const recordCount = iccBuffer.readUInt32BE(tagOffset + 8);
          if (recordCount > 0) {
            const strOffset = iccBuffer.readUInt32BE(tagOffset + 20);
            const strLength = iccBuffer.readUInt32BE(tagOffset + 16);
            const desc = iccBuffer.toString('utf16le', tagOffset + strOffset, tagOffset + strOffset + strLength).replace(/\0/g, '');
            return desc || null;
          }
        }
      }
      offset += 12;
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = router;
