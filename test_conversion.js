const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

// Configuration
const SERVER_URL = 'http://localhost:3000';
const TEST_FILE = path.join(__dirname, 'dessins', 'sRGB.png');
const OUTPUT_DIR = path.join(__dirname, 'controle_conversion');

async function testConversion() {
  if (!fs.existsSync(TEST_FILE)) {
    console.error(`ERREUR: Fichier de test introuvable : ${TEST_FILE}`);
    process.exit(1);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Envoi de ${path.basename(TEST_FILE)} vers POST ${SERVER_URL}/api/upload ...`);

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

          console.log('\n========================================');
          console.log('  MÉTADONNÉES REÇUES DU SERVEUR');
          console.log('========================================');
          console.log(JSON.stringify(result, null, 2));

          // Copier les fichiers pour vérification
          const uploadDir = path.join(__dirname, 'uploads', result.id);

          const files = {
            normalized: { src: 'normalized.png', dest: 'conv_test_normalized.png' },
            converted:  { src: 'converted.png',  dest: 'conv_test_converted.png' },
            thumbnail:  { src: 'thumbnail.png',  dest: 'conv_test_thumb.png' }
          };

          console.log('\n========================================');
          console.log('  COPIE DES FICHIERS');
          console.log('========================================');

          for (const [key, file] of Object.entries(files)) {
            const srcPath = path.join(uploadDir, file.src);
            const destPath = path.join(OUTPUT_DIR, file.dest);
            if (fs.existsSync(srcPath)) {
              fs.copyFileSync(srcPath, destPath);
              const stats = fs.statSync(destPath);
              console.log(`${key.padEnd(12)} -> ${file.dest} (${(stats.size / 1024).toFixed(1)} KB)`);
            } else {
              console.error(`MANQUANT: ${srcPath}`);
            }
          }

          // Vérification avec magick identify -verbose sur le converted
          const convertedCopy = path.join(OUTPUT_DIR, 'conv_test_converted.png');
          console.log('\n========================================');
          console.log('  VÉRIFICATION IMAGEMAGICK (converted)');
          console.log('========================================');

          try {
            const identify = execSync(`magick identify -verbose "${convertedCopy}"`, { encoding: 'utf8' });

            // Extraire les infos pertinentes
            const lines = identify.split('\n');
            const extract = (pattern) => {
              const line = lines.find(l => pattern.test(l));
              return line ? line.trim() : 'NON TROUVÉ';
            };

            console.log('Geometry:    ', extract(/^\s*Geometry:/));
            console.log('Type:        ', extract(/^\s*Type:/));
            console.log('Channels:    ', extract(/^\s*Channels:/));
            console.log('Resolution:  ', extract(/^\s*Resolution:/));

            // Profil ICC
            const iccLines = lines.filter(l => /icc:|Profile-icc/i.test(l));
            console.log('\nProfil ICC:');
            iccLines.forEach(l => console.log('  ', l.trim()));

            // Canal alpha
            const alphaDepth = lines.find(l => /Alpha:.*bit/.test(l));
            const colorType = lines.find(l => /png:IHDR\.color_type/.test(l));
            console.log('\nAlpha:');
            if (alphaDepth) console.log('  ', alphaDepth.trim());
            if (colorType) console.log('  ', colorType.trim());

          } catch (e) {
            console.error('Erreur magick identify:', e.message);
          }

          // Vérification supplémentaire avec Sharp
          console.log('\n========================================');
          console.log('  VÉRIFICATION SHARP (tous les fichiers)');
          console.log('========================================');

          try {
            const sharp = require('sharp');
            for (const [key, file] of Object.entries(files)) {
              const filePath = path.join(OUTPUT_DIR, file.dest);
              if (fs.existsSync(filePath)) {
                const meta = await sharp(filePath).metadata();
                console.log(`${key.padEnd(12)} ${meta.width}x${meta.height}  alpha:${meta.hasAlpha}  ch:${meta.channels}  density:${meta.density || '?'}`);
              }
            }
          } catch (e) {
            console.log('(Sharp non disponible pour vérification)');
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

testConversion().catch(() => process.exit(1));
