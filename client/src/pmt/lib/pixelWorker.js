// ============================================================
//  Web Worker pour PixelPacker — tourne dans un thread séparé
//  Ne bloque pas le thread principal, arrêt instantané via terminate()
// ============================================================

class PixelPacker {
  constructor(width, height) {
    this.width = Math.ceil(width);
    this.height = Math.ceil(height);
    this.sheet = new Uint8Array(this.width * this.height);
  }

  findBestPosition(mask) {
    const limitY = this.height - mask.h;
    const limitX = this.width - mask.w;
    if (limitX < 0 || limitY < 0) return null;
    for (let y = 0; y <= limitY; y++) {
      for (let x = 0; x <= limitX; x++) {
        if (!this.checkCollision(mask, x, y)) return { x, y };
      }
    }
    return null;
  }

  fit(items, allowRotation = true, sortMode = 'area') {
    let packedItems = [];
    if (sortMode === 'area') {
      items.sort((a, b) => (b.mask.w * b.mask.h) - (a.mask.w * a.mask.h));
    } else if (sortMode === 'width') {
      items.sort((a, b) => Math.max(b.mask.w, b.mask.h) - Math.max(a.mask.w, a.mask.h));
    }
    for (let item of items) {
      let bestPos = null;
      let chosenRotated = false;
      let chosenMask = item.mask;
      const posNormal = this.findBestPosition(item.mask);
      let posRotated = null;
      let rotatedMask = null;
      if (allowRotation) {
        rotatedMask = this.rotateMask(item.mask);
        posRotated = this.findBestPosition(rotatedMask);
      }
      if (posNormal && posRotated) {
        if (posRotated.y < posNormal.y || (posRotated.y === posNormal.y && posRotated.x < posNormal.x)) {
          bestPos = posRotated; chosenRotated = true; chosenMask = rotatedMask;
        } else {
          bestPos = posNormal; chosenRotated = false; chosenMask = item.mask;
        }
      } else if (posNormal) {
        bestPos = posNormal; chosenMask = item.mask; chosenRotated = false;
      } else if (posRotated) {
        bestPos = posRotated; chosenMask = rotatedMask; chosenRotated = true;
      }
      if (bestPos) {
        this.place(chosenMask, bestPos.x, bestPos.y);
        packedItems.push({
          fileId: item.fileId, src: item.src,
          x: bestPos.x + chosenMask.margin, y: bestPos.y + chosenMask.margin,
          w: chosenRotated ? item.h : item.w, h: chosenRotated ? item.w : item.h,
          realW: item.realW, realH: item.realH,
          rotated: chosenRotated,
          _prerotated: item._prerotated || false
        });
      }
    }
    return packedItems;
  }

  rotateMask(mask) {
    const newW = mask.h, newH = mask.w;
    const newGrid = new Uint8Array(newW * newH);
    for (let y = 0; y < mask.h; y++) {
      for (let x = 0; x < mask.w; x++) {
        if (mask.grid[y * mask.w + x] === 1) {
          const nx = mask.h - 1 - y, ny = x;
          if (nx >= 0 && nx < newW && ny >= 0 && ny < newH) {
            newGrid[ny * newW + nx] = 1;
          }
        }
      }
    }
    return { w: newW, h: newH, grid: newGrid, margin: mask.margin };
  }

  checkCollision(mask, x, y) {
    for (let my = 0; my < mask.h; my++) {
      const sheetYOffset = (y + my) * this.width;
      for (let mx = 0; mx < mask.w; mx++) {
        if (mask.grid[my * mask.w + mx] === 1) {
          if (this.sheet[sheetYOffset + (x + mx)] === 1) return true;
        }
      }
    }
    return false;
  }

  place(mask, x, y) {
    for (let my = 0; my < mask.h; my++) {
      const sheetYOffset = (y + my) * this.width;
      for (let mx = 0; mx < mask.w; mx++) {
        if (mask.grid[my * mask.w + mx] === 1) {
          this.sheet[sheetYOffset + (x + mx)] = 1;
        }
      }
    }
  }
}

// ── Réception des messages du thread principal ──
self.onmessage = function(e) {
  const { packerPageW, packerPageH, items, allowRotation, sortMode } = e.data;

  // Reconstruire les grids Uint8Array depuis les ArrayBuffers
  const rebuiltItems = items.map(it => ({
    ...it,
    mask: { w: it.mask.w, h: it.mask.h, margin: it.mask.margin, grid: new Uint8Array(it.mask.gridBuffer) }
  }));

  const packer = new PixelPacker(packerPageW, packerPageH);
  const result = packer.fit(rebuiltItems, allowRotation, sortMode);

  self.postMessage({ result });
};
