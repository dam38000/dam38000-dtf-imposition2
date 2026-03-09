const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = 'http://localhost:3000';
const CONTROL_DIR = path.join(__dirname, 'controle_conversion');

fs.mkdirSync(CONTROL_DIR, { recursive: true });

async function main() {
  const FormData = (await import('form-data')).default;
  const fetch = (await import('node-fetch')).default;

  // 1. Upload 2 fichiers
  console.log('=== UPLOAD DES FICHIERS ===');

  async function upload(filePath) {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    const res = await fetch(`${BASE}/api/upload`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Upload failed: ${await res.text()}`);
    return res.json();
  }

  const srgbMeta = await upload(path.join(__dirname, 'dessins', 'sRGB.png'));
  console.log(`sRGB.png → id: ${srgbMeta.id} (${srgbMeta.width_mm}×${srgbMeta.height_mm} mm)`);

  const fograMeta = await upload(path.join(__dirname, 'dessins', 'fogra39.pdf'));
  console.log(`fogra39.pdf → id: ${fograMeta.id} (${fograMeta.width_mm}×${fograMeta.height_mm} mm)`);

  // 2. Plan d'imposition : planche A2 (575×420mm)
  const plan = {
    sheet_size: { w: 575, h: 420 },
    items: [
      {
        file_id: srgbMeta.id,
        x: 10,
        y: 10,
        realW: srgbMeta.width_mm,
        realH: srgbMeta.height_mm,
        rotated: false,
      },
      {
        file_id: fograMeta.id,
        x: 10 + srgbMeta.width_mm + 20,
        y: 10,
        realW: fograMeta.height_mm,  // rotated: W et H inversés visuellement
        realH: fograMeta.width_mm,
        rotated: true,
      },
    ],
    margin: 5,
    mode: 'massicot',
  };

  console.log('\n=== PLAN D\'IMPOSITION ===');
  console.log(JSON.stringify(plan, null, 2));

  // 3. Appeler les 3 routes d'export
  const exports = [
    { route: '/api/export/dessin', filename: 'export_test_dessin.png' },
    { route: '/api/export/coupe', filename: 'export_test_coupe.pdf' },
    { route: '/api/export/composite', filename: 'export_test_composite.pdf' },
  ];

  for (const { route, filename } of exports) {
    console.log(`\n--- ${route} ---`);
    const res = await fetch(`${BASE}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plan),
    });

    if (!res.ok) {
      console.error(`ERREUR (${res.status}): ${await res.text()}`);
      continue;
    }

    const outPath = path.join(CONTROL_DIR, filename);
    const arrayBuf = await res.arrayBuffer();
    fs.writeFileSync(outPath, Buffer.from(arrayBuf));
    const size = fs.statSync(outPath).size;
    console.log(`Sauvegardé : ${filename} (${(size / 1024).toFixed(1)} KB)`);
  }

  // 4. Vérification du PNG dessin
  const dessinPath = path.join(CONTROL_DIR, 'export_test_dessin.png');
  if (fs.existsSync(dessinPath)) {
    console.log('\n=== VÉRIFICATION DESSIN PNG ===');
    try {
      const identify = execSync(`magick identify -verbose "${dessinPath}"`, { stdio: 'pipe' }).toString();

      const geometry = identify.match(/Geometry:\s*(\S+)/);
      const resolution = identify.match(/Resolution:\s*(\S+)/);
      const type = identify.match(/Type:\s*(\S+)/);
      const colorspace = identify.match(/Colorspace:\s*(\S+)/);
      const units = identify.match(/Units:\s*(\S+)/);

      console.log(`  Geometry   : ${geometry ? geometry[1] : 'N/A'}`);
      console.log(`  Resolution : ${resolution ? resolution[1] : 'N/A'}`);
      console.log(`  Units      : ${units ? units[1] : 'N/A'}`);
      console.log(`  Type       : ${type ? type[1] : 'N/A'}`);
      console.log(`  Colorspace : ${colorspace ? colorspace[1] : 'N/A'}`);

      // Vérifier 300 DPI
      const expectedW = Math.round(575 * 300 / 25.4);
      const expectedH = Math.round(420 * 300 / 25.4);
      console.log(`  Attendu    : ${expectedW}x${expectedH} @ 300 DPI`);

      if (geometry && geometry[1].startsWith(`${expectedW}x${expectedH}`)) {
        console.log('  ✓ Dimensions correctes');
      } else {
        console.log('  ✗ Dimensions incorrectes');
      }

      if (resolution && resolution[1].includes('118.11')) {
        console.log('  ✓ Résolution 300 DPI (118.11 px/cm)');
      } else if (resolution && resolution[1].includes('300')) {
        console.log('  ✓ Résolution 300 DPI');
      } else {
        console.log(`  ~ Résolution : ${resolution ? resolution[1] : 'N/A'}`);
      }
    } catch (err) {
      console.error(`  Erreur identify: ${err.message}`);
    }
  }

  // 5. Vérification des PDF
  for (const pdfFile of ['export_test_coupe.pdf', 'export_test_composite.pdf']) {
    const pdfPath = path.join(CONTROL_DIR, pdfFile);
    if (fs.existsSync(pdfPath)) {
      console.log(`\n=== VÉRIFICATION ${pdfFile} ===`);
      try {
        const identify = execSync(`magick identify "${pdfPath}" 2>&1`, { stdio: 'pipe' }).toString().trim();
        console.log(`  ${identify}`);
      } catch (err) {
        // jsPDF produit des PDF valides mais magick peut ne pas les identifier
        console.log(`  Taille : ${(fs.statSync(pdfPath).size / 1024).toFixed(1)} KB`);
      }
    }
  }

  console.log('\n=== TESTS TERMINÉS ===');
  console.log('Fichiers dans controle_conversion/');
}

main().catch(err => {
  console.error('Erreur fatale:', err);
  process.exit(1);
});
