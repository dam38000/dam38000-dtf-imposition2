const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const SERVER_URL = 'http://localhost:3000';
const DESSINS_DIR = path.join(__dirname, 'dessins');
const OUTPUT_DIR = path.join(__dirname, 'controle_conversion');

// Extensions supportées
const SUPPORTED_EXT = ['.png', '.pdf', '.tif', '.tiff'];

// MIME types par extension
const MIME_MAP = {
  '.png': 'image/png',
  '.pdf': 'application/pdf',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
};

function uploadFile(filePath) {
  return new Promise((resolve, reject) => {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    const boundary = '----FormBoundary' + Date.now().toString(16) + Math.random().toString(16);

    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, fileBuffer, footer]);

    const url = new URL(`${SERVER_URL}/api/upload`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(result)}`));
          } else {
            resolve(result);
          }
        } catch (e) {
          reject(new Error(`Parse error: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Lister tous les fichiers supportés dans dessins/
  const allFiles = fs.readdirSync(DESSINS_DIR)
    .filter(f => {
      const ext = path.extname(f).toLowerCase();
      return SUPPORTED_EXT.includes(ext) && !fs.statSync(path.join(DESSINS_DIR, f)).isDirectory();
    })
    .sort();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  TEST COMPLET - ${allFiles.length} fichier(s) dans dessins/`);
  console.log(`${'='.repeat(70)}\n`);

  const results = [];

  for (const fileName of allFiles) {
    const filePath = path.join(DESSINS_DIR, fileName);
    const baseName = path.parse(fileName).name;
    const ext = path.extname(fileName).toLowerCase();

    console.log(`${'─'.repeat(70)}`);
    console.log(`  TRAITEMENT: ${fileName}`);
    console.log(`${'─'.repeat(70)}`);

    try {
      const result = await uploadFile(filePath);
      console.log(`  Métadonnées:`, JSON.stringify(result, null, 2));

      const uploadDir = path.join(__dirname, 'uploads', result.id);

      // Copier les fichiers avec noms explicites
      const copies = [
        { src: `original${ext}`, dest: `${baseName}_01_original${ext}` },
        { src: 'converted.png', dest: `${baseName}_02_converted_ecirgb.png` },
        { src: 'thumbnail.png', dest: `${baseName}_03_thumbnail.png` }
      ];

      // Pour les PNG et TIFF, il y a aussi un normalized
      if (ext === '.png' || ext === '.tif' || ext === '.tiff') {
        const normExt = ext === '.png' ? '.png' : '.tif';
        copies.push({ src: `normalized${normExt === '.tif' ? '.tif' : '.png'}`, dest: `${baseName}_04_normalized.png` });
      }

      for (const copy of copies) {
        // Chercher le fichier source (peut être .png ou .tif pour normalized)
        let srcPath = path.join(uploadDir, copy.src);
        if (!fs.existsSync(srcPath) && copy.src === 'normalized.tif') {
          srcPath = path.join(uploadDir, 'normalized.png');
        }
        if (!fs.existsSync(srcPath)) {
          // Chercher tout fichier normalized
          const files = fs.readdirSync(uploadDir).filter(f => f.startsWith('normalized'));
          if (files.length > 0) srcPath = path.join(uploadDir, files[0]);
        }

        const destPath = path.join(OUTPUT_DIR, copy.dest);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, destPath);
          const size = (fs.statSync(destPath).size / 1024).toFixed(1);
          console.log(`  Copié: ${copy.dest} (${size} KB)`);
        } else {
          console.log(`  MANQUANT: ${copy.src}`);
        }
      }

      // Vérifier le converted avec magick identify
      const convertedPath = path.join(OUTPUT_DIR, `${baseName}_02_converted_ecirgb.png`);
      let iccOk = '?', alphaOk = '?', alphaStats = '?';

      if (fs.existsSync(convertedPath)) {
        try {
          const identify = execSync(`magick identify -verbose "${convertedPath}"`, { encoding: 'utf8' });
          const iccDesc = identify.match(/icc:description:\s*(.*)/);
          const type = identify.match(/Type:\s*(.*)/);
          iccOk = iccDesc ? iccDesc[1].trim() : 'NON TROUVÉ';
          alphaOk = type && type[1].includes('Alpha') ? 'oui' : 'NON';

          // Vérifier que l'alpha n'est pas tout noir
          const alphaInfo = execSync(`magick "${convertedPath}" -alpha extract -format "min:%[min] max:%[max] mean:%[mean]" info:`, { encoding: 'utf8' });
          alphaStats = alphaInfo.trim();
        } catch (e) {
          iccOk = 'ERREUR';
          alphaStats = 'ERREUR: ' + e.message.substring(0, 50);
        }
      }

      results.push({
        name: fileName,
        dpi_source: result.dpi_source,
        dims: `${result.width_mm}x${result.height_mm} mm`,
        icc_source: result.icc_source || result.icc_profile || 'aucun',
        icc_output: iccOk,
        alpha: alphaOk,
        alpha_stats: alphaStats,
        status: 'OK'
      });

    } catch (e) {
      console.log(`  ERREUR: ${e.message}`);
      results.push({
        name: fileName,
        dpi_source: '?',
        dims: '?',
        icc_source: '?',
        icc_output: '?',
        alpha: '?',
        alpha_stats: '?',
        status: 'ÉCHOUÉ: ' + e.message.substring(0, 40)
      });
    }
    console.log('');
  }

  // Tableau récapitulatif
  console.log(`\n${'='.repeat(100)}`);
  console.log('  TABLEAU RÉCAPITULATIF');
  console.log(`${'='.repeat(100)}`);
  console.log(`  ${'Fichier'.padEnd(20)} | ${'DPI'.padEnd(6)} | ${'Dimensions'.padEnd(16)} | ${'ICC source'.padEnd(25)} | ${'ICC sortie'.padEnd(12)} | ${'Alpha'.padEnd(6)} | Status`);
  console.log(`  ${'-'.repeat(95)}`);
  for (const r of results) {
    console.log(`  ${r.name.padEnd(20)} | ${String(r.dpi_source).padEnd(6)} | ${r.dims.padEnd(16)} | ${r.icc_source.substring(0,25).padEnd(25)} | ${r.icc_output.substring(0,12).padEnd(12)} | ${r.alpha.padEnd(6)} | ${r.status}`);
  }
  console.log(`  ${'-'.repeat(95)}`);

  // Détails alpha
  console.log(`\n  DÉTAILS ALPHA :`);
  for (const r of results) {
    console.log(`  ${r.name.padEnd(20)} : ${r.alpha_stats}`);
  }

  console.log(`\n  Total: ${results.length} fichier(s), ${results.filter(r => r.status === 'OK').length} OK, ${results.filter(r => r.status !== 'OK').length} erreur(s)\n`);
}

main().catch(e => { console.error('ERREUR FATALE:', e); process.exit(1); });
