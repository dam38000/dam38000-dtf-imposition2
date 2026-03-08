const fs = require('fs');
const path = require('path');
const http = require('http');

// Configuration
const SERVER_URL = 'http://localhost:3000';
const TEST_FILE = path.join(__dirname, 'dessins', 'sRGB.png');
const OUTPUT_DIR = path.join(__dirname, 'controle_conversion');

async function testUpload() {
  // Vérifier que le fichier de test existe
  if (!fs.existsSync(TEST_FILE)) {
    console.error(`ERREUR: Fichier de test introuvable : ${TEST_FILE}`);
    process.exit(1);
  }

  // Créer le dossier de sortie si nécessaire
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Envoi de ${path.basename(TEST_FILE)} vers POST ${SERVER_URL}/api/upload ...`);

  // Construire la requête multipart manuellement (sans dépendances externes)
  const fileBuffer = fs.readFileSync(TEST_FILE);
  const fileName = path.basename(TEST_FILE);
  const boundary = '----FormBoundary' + Date.now().toString(16);

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
      res.on('end', async () => {
        try {
          const result = JSON.parse(data);

          if (res.statusCode !== 200) {
            console.error(`ERREUR HTTP ${res.statusCode}:`, result);
            process.exit(1);
          }

          console.log('\n=== MÉTADONNÉES REÇUES ===');
          console.log(JSON.stringify(result, null, 2));

          // Copier les fichiers pour vérification visuelle
          const uploadDir = path.join(__dirname, 'uploads', result.id);

          const thumbSrc = path.join(uploadDir, 'thumbnail.png');
          const normSrc = path.join(uploadDir, 'normalized.png');

          const thumbDest = path.join(OUTPUT_DIR, 'upload_test_thumb_sRGB.png');
          const normDest = path.join(OUTPUT_DIR, 'upload_test_normalized_sRGB.png');

          if (fs.existsSync(thumbSrc)) {
            fs.copyFileSync(thumbSrc, thumbDest);
            console.log(`\nThumbnail copié  -> ${thumbDest}`);
          }
          if (fs.existsSync(normSrc)) {
            fs.copyFileSync(normSrc, normDest);
            console.log(`Normalized copié -> ${normDest}`);
          }

          // Vérification du canal alpha sur les fichiers générés
          try {
            const sharp = require('sharp');
            const normMeta = await sharp(normSrc).metadata();
            const thumbMeta = await sharp(thumbSrc).metadata();
            console.log('\n=== VÉRIFICATION ALPHA ===');
            console.log(`Original    hasAlpha: ${result.has_alpha}`);
            console.log(`Normalized  hasAlpha: ${normMeta.hasAlpha}  channels: ${normMeta.channels}  ${normMeta.width}x${normMeta.height}  density: ${normMeta.density}`);
            console.log(`Thumbnail   hasAlpha: ${thumbMeta.hasAlpha}  channels: ${thumbMeta.channels}  ${thumbMeta.width}x${thumbMeta.height}  density: ${thumbMeta.density}`);
          } catch (e) {
            console.log('(Sharp non disponible pour vérification alpha)');
          }

          console.log('\nTest terminé avec succès.');
          resolve(result);
        } catch (e) {
          console.error('Erreur parsing réponse:', e.message, '\nRéponse brute:', data);
          reject(e);
        }
      });
    });

    req.on('error', (err) => {
      console.error(`ERREUR: Impossible de contacter le serveur sur ${SERVER_URL}`);
      console.error('Assurez-vous que le serveur est démarré avec: node index.js');
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

testUpload().catch(() => process.exit(1));
