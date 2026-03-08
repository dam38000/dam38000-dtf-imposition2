const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE_URL = 'http://localhost:3000/api/upload';
const DESSINS_DIR = path.join(__dirname, 'dessins');
const CONTROL_DIR = path.join(__dirname, 'controle_conversion');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

fs.mkdirSync(CONTROL_DIR, { recursive: true });

const testFiles = [
  { file: 'fogra39.tif', prefix: 'fogra39_tif' },
  { file: 'sRGB.tif', prefix: 'sRGB_tif' },
];

const results = [];

async function main() {
  const FormData = (await import('form-data')).default;
  const fetch = (await import('node-fetch')).default;

  for (const { file, prefix } of testFiles) {
    const filePath = path.join(DESSINS_DIR, file);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST : ${file}`);
    console.log('='.repeat(60));

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    const res = await fetch(BASE_URL, { method: 'POST', body: form });
    if (!res.ok) {
      const text = await res.text();
      console.error(`ERREUR upload (${res.status}): ${text}`);
      results.push({ source: file, colorspace: '?', dpi: '?', dimMm: '?', conversion: 'ÉCHOUÉE', alpha: '?' });
      continue;
    }
    const meta = await res.json();

    console.log('\n--- Métadonnées reçues ---');
    console.log(JSON.stringify(meta, null, 2));

    const jobDir = path.join(UPLOADS_DIR, meta.id);
    const originalSrc = path.join(jobDir, 'original.tif');
    const convertedSrc = path.join(jobDir, 'converted.png');
    const thumbSrc = path.join(jobDir, 'thumbnail.png');

    const copies = [
      { src: originalSrc, dst: path.join(CONTROL_DIR, `${prefix}_01_original.tif`) },
      { src: convertedSrc, dst: path.join(CONTROL_DIR, `${prefix}_02_converted_ecirgb.png`) },
      { src: thumbSrc, dst: path.join(CONTROL_DIR, `${prefix}_03_thumbnail.png`) },
    ];

    for (const { src, dst } of copies) {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dst);
        console.log(`Copié : ${path.basename(dst)}`);
      } else {
        console.warn(`MANQUANT : ${src}`);
      }
    }

    // Vérification avec magick identify -verbose
    console.log('\n--- Vérification converted.png ---');
    let convOk = false;
    let alphaOk = false;
    let detectedCs = meta.icc_source || '?';
    let dpiCheck = '?';

    if (fs.existsSync(convertedSrc)) {
      try {
        const identify = execSync(`magick identify -verbose "${convertedSrc}"`, { stdio: 'pipe' }).toString();

        const colorspace = identify.match(/Colorspace:\s*(\S+)/);
        const type = identify.match(/Type:\s*(\S+)/);
        const depth = identify.match(/Depth:\s*(\S+)/);
        const channels = identify.match(/Channel depth:\n([\s\S]*?)(?=\n\S)/);
        const resolution = identify.match(/Resolution:\s*(\S+)/);
        const profileMatch = identify.match(/Profile-icc:\s*(\d+)\s*bytes/i);

        console.log(`  Colorspace : ${colorspace ? colorspace[1] : 'N/A'}`);
        console.log(`  Type       : ${type ? type[1] : 'N/A'}`);
        console.log(`  Depth      : ${depth ? depth[1] : 'N/A'}`);
        console.log(`  Resolution : ${resolution ? resolution[1] : 'N/A'}`);
        console.log(`  ICC Profile: ${profileMatch ? profileMatch[1] + ' bytes' : 'N/A'}`);

        // Résolution
        if (resolution) {
          dpiCheck = resolution[1];
        }

        // Profil eciRGB v2
        if (identify.includes('eciRGB') || identify.includes('ECI-RGB')) {
          console.log('  ✓ Profil eciRGB v2 DÉTECTÉ');
          convOk = true;
        } else {
          console.log('  ✗ Profil eciRGB v2 NON détecté');
        }

        // RGBA
        if (identify.includes('TrueColorAlpha') || (type && type[1].includes('Alpha'))) {
          console.log('  ✓ Canal alpha PRÉSENT (RGBA)');
          alphaOk = true;
        } else {
          console.log('  ✗ Canal alpha NON détecté');
        }

        // Nombre de canaux
        const channelCount = (identify.match(/Channel depth:/g) || []).length;
        // Compter les lignes sous Channel statistics
        const chanStats = identify.match(/Channel statistics:\n([\s\S]*?)Image statistics:/);
        if (chanStats) {
          const chanNames = chanStats[1].match(/^\s{4}\w+:/gm);
          if (chanNames) {
            console.log(`  Canaux     : ${chanNames.length} (${chanNames.map(c => c.trim().replace(':', '')).join(', ')})`);
          }
        }
      } catch (err) {
        console.error(`  Erreur identify: ${err.message}`);
      }
    }

    results.push({
      source: file,
      colorspace: detectedCs,
      dpi: meta.dpi_source,
      dimMm: `${meta.width_mm}x${meta.height_mm}`,
      conversion: convOk ? 'OK' : 'ÉCHOUÉE',
      alpha: alphaOk ? 'Oui' : 'Non',
    });
  }

  // Tableau récapitulatif
  console.log(`\n${'='.repeat(70)}`);
  console.log('TABLEAU RÉCAPITULATIF');
  console.log('='.repeat(70));
  console.log(
    'Source'.padEnd(16) +
    'Colorspace'.padEnd(30) +
    'DPI'.padEnd(6) +
    'Dim mm'.padEnd(16) +
    'Conv.'.padEnd(10) +
    'Alpha'
  );
  console.log('-'.repeat(70));
  for (const r of results) {
    console.log(
      r.source.padEnd(16) +
      r.colorspace.padEnd(30) +
      String(r.dpi).padEnd(6) +
      r.dimMm.padEnd(16) +
      r.conversion.padEnd(10) +
      r.alpha
    );
  }
  console.log('='.repeat(70));
  console.log('Fichiers dans controle_conversion/');
}

main().catch(err => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
