const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE_URL = 'http://localhost:3000/api/upload';
const DESSINS_DIR = path.join(__dirname, 'dessins');
const CONTROL_DIR = path.join(__dirname, 'controle_conversion');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Créer le dossier de contrôle
fs.mkdirSync(CONTROL_DIR, { recursive: true });

const testFiles = [
  { file: 'fogra39.pdf', prefix: 'fogra39_pdf' },
  { file: 'sRGB.pdf', prefix: 'sRGB_pdf' },
];

async function uploadFile(filePath) {
  const FormData = (await import('form-data')).default;
  const fetch = (await import('node-fetch')).default;

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));

  const res = await fetch(BASE_URL, { method: 'POST', body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function main() {
  // Dynamic imports
  const FormData = (await import('form-data')).default;
  const fetch = (await import('node-fetch')).default;

  for (const { file, prefix } of testFiles) {
    const filePath = path.join(DESSINS_DIR, file);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST : ${file}`);
    console.log('='.repeat(60));

    // Upload
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    const res = await fetch(BASE_URL, { method: 'POST', body: form });
    if (!res.ok) {
      const text = await res.text();
      console.error(`ERREUR upload (${res.status}): ${text}`);
      continue;
    }
    const meta = await res.json();

    console.log('\n--- Métadonnées reçues ---');
    console.log(JSON.stringify(meta, null, 2));

    const jobDir = path.join(UPLOADS_DIR, meta.id);

    // Copier les fichiers dans controle_conversion/
    const originalExt = 'pdf';
    const originalSrc = path.join(jobDir, `original.${originalExt}`);
    const convertedSrc = path.join(jobDir, 'converted.png');
    const thumbSrc = path.join(jobDir, 'thumbnail.png');

    const copies = [
      { src: originalSrc, dst: path.join(CONTROL_DIR, `${prefix}_01_original.pdf`) },
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

    // Vérification avec magick identify
    console.log('\n--- Vérification converted.png ---');
    if (fs.existsSync(convertedSrc)) {
      try {
        const identify = execSync(`magick identify -verbose "${convertedSrc}"`, { stdio: 'pipe' }).toString();

        // Extraire les infos clés
        const colorspace = identify.match(/Colorspace:\s*(\S+)/);
        const type = identify.match(/Type:\s*(\S+)/);
        const depth = identify.match(/Depth:\s*(\S+)/);
        const profileMatch = identify.match(/icc:profile:\s*(.*)/i) || identify.match(/Profile-icc:\s*(\d+)\s*bytes/i);
        const iccDesc = identify.match(/description:\s*(.*)/i);

        console.log(`  Colorspace : ${colorspace ? colorspace[1] : 'N/A'}`);
        console.log(`  Type       : ${type ? type[1] : 'N/A'}`);
        console.log(`  Depth      : ${depth ? depth[1] : 'N/A'}`);
        console.log(`  ICC Profile: ${profileMatch ? profileMatch[1] : 'N/A'}`);

        // Vérifier le profil eciRGB v2
        if (identify.includes('eciRGB') || identify.includes('ECI-RGB')) {
          console.log('  ✓ Profil eciRGB v2 DÉTECTÉ');
        } else {
          console.log('  ✗ Profil eciRGB v2 NON détecté');
        }

        // Vérifier RGBA (alpha)
        if (identify.includes('TrueColorAlpha') || identify.includes('sRGBA') || (type && type[1].includes('Alpha'))) {
          console.log('  ✓ Canal alpha PRÉSENT (RGBA)');
        } else {
          console.log('  ✗ Canal alpha NON détecté');
        }
      } catch (err) {
        console.error(`  Erreur identify: ${err.message}`);
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log('Tests terminés. Fichiers dans controle_conversion/');
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
