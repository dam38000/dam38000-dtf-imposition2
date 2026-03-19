/**
 * Détection des finesses et réserves par opérations morphologiques sur le canal alpha.
 * Port fidèle de processThinLines() depuis montage.html.
 */
export function processThinLines(imgSrc, finesse) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const w = img.width, h = img.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;

      // Extraction canal alpha
      const alphaChannel = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++)
        alphaChannel[i] = data[i * 4 + 3];

      const radius = Math.ceil(finesse / 2);

      // Erosion (minimum filter)
      const eroded = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let minA = 255;
          for (let ky = -radius; ky <= radius; ky++) {
            for (let kx = -radius; kx <= radius; kx++) {
              const iy = y + ky, ix = x + kx;
              if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
                const val = alphaChannel[iy * w + ix];
                if (val < minA) minA = val;
              } else minA = 0;
            }
          }
          eroded[y * w + x] = minA;
        }
      }

      // Dilation de l'eroded = Open (erode puis dilate)
      const dilated = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let maxA = 0;
          for (let ky = -radius; ky <= radius; ky++) {
            for (let kx = -radius; kx <= radius; kx++) {
              const iy = y + ky, ix = x + kx;
              if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
                const val = eroded[iy * w + ix];
                if (val > maxA) maxA = val;
              }
            }
          }
          dilated[y * w + x] = maxA;
        }
      }

      // Dilation de l'alpha original (pour détection réserves)
      const dilatedBase = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let maxA = 0;
          for (let ky = -radius; ky <= radius; ky++) {
            for (let kx = -radius; kx <= radius; kx++) {
              const iy = y + ky, ix = x + kx;
              if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
                const val = alphaChannel[iy * w + ix];
                if (val > maxA) maxA = val;
              }
            }
          }
          dilatedBase[y * w + x] = maxA;
        }
      }

      // Close = erode du dilatedBase
      const closed = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let minA = 255;
          for (let ky = -radius; ky <= radius; ky++) {
            for (let kx = -radius; kx <= radius; kx++) {
              const iy = y + ky, ix = x + kx;
              if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
                const val = dilatedBase[iy * w + ix];
                if (val < minA) minA = val;
              }
            }
          }
          closed[y * w + x] = minA;
        }
      }

      // Classification et génération des images résultat
      const finalImgData = ctx.createImageData(w, h);
      const pureImgData = ctx.createImageData(w, h);
      let defectCount = 0;

      for (let i = 0; i < w * h; i++) {
        const originalAlpha = alphaChannel[i];
        const processedAlpha = dilated[i];
        const closedAlpha = closed[i];
        const idx = i * 4;

        const isThinLine = (originalAlpha > 100 && processedAlpha < 50);
        const isThinGap = (originalAlpha < 50 && closedAlpha > 100);

        if (isThinLine) {
          defectCount++;
          // Magenta
          finalImgData.data[idx] = 255;
          finalImgData.data[idx + 1] = 0;
          finalImgData.data[idx + 2] = 255;
          finalImgData.data[idx + 3] = 255;
          pureImgData.data[idx] = 255;
          pureImgData.data[idx + 1] = 0;
          pureImgData.data[idx + 2] = 255;
          pureImgData.data[idx + 3] = 255;
        } else if (isThinGap) {
          defectCount++;
          // Vert
          finalImgData.data[idx] = 0;
          finalImgData.data[idx + 1] = 255;
          finalImgData.data[idx + 2] = 0;
          finalImgData.data[idx + 3] = 255;
          pureImgData.data[idx] = 0;
          pureImgData.data[idx + 1] = 255;
          pureImgData.data[idx + 2] = 0;
          pureImgData.data[idx + 3] = 255;
        } else if (originalAlpha > 0) {
          // Image originale à 40% opacité dans l'overlay
          finalImgData.data[idx] = data[idx];
          finalImgData.data[idx + 1] = data[idx + 1];
          finalImgData.data[idx + 2] = data[idx + 2];
          finalImgData.data[idx + 3] = Math.floor(originalAlpha * 0.4);
          pureImgData.data[idx + 3] = 0;
        } else {
          finalImgData.data[idx + 3] = 0;
          pureImgData.data[idx + 3] = 0;
        }
      }

      if (defectCount > 0) {
        ctx.putImageData(finalImgData, 0, 0);
        const defectsSrc = canvas.toDataURL();
        const pureCanvas = document.createElement('canvas');
        pureCanvas.width = w;
        pureCanvas.height = h;
        pureCanvas.getContext('2d').putImageData(pureImgData, 0, 0);
        const pureDefectsSrc = pureCanvas.toDataURL();
        resolve({ hasIssues: true, defectsSrc, pureDefectsSrc });
      } else {
        resolve({ hasIssues: false, defectsSrc: null, pureDefectsSrc: null });
      }
    };
    img.onerror = () => resolve({ hasIssues: false, defectsSrc: null, pureDefectsSrc: null });
    img.src = imgSrc;
  });
}

// Helpers morphologiques réutilisés par les corrections
function erode(src, w, h, radius) {
  const dst = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let minA = 255;
      for (let ky = -radius; ky <= radius; ky++) {
        for (let kx = -radius; kx <= radius; kx++) {
          const iy = y + ky, ix = x + kx;
          if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
            const val = src[iy * w + ix];
            if (val < minA) minA = val;
          } else minA = 0;
        }
      }
      dst[y * w + x] = minA;
    }
  }
  return dst;
}

function dilate(src, w, h, radius) {
  const dst = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let maxA = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        for (let kx = -radius; kx <= radius; kx++) {
          const iy = y + ky, ix = x + kx;
          if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
            const val = src[iy * w + ix];
            if (val > maxA) maxA = val;
          }
        }
      }
      dst[y * w + x] = maxA;
    }
  }
  return dst;
}

function gaussianBlurAlpha(alpha, w, h, sigma) {
  const kernelSize = Math.ceil(sigma * 3) * 2 + 1;
  const half = Math.floor(kernelSize / 2);
  const kernel = new Float32Array(kernelSize);
  let sum = 0;
  for (let i = 0; i < kernelSize; i++) {
    const x = i - half;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  for (let i = 0; i < kernelSize; i++) kernel[i] /= sum;

  // Horizontal pass
  const temp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let val = 0;
      for (let k = -half; k <= half; k++) {
        const ix = Math.min(Math.max(x + k, 0), w - 1);
        val += alpha[y * w + ix] * kernel[k + half];
      }
      temp[y * w + x] = val;
    }
  }
  // Vertical pass
  const result = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let val = 0;
      for (let k = -half; k <= half; k++) {
        const iy = Math.min(Math.max(y + k, 0), h - 1);
        val += temp[iy * w + x] * kernel[k + half];
      }
      result[y * w + x] = val;
    }
  }
  return result;
}

/**
 * Correction des finesses : épaissit les lignes fines de +2px avec interpolation couleur.
 * Port fidèle de correctImageFinesse() depuis montage.html.
 */
export function correctImageFinesse(imgSrc, finesse) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const w = img.width, h = img.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;
      const alphaChannel = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) alphaChannel[i] = data[i * 4 + 3];

      const radius = Math.ceil(finesse / 2);
      const eroded = erode(alphaChannel, w, h, radius);
      const opened = dilate(eroded, w, h, radius);
      const dilatedBase = dilate(alphaChannel, w, h, radius);
      const closed = erode(dilatedBase, w, h, radius);

      const correctedAlpha = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) correctedAlpha[i] = alphaChannel[i];

      const addedR = new Float32Array(w * h);
      const addedG = new Float32Array(w * h);
      const addedB = new Float32Array(w * h);

      for (let i = 0; i < w * h; i++) {
        if (alphaChannel[i] > 100 && opened[i] < 50) {
          const cy = Math.floor(i / w), cx = i % w;
          const TARGET_R = 3;
          for (let dy = -TARGET_R; dy <= TARGET_R; dy++) {
            for (let dx = -TARGET_R; dx <= TARGET_R; dx++) {
              if (dx * dx + dy * dy > TARGET_R * TARGET_R) continue;
              const ny = cy + dy, nx = cx + dx;
              if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                const nPos = ny * w + nx;
                const isProtectedReserve = (alphaChannel[nPos] < 50 && closed[nPos] > 100);
                if (!isProtectedReserve && correctedAlpha[nPos] < 128) {
                  let sumW = 0, sumR = 0, sumG = 0, sumB = 0;
                  const SEARCH_R = TARGET_R + 2;
                  for (let ey = -SEARCH_R; ey <= SEARCH_R; ey++) {
                    for (let ex = -SEARCH_R; ex <= SEARCH_R; ex++) {
                      const oy = ny + ey, ox = nx + ex;
                      if (ox >= 0 && ox < w && oy >= 0 && oy < h) {
                        const oPos = oy * w + ox;
                        if (alphaChannel[oPos] > 128) {
                          const dist = Math.sqrt(ex * ex + ey * ey) + 0.01;
                          const wi = 1.0 / dist;
                          sumW += wi;
                          sumR += data[oPos * 4] * wi;
                          sumG += data[oPos * 4 + 1] * wi;
                          sumB += data[oPos * 4 + 2] * wi;
                        }
                      }
                    }
                  }
                  if (sumW > 0) {
                    addedR[nPos] = sumR / sumW;
                    addedG[nPos] = sumG / sumW;
                    addedB[nPos] = sumB / sumW;
                  } else {
                    addedR[nPos] = data[i * 4];
                    addedG[nPos] = data[i * 4 + 1];
                    addedB[nPos] = data[i * 4 + 2];
                  }
                  correctedAlpha[nPos] = 255;
                }
              }
            }
          }
        }
      }

      const sigma = Math.max(1.2, finesse * 0.5);
      const blurredFull = gaussianBlurAlpha(correctedAlpha, w, h, sigma);

      const outputData = ctx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const origA = alphaChannel[i];
        const corrA = correctedAlpha[i];
        const idx = i * 4;
        if (corrA > origA) {
          outputData.data[idx] = Math.round(addedR[i]);
          outputData.data[idx + 1] = Math.round(addedG[i]);
          outputData.data[idx + 2] = Math.round(addedB[i]);
          outputData.data[idx + 3] = Math.round(Math.max(origA, blurredFull[i]));
        } else {
          outputData.data[idx] = data[idx];
          outputData.data[idx + 1] = data[idx + 1];
          outputData.data[idx + 2] = data[idx + 2];
          outputData.data[idx + 3] = origA;
        }
      }

      ctx.putImageData(outputData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = imgSrc;
  });
}

/**
 * Correction des réserves : élargit les trous fins en supprimant l'alpha adjacent.
 * Port fidèle de correctImageReserves() depuis montage.html.
 */
export function correctImageReserves(imgSrc, finesse) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const w = img.width, h = img.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;
      const outputData = ctx.createImageData(w, h);
      outputData.data.set(data);

      const alphaChannel = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) alphaChannel[i] = data[i * 4 + 3];

      const radius = Math.ceil(finesse / 2);
      const eroded = erode(alphaChannel, w, h, radius);
      const opened = dilate(eroded, w, h, radius);
      const dilatedBase = dilate(alphaChannel, w, h, radius);
      const closed = erode(dilatedBase, w, h, radius);

      // Identifier lignes protégées et réserves cibles
      const isProtected = new Uint8Array(w * h);
      const isTargetReserve = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        if (alphaChannel[i] > 100 && opened[i] < 50) isProtected[i] = 1;
        if (alphaChannel[i] < 50 && closed[i] > 100) isTargetReserve[i] = 1;
      }

      // Élargir les réserves en supprimant l'alpha des pixels voisins
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          if (alphaChannel[i] > 100 && isProtected[i] !== 1) {
            const RES_R = 3;
            let isNeighborOfReserve = false;
            outer: for (let dy = -RES_R; dy <= RES_R; dy++) {
              for (let dx = -RES_R; dx <= RES_R; dx++) {
                if (dx === 0 && dy === 0) continue;
                if (dx * dx + dy * dy > RES_R * RES_R) continue;
                const ny = y + dy, nx = x + dx;
                if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                  if (isTargetReserve[ny * w + nx] === 1) {
                    isNeighborOfReserve = true;
                    break outer;
                  }
                }
              }
            }
            if (isNeighborOfReserve) {
              outputData.data[i * 4 + 3] = 0;
            }
          }
        }
      }

      ctx.putImageData(outputData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = imgSrc;
  });
}
