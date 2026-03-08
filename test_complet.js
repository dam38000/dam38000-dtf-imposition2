const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const SERVER_URL = 'http://localhost:3000';
const DESSINS_DIR = path.join(__dirname, 'dessins');
const OUTPUT_DIR = path.join(__dirname, 'controle_conversion');

function uploadFile(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const boundary = '----FormBoundary' + Date.now().toString(16) + Math.random().toString(16);

  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
    `Content-Type: image/png\r\n\r\n`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, fileBuffer, footer]);

  return new Promise((resolve, reject) => {
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
          reject(new Error(`Parsing error: ${e.message} - Raw: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseIdentifyVerbose(output) {
  const info = {
    iccProfile: null,
    type: null,
    dimensions: null,
    resolution: null,
    channels: null
  };

  // Profil ICC
  const profileMatch = output.match(/Profile-icc:\s*(\d+)\s*bytes/i);
  const descMatch = output.match(/icc:description:\s*(.+)/i) || output.match(/description:\s*(.+)/i);
  if (descMatch) {
    info.iccProfile = descMatch[1].trim();
  } else if (profileMatch) {
    info.iccProfile = `ICC profile (${profileMatch[1]} bytes)`;
  }

  // Type
  const typeMatch = output.match(/^\s*Type:\s*(.+)$/m);
  if (typeMatch) info.type = typeMatch[1].trim();

  // Dimensions
  const geomMatch = output.match(/^\s*Geometry:\s*(\d+x\d+)/m);
  if (geomMatch) info.dimensions = geomMatch[1];

  // Resolution
  const resMatch = output.match(/^\s*Resolution:\s*(.+)$/m);
  if (resMatch) info.resolution = resMatch[1].trim();

  // Channels
  const chanMatch = output.match(/^\s*Channel depth:/m);
  // Count channels from channel statistics
  const channelNames = output.match(/^\s*(Red|Green|Blue|Alpha|Gray):/gm);
  if (channelNames) info.channels = channelNames.length;

  return info;
}

async function main() {
  // Find all PNG files in dessins/
  if (!fs.existsSync(DESSINS_DIR)) {
    console.error(`ERREUR: Dossier ${DESSINS_DIR} introuvable`);
    process.exit(1);
  }

  const pngFiles = fs.readdirSync(DESSINS_DIR)
    .filter(f => f.toLowerCase().endsWith('.png'))
    .map(f => path.join(DESSINS_DIR, f));

  if (pngFiles.length === 0) {
    console.error('ERREUR: Aucun fichier PNG trouvé dans dessins/');
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`\n${'='.repeat(70)}`);
  console.log(`  TEST COMPLET - ${pngFiles.length} fichier(s) PNG dans dessins/`);
  console.log(`${'='.repeat(70)}\n`);

  const results = [];

  for (const filePath of pngFiles) {
    const baseName = path.basename(filePath, '.png');
    const fileName = path.basename(filePath);

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`  TRAITEMENT: ${fileName}`);
    console.log(`${'─'.repeat(70)}`);

    let result;
    try {
      console.log(`  Envoi vers POST ${SERVER_URL}/api/upload ...`);
      result = await uploadFile(filePath);
    } catch (err) {
      console.error(`  ERREUR UPLOAD: ${err.message}`);
      results.push({
        name: fileName,
        dpiSource: '?',
        dimensions: '?',
        iccSource: '?',
        conversionOk: 'ECHOUEE',
        alphaPreserved: '?'
      });
      continue;
    }

    // Display full metadata
    console.log(`\n  === METADONNEES RECUES ===`);
    console.log(JSON.stringify(result, null, 2));

    const uploadDir = path.join(__dirname, 'uploads', result.id);

    // Copy files with explicit names
    const copies = [
      { src: 'original.png', dest: `${baseName}_01_original.png` },
      { src: 'normalized.png', dest: `${baseName}_02_normalized_300dpi.png` },
      { src: 'converted.png', dest: `${baseName}_03_converted_ecirgb.png` },
      { src: 'thumbnail.png', dest: `${baseName}_04_thumbnail_150dpi.png` }
    ];

    for (const { src, dest } of copies) {
      const srcPath = path.join(uploadDir, src);
      const destPath = path.join(OUTPUT_DIR, dest);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`  Copie: ${dest}`);
      } else {
        console.warn(`  ATTENTION: ${src} introuvable dans ${uploadDir}`);
      }
    }

    // Analyze converted file with magick identify -verbose
    const convertedCopy = path.join(OUTPUT_DIR, `${baseName}_03_converted_ecirgb.png`);
    let identifyInfo = { iccProfile: null, type: null, dimensions: null, resolution: null, channels: null };
    let alphaPreserved = 'non';

    if (fs.existsSync(convertedCopy)) {
      console.log(`\n  === ANALYSE magick identify -verbose (${baseName}_03_converted_ecirgb.png) ===`);
      try {
        const output = execSync(`magick identify -verbose "${convertedCopy}"`, {
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024
        });
        identifyInfo = parseIdentifyVerbose(output);
        console.log(`  Profil ICC   : ${identifyInfo.iccProfile || 'NON DETECTE'}`);
        console.log(`  Type         : ${identifyInfo.type || '?'}`);
        console.log(`  Dimensions   : ${identifyInfo.dimensions || '?'}`);
        console.log(`  Resolution   : ${identifyInfo.resolution || '?'}`);
        console.log(`  Canaux       : ${identifyInfo.channels || '?'}`);

        // Check alpha
        if (identifyInfo.type && identifyInfo.type.toLowerCase().includes('alpha')) {
          alphaPreserved = 'oui';
        }
        if (identifyInfo.channels && identifyInfo.channels >= 4) {
          alphaPreserved = 'oui';
        }
      } catch (err) {
        console.error(`  ERREUR magick identify: ${err.message}`);
      }
    }

    const convOk = fs.existsSync(path.join(uploadDir, 'converted.png')) ? 'OK' : 'ECHOUEE';

    results.push({
      name: fileName,
      dpiSource: result.dpi_source,
      dimensions: `${result.width_mm}x${result.height_mm} mm`,
      iccSource: result.icc_source || result.icc_profile || 'aucun',
      conversionOk: convOk,
      alphaPreserved: alphaPreserved,
      identifyInfo
    });
  }

  // Summary table
  console.log(`\n\n${'='.repeat(90)}`);
  console.log(`  TABLEAU RECAPITULATIF`);
  console.log(`${'='.repeat(90)}`);

  const colWidths = { name: 20, dpi: 10, dim: 20, icc: 25, conv: 12, alpha: 8 };
  const header = [
    'Nom source'.padEnd(colWidths.name),
    'DPI src'.padEnd(colWidths.dpi),
    'Dimensions mm'.padEnd(colWidths.dim),
    'Profil ICC source'.padEnd(colWidths.icc),
    'Conversion'.padEnd(colWidths.conv),
    'Alpha'.padEnd(colWidths.alpha)
  ].join(' | ');

  console.log(`  ${header}`);
  console.log(`  ${'-'.repeat(header.length)}`);

  for (const r of results) {
    const row = [
      String(r.name).padEnd(colWidths.name),
      String(r.dpiSource).padEnd(colWidths.dpi),
      String(r.dimensions).padEnd(colWidths.dim),
      String(r.iccSource).padEnd(colWidths.icc),
      String(r.conversionOk).padEnd(colWidths.conv),
      String(r.alphaPreserved).padEnd(colWidths.alpha)
    ].join(' | ');
    console.log(`  ${row}`);
  }

  console.log(`  ${'-'.repeat(header.length)}`);

  // Anomalies
  console.log(`\n  === ANOMALIES ===`);
  let anomalyCount = 0;
  for (const r of results) {
    if (r.conversionOk !== 'OK') {
      console.log(`  [!] ${r.name} : conversion ICC ECHOUEE`);
      anomalyCount++;
    }
    if (r.alphaPreserved === 'non') {
      console.log(`  [!] ${r.name} : canal alpha NON preserve`);
      anomalyCount++;
    }
    if (r.identifyInfo && r.identifyInfo.iccProfile && !r.identifyInfo.iccProfile.toLowerCase().includes('ecirgb')) {
      console.log(`  [!] ${r.name} : profil ICC converti = "${r.identifyInfo.iccProfile}" (attendu: eciRGB v2)`);
      anomalyCount++;
    }
  }
  if (anomalyCount === 0) {
    console.log(`  Aucune anomalie detectee.`);
  }

  console.log(`\n  Total: ${results.length} fichier(s) teste(s), ${anomalyCount} anomalie(s)\n`);
}

main().catch(err => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
