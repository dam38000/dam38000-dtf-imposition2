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
    let alphaPath = path.join(jobDir, '_alpha_tmp.png');
    let rgbConvertedPath = path.join(jobDir, '_rgb_tmp.png');
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
      try {
        const metadata = await sharp(req.file.buffer).metadata();
        if (metadata.icc) {
          iccProfile = extractIccDescription(metadata.icc);
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
      if (isCmyk) {
        console.log('[TIFF] Pipeline CMYK');
        if (iccProfile) {
          iccSourceLabel = iccProfile;
        } else {
          iccSourceLabel = 'CMYK / CoatedFOGRA39 (assigné)';
        }

        // Étape 1 : Extraction alpha
        const cmdAlpha = `magick "${normalizedPath}" -alpha extract "${alphaPath}"`;
        try {
          execSync(cmdAlpha, { stdio: 'pipe' });
          console.log('[TIFF-CMYK] Étape 1/3 OK : alpha extrait');
        } catch (err) {
          console.error(`[TIFF-CMYK] ERREUR étape 1/3: ${err.message}`);
          iccConversionOk = false;
        }

        // Étape 2 : Conversion ICC CMYK → eciRGB v2
        if (iccConversionOk) {
          const cmdRgb = `magick "${normalizedPath}" -colorspace CMYK -profile "${FOGRA39_PROFILE}" -profile "${ECIRGB_PROFILE}" "${rgbConvertedPath}"`;
          try {
            execSync(cmdRgb, { stdio: 'pipe' });
            console.log('[TIFF-CMYK] Étape 2/3 OK : conversion CMYK → eciRGB v2');
          } catch (err) {
            console.error(`[TIFF-CMYK] ERREUR étape 2/3: ${err.message}`);
            iccConversionOk = false;
          }
        }

        // Étape 3 : Réassemblage
        if (iccConversionOk) {
          const cmdComposite = `magick "${rgbConvertedPath}" -alpha off "${alphaPath}" -compose CopyOpacity -composite PNG32:"${convertedPath}"`;
          try {
            execSync(cmdComposite, { stdio: 'pipe' });
            console.log('[TIFF-CMYK] Étape 3/3 OK : réassemblage → converted.png');
          } catch (err) {
            console.error(`[TIFF-CMYK] ERREUR étape 3/3: ${err.message}`);
            iccConversionOk = false;
          }
        }
      } else {
        console.log('[TIFF] Pipeline RGB');
        if (iccProfile) {
          iccSourceLabel = iccProfile;
        } else {
          iccSourceLabel = 'sRGB (assigné)';
        }

        // Étape 1 : Extraction alpha
        const cmdAlpha = `magick "${normalizedPath}" -alpha extract "${alphaPath}"`;
        try {
          execSync(cmdAlpha, { stdio: 'pipe' });
          console.log('[TIFF-RGB] Étape 1/3 OK : alpha extrait');
        } catch (err) {
          console.error(`[TIFF-RGB] ERREUR étape 1/3: ${err.message}`);
          iccConversionOk = false;
        }

        // Étape 2 : Conversion ICC sRGB → eciRGB v2
        if (iccConversionOk) {
          const cmdRgb = `magick "${normalizedPath}" -alpha off -profile "${SRGB_PROFILE}" -profile "${ECIRGB_PROFILE}" "${rgbConvertedPath}"`;
          try {
            execSync(cmdRgb, { stdio: 'pipe' });
            console.log('[TIFF-RGB] Étape 2/3 OK : conversion sRGB → eciRGB v2');
          } catch (err) {
            console.error(`[TIFF-RGB] ERREUR étape 2/3: ${err.message}`);
            iccConversionOk = false;
          }
        }

        // Étape 3 : Réassemblage
        if (iccConversionOk) {
          const cmdComposite = `magick "${rgbConvertedPath}" -alpha off "${alphaPath}" -compose CopyOpacity -composite PNG32:"${convertedPath}"`;
          try {
            execSync(cmdComposite, { stdio: 'pipe' });
            console.log('[TIFF-RGB] Étape 3/3 OK : réassemblage → converted.png');
          } catch (err) {
            console.error(`[TIFF-RGB] ERREUR étape 3/3: ${err.message}`);
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

      // Nettoyage fichiers temporaires
      try { fs.unlinkSync(alphaPath); } catch {}
      try { fs.unlinkSync(rgbConvertedPath); } catch {}
      if (normalizedPath.endsWith('.tif')) {
        try { fs.unlinkSync(normalizedPath); } catch {}
        normalizedPath = convertedPath;
      }

    } else if (isPdf) {
      // ==================== PIPELINE PDF ====================
      // 1. Sauvegarder l'original PDF
      const originalPath = path.join(jobDir, 'original.pdf');
      fs.writeFileSync(originalPath, req.file.buffer);

      // 2. Détecter le colorspace du PDF
      let colorspace = 'sRGB'; // défaut
      try {
        const identifyOut = execSync(`magick identify -verbose "${originalPath}[0]"`, { stdio: 'pipe' }).toString();
        const csMatch = identifyOut.match(/Colorspace:\s*(\S+)/);
        if (csMatch) {
          colorspace = csMatch[1];
        }
        console.log(`[PDF] Colorspace détecté : ${colorspace}`);
      } catch (err) {
        console.warn(`[PDF] Impossible de détecter le colorspace, défaut sRGB: ${err.message}`);
      }

      const isCmyk = colorspace.toUpperCase() === 'CMYK';

      // 3. Rastérisation PDF → PNG avec conversion ICC selon colorspace
      if (isCmyk) {
        console.log('[PDF] Pipeline CMYK détecté');
        iccSourceLabel = 'CMYK / CoatedFOGRA39 (assigné)';
        iccProfile = 'CoatedFOGRA39';

        // Étape 1 : Extraction alpha
        const cmdAlpha = `magick -quiet -density 300 -background none -colorspace sRGB "${originalPath}[0]" -alpha extract "${alphaPath}"`;
        try {
          execSync(cmdAlpha, { stdio: 'pipe' });
          console.log('[PDF-CMYK] Étape 1/3 OK : alpha extrait');
        } catch (err) {
          console.error(`[PDF-CMYK] ERREUR étape 1/3 (extraction alpha)\n  Commande: ${cmdAlpha}\n  Erreur: ${err.message}`);
          iccConversionOk = false;
        }

        // Étape 2 : Conversion ICC CMYK → eciRGB v2
        if (iccConversionOk) {
          const cmdRgb = `magick -quiet -density 300 -colorspace CMYK "${originalPath}[0]" -profile "${FOGRA39_PROFILE}" -profile "${ECIRGB_PROFILE}" "${rgbConvertedPath}"`;
          try {
            execSync(cmdRgb, { stdio: 'pipe' });
            console.log('[PDF-CMYK] Étape 2/3 OK : conversion CMYK → eciRGB v2');
          } catch (err) {
            console.error(`[PDF-CMYK] ERREUR étape 2/3 (conversion ICC)\n  Commande: ${cmdRgb}\n  Erreur: ${err.message}`);
            iccConversionOk = false;
          }
        }

        // Étape 3 : Réassemblage
        if (iccConversionOk) {
          const cmdComposite = `magick "${rgbConvertedPath}" -alpha off "${alphaPath}" -compose CopyOpacity -composite PNG32:"${convertedPath}"`;
          try {
            execSync(cmdComposite, { stdio: 'pipe' });
            console.log('[PDF-CMYK] Étape 3/3 OK : réassemblage → converted.png');
          } catch (err) {
            console.error(`[PDF-CMYK] ERREUR étape 3/3 (réassemblage)\n  Commande: ${cmdComposite}\n  Erreur: ${err.message}`);
            iccConversionOk = false;
          }
        }
      } else {
        console.log('[PDF] Pipeline RGB détecté');
        iccSourceLabel = 'sRGB (assigné)';
        iccProfile = 'sRGB';

        // Étape 1 : Extraction alpha
        const cmdAlpha = `magick -quiet -density 300 -background none "${originalPath}[0]" -alpha extract "${alphaPath}"`;
        try {
          execSync(cmdAlpha, { stdio: 'pipe' });
          console.log('[PDF-RGB] Étape 1/3 OK : alpha extrait');
        } catch (err) {
          console.error(`[PDF-RGB] ERREUR étape 1/3 (extraction alpha)\n  Commande: ${cmdAlpha}\n  Erreur: ${err.message}`);
          iccConversionOk = false;
        }

        // Étape 2 : Conversion ICC sRGB → eciRGB v2
        if (iccConversionOk) {
          const cmdRgb = `magick -quiet -density 300 -background none "${originalPath}[0]" -alpha off -profile "${SRGB_PROFILE}" -profile "${ECIRGB_PROFILE}" "${rgbConvertedPath}"`;
          try {
            execSync(cmdRgb, { stdio: 'pipe' });
            console.log('[PDF-RGB] Étape 2/3 OK : conversion sRGB → eciRGB v2');
          } catch (err) {
            console.error(`[PDF-RGB] ERREUR étape 2/3 (conversion ICC)\n  Commande: ${cmdRgb}\n  Erreur: ${err.message}`);
            iccConversionOk = false;
          }
        }

        // Étape 3 : Réassemblage
        if (iccConversionOk) {
          const cmdComposite = `magick "${rgbConvertedPath}" -alpha off "${alphaPath}" -compose CopyOpacity -composite PNG32:"${convertedPath}"`;
          try {
            execSync(cmdComposite, { stdio: 'pipe' });
            console.log('[PDF-RGB] Étape 3/3 OK : réassemblage → converted.png');
          } catch (err) {
            console.error(`[PDF-RGB] ERREUR étape 3/3 (réassemblage)\n  Commande: ${cmdComposite}\n  Erreur: ${err.message}`);
            iccConversionOk = false;
          }
        }
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

      // Nettoyage fichiers temporaires
      try { fs.unlinkSync(alphaPath); } catch {}
      try { fs.unlinkSync(rgbConvertedPath); } catch {}

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
      // Déterminer le profil source
      if (iccProfile) {
        iccSourceLabel = iccProfile;
      } else {
        iccSourceLabel = 'sRGB (assigné)';
      }

      // Étape 4a : Extraction du canal alpha
      const cmdAlpha = `magick "${normalizedPath}" -alpha extract "${alphaPath}"`;
      try {
        execSync(cmdAlpha, { stdio: 'pipe' });
        console.log('[ICC] Étape 1/3 OK : alpha extrait');
      } catch (err) {
        console.error(`[ICC] ERREUR étape 1/3 (extraction alpha)\n  Commande: ${cmdAlpha}\n  Erreur: ${err.message}`);
        iccConversionOk = false;
      }

      // Étape 4b : Conversion ICC RGB (sans alpha) sRGB → eciRGB v2
      if (iccConversionOk) {
        const cmdRgb = `magick "${normalizedPath}" -alpha off -profile "${SRGB_PROFILE}" -profile "${ECIRGB_PROFILE}" "${rgbConvertedPath}"`;
        try {
          execSync(cmdRgb, { stdio: 'pipe' });
          console.log('[ICC] Étape 2/3 OK : conversion sRGB → eciRGB v2');
        } catch (err) {
          console.error(`[ICC] ERREUR étape 2/3 (conversion ICC)\n  Commande: ${cmdRgb}\n  Erreur: ${err.message}`);
          iccConversionOk = false;
        }
      }

      // Étape 4c : Réassemblage alpha + RGB converti
      if (iccConversionOk) {
        const cmdComposite = `magick "${rgbConvertedPath}" "${alphaPath}" -compose CopyOpacity -composite "${convertedPath}"`;
        try {
          execSync(cmdComposite, { stdio: 'pipe' });
          console.log('[ICC] Étape 3/3 OK : alpha réassemblé → converted.png');
        } catch (err) {
          console.error(`[ICC] ERREUR étape 3/3 (réassemblage)\n  Commande: ${cmdComposite}\n  Erreur: ${err.message}`);
          iccConversionOk = false;
        }
      }

      // Corriger le nom du profil dans le chunk iCCP du PNG
      if (iccConversionOk) {
        try {
          fixIccpProfileName(convertedPath, 'eciRGB v2');
          console.log('[ICC] Étape 4/4 OK : nom du profil iCCP corrigé → "eciRGB v2"');
        } catch (err) {
          console.error(`[ICC] ERREUR étape 4/4 (correction iCCP)\n  Erreur: ${err.message}`);
        }
      }

      // Nettoyage fichiers temporaires
      try { fs.unlinkSync(alphaPath); } catch {}
      try { fs.unlinkSync(rgbConvertedPath); } catch {}
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
