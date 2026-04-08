// Port fidèle de generateExpansionOverlay depuis montage PMTAvAmelVitesse.html (lignes 584-748)
// Détecte les finesses par ouverture morphologique et retourne un overlay vert

export function generateExpansionOverlay(imgSrc, openRadius = 2) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const w = img.width, h = img.height;
      const len = w * h;
      const OPEN_RADIUS = openRadius;
      const MIN_RADIUS = 2;

      // Récupérer les données originales
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const origImgData = ctx.getImageData(0, 0, w, h);
      const d = origImgData.data;

      // Alpha original
      const alpha = new Uint8Array(len);
      for (let i = 0; i < len; i++) alpha[i] = d[i * 4 + 3];

      // Étape 3 : Contracter (érosion de l'alpha) — noyau circulaire
      const eroded = new Uint8Array(len);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let minA = 255;
          for (let ky = -OPEN_RADIUS; ky <= OPEN_RADIUS && minA > 0; ky++) {
            for (let kx = -OPEN_RADIUS; kx <= OPEN_RADIUS && minA > 0; kx++) {
              if (kx * kx + ky * ky > OPEN_RADIUS * OPEN_RADIUS) continue;
              const iy = y + ky, ix = x + kx;
              if (ix < 0 || ix >= w || iy < 0 || iy >= h) { minA = 0; }
              else { const v = alpha[iy * w + ix]; if (v < minA) minA = v; }
            }
          }
          eroded[y * w + x] = minA;
        }
      }

      // Étape 4 : Dilater (dilatation de l'érodé = ouverture morphologique)
      const opened = new Uint8Array(len);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let maxA = 0;
          for (let ky = -OPEN_RADIUS; ky <= OPEN_RADIUS && maxA < 255; ky++) {
            for (let kx = -OPEN_RADIUS; kx <= OPEN_RADIUS && maxA < 255; kx++) {
              if (kx * kx + ky * ky > OPEN_RADIUS * OPEN_RADIUS) continue;
              const iy = y + ky, ix = x + kx;
              if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
                const v = eroded[iy * w + ix]; if (v > maxA) maxA = v;
              }
            }
          }
          opened[y * w + x] = maxA;
        }
      }

      // Étape 5 : Supprimer pixels sélectionnés (calque duplicata)
      const calque = ctx.getImageData(0, 0, w, h);
      const cd = calque.data;
      for (let i = 0; i < len; i++) {
        if (opened[i] > 0) {
          const idx = i * 4;
          cd[idx] = 0; cd[idx + 1] = 0; cd[idx + 2] = 0; cd[idx + 3] = 0;
        }
      }

      // Étape 6 : Filtre Minimum 2px sur RGB (aplatir sur blanc d'abord)
      const cFlat = document.createElement('canvas');
      cFlat.width = w; cFlat.height = h;
      const ctxFlat = cFlat.getContext('2d');
      ctxFlat.fillStyle = '#ffffff';
      ctxFlat.fillRect(0, 0, w, h);
      ctx.putImageData(calque, 0, 0);
      ctxFlat.drawImage(c, 0, 0);

      const flatData = ctxFlat.getImageData(0, 0, w, h);
      const fd = flatData.data;
      const outR = new Uint8Array(len), outG = new Uint8Array(len), outB = new Uint8Array(len);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let mR = 255, mG = 255, mB = 255;
          for (let ky = -MIN_RADIUS; ky <= MIN_RADIUS; ky++) {
            for (let kx = -MIN_RADIUS; kx <= MIN_RADIUS; kx++) {
              const iy = y + ky, ix = x + kx;
              if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
                const ni = (iy * w + ix) * 4;
                if (fd[ni]     < mR) mR = fd[ni];
                if (fd[ni + 1] < mG) mG = fd[ni + 1];
                if (fd[ni + 2] < mB) mB = fd[ni + 2];
              }
            }
          }
          const i = y * w + x;
          outR[i] = mR; outG[i] = mG; outB[i] = mB;
        }
      }
      for (let i = 0; i < len; i++) {
        const idx = i * 4;
        fd[idx] = outR[i]; fd[idx + 1] = outG[i]; fd[idx + 2] = outB[i];
      }

      // Récupérer l'alpha du calque traité et le dilater de MIN_RADIUS
      const calqueAlpha = new Uint8Array(len);
      for (let i = 0; i < len; i++) calqueAlpha[i] = cd[i * 4 + 3];
      const dilatedAlpha = new Uint8Array(len);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let maxA = 0;
          for (let ky = -MIN_RADIUS; ky <= MIN_RADIUS; ky++) {
            for (let kx = -MIN_RADIUS; kx <= MIN_RADIUS; kx++) {
              const iy = y + ky, ix = x + kx;
              if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
                const a = calqueAlpha[iy * w + ix];
                if (a > maxA) maxA = a;
              }
            }
          }
          dilatedAlpha[y * w + x] = maxA;
        }
      }
      // Appliquer alpha dilaté
      for (let i = 0; i < len; i++) fd[i * 4 + 3] = dilatedAlpha[i];
      ctxFlat.putImageData(flatData, 0, 0);

      // Étape 7-8 : Fusionner (original par-dessus le calque traité)
      ctxFlat.drawImage(img, 0, 0);

      // Générer l'overlay vert : pixels finesses (opaques dans l'original, disparus après ouverture)
      const finalData = ctxFlat.getImageData(0, 0, w, h).data;
      const cOut = document.createElement('canvas');
      cOut.width = w; cOut.height = h;
      const ctxOut = cOut.getContext('2d');
      const ovData = ctxOut.createImageData(w, h);
      const od = ovData.data;

      const rawMask = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        if (alpha[i] > 10 && opened[i] < 10) rawMask[i] = 1;
      }

      // Filtrer les pixels isolés : garder uniquement ceux ayant ≥3 voisins détectés
      let hasIssues = false;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (rawMask[y * w + x] !== 1) continue;
          let neighbors = 0;
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              if (kx === 0 && ky === 0) continue;
              const ny = y + ky, nx = x + kx;
              if (nx >= 0 && nx < w && ny >= 0 && ny < h && rawMask[ny * w + nx] === 1) neighbors++;
            }
          }
          if (neighbors >= 3) {
            const idx = (y * w + x) * 4;
            od[idx] = 0; od[idx + 1] = 255; od[idx + 2] = 0; od[idx + 3] = 200;
            hasIssues = true;
          }
        }
      }

      ctxOut.putImageData(ovData, 0, 0);
      resolve({ overlaySrc: cOut.toDataURL('image/png'), hasIssues });
    };
    img.src = imgSrc;
  });
}

// Port fidèle de applyFinesseATN depuis montage PMTAvAmelVitesse.html (lignes 752-882)
// Corrige les finesses en les élargissant automatiquement
export function applyFinesseATN(imgSrc, openRadius = 2) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const w = img.width, h = img.height;
      const len = w * h;
      const OPEN_RADIUS = openRadius;
      const MIN_RADIUS = 2;

      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const origImgData = ctx.getImageData(0, 0, w, h);
      const d = origImgData.data;

      // Alpha original
      const alpha = new Uint8Array(len);
      for (let i = 0; i < len; i++) alpha[i] = d[i * 4 + 3];

      // Contracter (érosion)
      const eroded = new Uint8Array(len);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let minA = 255;
          for (let ky = -OPEN_RADIUS; ky <= OPEN_RADIUS && minA > 0; ky++) {
            for (let kx = -OPEN_RADIUS; kx <= OPEN_RADIUS && minA > 0; kx++) {
              if (kx * kx + ky * ky > OPEN_RADIUS * OPEN_RADIUS) continue;
              const iy = y + ky, ix = x + kx;
              if (ix < 0 || ix >= w || iy < 0 || iy >= h) { minA = 0; }
              else { const v = alpha[iy * w + ix]; if (v < minA) minA = v; }
            }
          }
          eroded[y * w + x] = minA;
        }
      }

      // Dilater (ouverture morphologique)
      const opened = new Uint8Array(len);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let maxA = 0;
          for (let ky = -OPEN_RADIUS; ky <= OPEN_RADIUS && maxA < 255; ky++) {
            for (let kx = -OPEN_RADIUS; kx <= OPEN_RADIUS && maxA < 255; kx++) {
              if (kx * kx + ky * ky > OPEN_RADIUS * OPEN_RADIUS) continue;
              const iy = y + ky, ix = x + kx;
              if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
                const v = eroded[iy * w + ix]; if (v > maxA) maxA = v;
              }
            }
          }
          opened[y * w + x] = maxA;
        }
      }

      // Supprimer pixels où opened > 0
      const calque = ctx.getImageData(0, 0, w, h);
      const cd = calque.data;
      for (let i = 0; i < len; i++) {
        if (opened[i] > 0) {
          const idx = i * 4;
          cd[idx] = 0; cd[idx + 1] = 0; cd[idx + 2] = 0; cd[idx + 3] = 0;
        }
      }

      // Minimum sur RGB (aplatir sur blanc)
      const cFlat = document.createElement('canvas');
      cFlat.width = w; cFlat.height = h;
      const ctxFlat = cFlat.getContext('2d');
      ctxFlat.fillStyle = '#ffffff';
      ctxFlat.fillRect(0, 0, w, h);
      ctx.putImageData(calque, 0, 0);
      ctxFlat.drawImage(c, 0, 0);

      const flatData = ctxFlat.getImageData(0, 0, w, h);
      const fd = flatData.data;
      const outR = new Uint8Array(len), outG = new Uint8Array(len), outB = new Uint8Array(len);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let mR = 255, mG = 255, mB = 255;
          for (let ky = -MIN_RADIUS; ky <= MIN_RADIUS; ky++) {
            for (let kx = -MIN_RADIUS; kx <= MIN_RADIUS; kx++) {
              const iy = y + ky, ix = x + kx;
              if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
                const ni = (iy * w + ix) * 4;
                if (fd[ni]     < mR) mR = fd[ni];
                if (fd[ni + 1] < mG) mG = fd[ni + 1];
                if (fd[ni + 2] < mB) mB = fd[ni + 2];
              }
            }
          }
          const i = y * w + x;
          outR[i] = mR; outG[i] = mG; outB[i] = mB;
        }
      }
      for (let i = 0; i < len; i++) {
        const idx = i * 4;
        fd[idx] = outR[i]; fd[idx + 1] = outG[i]; fd[idx + 2] = outB[i];
      }

      // Dilater alpha du calque de MIN_RADIUS
      const calqueAlpha = new Uint8Array(len);
      for (let i = 0; i < len; i++) calqueAlpha[i] = cd[i * 4 + 3];
      const dilatedAlpha = new Uint8Array(len);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let maxA = 0;
          for (let ky = -MIN_RADIUS; ky <= MIN_RADIUS; ky++) {
            for (let kx = -MIN_RADIUS; kx <= MIN_RADIUS; kx++) {
              const iy = y + ky, ix = x + kx;
              if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
                const a = calqueAlpha[iy * w + ix];
                if (a > maxA) maxA = a;
              }
            }
          }
          dilatedAlpha[y * w + x] = maxA;
        }
      }
      for (let i = 0; i < len; i++) fd[i * 4 + 3] = dilatedAlpha[i];
      ctxFlat.putImageData(flatData, 0, 0);

      // Fusionner : original par-dessus
      ctxFlat.drawImage(img, 0, 0);

      resolve(ctxFlat.canvas.toDataURL('image/png'));
    };
    img.src = imgSrc;
  });
}

// Épaissit tous les contours de l'image de `thickness` pixels
// Equivalent du filtre Minimum de Photoshop : min(R,G,B) + max(A) sur les 4 canaux simultanément
export function generateExpandedImage(imgSrc, thickness = 5) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const w = img.width, h = img.height;
      const offsets = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]];

      // Lire les pixels de l'image originale
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, w, h);
      const d = imgData.data;

      // Filtre Minimum Photoshop : N itérations
      // Pour chaque pixel : min(R), min(G), min(B), max(A) parmi pixel + 8 voisins
      for (let step = 0; step < thickness; step++) {
        const prev = new Uint8Array(d.length);
        prev.set(d);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const ci = (y * w + x) * 4;
            let mR = prev[ci], mG = prev[ci + 1], mB = prev[ci + 2], mA = prev[ci + 3];
            for (const [dx, dy] of offsets) {
              const nx = x + dx, ny = y + dy;
              if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                const ni = (ny * w + nx) * 4;
                if (prev[ni]     < mR) mR = prev[ni];
                if (prev[ni + 1] < mG) mG = prev[ni + 1];
                if (prev[ni + 2] < mB) mB = prev[ni + 2];
                if (prev[ni + 3] > mA) mA = prev[ni + 3];
              }
            }
            d[ci] = mR; d[ci + 1] = mG; d[ci + 2] = mB; d[ci + 3] = mA;
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);

      // Superposer l'image originale par-dessus pour préserver les détails intérieurs
      ctx.drawImage(img, 0, 0);

      resolve(c.toDataURL('image/png'));
    };
    img.src = imgSrc;
  });
}
