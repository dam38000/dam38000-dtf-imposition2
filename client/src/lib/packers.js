export class GuillotinePacker {
  constructor(width, height, splitMode = 'auto') {
    this.width = width;
    this.height = height;
    this.splitMode = splitMode; // 'auto', 'horizontal', 'vertical'
    this.freeRectangles = [{ x: 0, y: 0, w: width, h: height }];
  }

  fit(items, allowRotation = true, sortMode = 'area') {
    let packedItems = [];
    if (sortMode === 'area') {
      items.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    } else if (sortMode === 'width') {
      items.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
    }
    items.forEach(item => {
      const normal = this.findBestScore(item.w, item.h);
      const rotated = allowRotation ? this.findBestScore(item.h, item.w) : { index: -1, area: Infinity, short: Infinity };
      let bestNodeIndex = -1;
      let isRotated = false;
      if (normal.index !== -1 && rotated.index !== -1) {
        if (rotated.area < normal.area) { isRotated = true; bestNodeIndex = rotated.index; }
        else { isRotated = false; bestNodeIndex = normal.index; }
      } else if (normal.index !== -1) { bestNodeIndex = normal.index; isRotated = false; }
      else if (rotated.index !== -1) { bestNodeIndex = rotated.index; isRotated = true; }

      if (bestNodeIndex !== -1) {
        const node = this.freeRectangles[bestNodeIndex];
        const w = isRotated ? item.h : item.w;
        const h = isRotated ? item.w : item.h;
        packedItems.push({ ...item, x: node.x, y: node.y, w, h, rotated: isRotated });
        this.splitNode(bestNodeIndex, w, h);
      } else {
        item.packed = false;
      }
    });
    return packedItems;
  }

  findBestScore(w, h) {
    let bestArea = Number.MAX_VALUE;
    let bestShort = Number.MAX_VALUE;
    let bestIndex = -1;
    for (let i = 0; i < this.freeRectangles.length; i++) {
      const rect = this.freeRectangles[i];
      if (w <= rect.w + 0.1 && h <= rect.h + 0.1) {
        const leftoverArea = (rect.w * rect.h) - (w * h);
        const shortFit = Math.min(Math.abs(rect.w - w), Math.abs(rect.h - h));
        if (leftoverArea < bestArea || (Math.abs(leftoverArea - bestArea) < 0.1 && shortFit < bestShort)) {
          bestArea = leftoverArea; bestShort = shortFit; bestIndex = i;
        }
      }
    }
    return { index: bestIndex, area: bestArea, short: bestShort };
  }

  splitNode(nodeIndex, w, h) {
    const node = this.freeRectangles[nodeIndex];
    this.freeRectangles.splice(nodeIndex, 1);
    const preferHorizontalSplit = this.splitMode === 'horizontal' ? true : this.splitMode === 'vertical' ? false : (this.width >= this.height);
    if (preferHorizontalSplit) {
      if (node.h - h > 0.5) this.freeRectangles.push({ x: node.x, y: node.y + h, w: node.w, h: node.h - h });
      if (node.w - w > 0.5) this.freeRectangles.push({ x: node.x + w, y: node.y, w: node.w - w, h: h });
    } else {
      if (node.w - w > 0.5) this.freeRectangles.push({ x: node.x + w, y: node.y, w: node.w - w, h: node.h });
      if (node.h - h > 0.5) this.freeRectangles.push({ x: node.x, y: node.y + h, w: w, h: node.h - h });
    }
  }
}

export class MaxRectsPacker {
  constructor(width, height, heuristic = 'bssf') {
    this.width = width;
    this.height = height;
    this.heuristic = heuristic; // 'bssf' (Best Short Side Fit), 'blsf' (Best Long Side Fit), 'baf' (Best Area Fit)
    this.freeRectangles = [{ x: 0, y: 0, w: width, h: height }];
  }

  fit(items, allowRotation = true, sortMode = 'area') {
    let packedItems = [];
    if (sortMode === 'area') {
      items.sort((a, b) => (b.w * b.h) - (a.w * a.h));
    } else if (sortMode === 'width') {
      items.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
    }
    items.forEach(item => {
      let newNode = this.findNode(item.w, item.h, allowRotation);
      if (newNode.bestNode) {
        const { x, y } = newNode.bestNode;
        const w = newNode.rotated ? item.h : item.w;
        const h = newNode.rotated ? item.w : item.h;
        packedItems.push({ ...item, x, y, w, h, rotated: newNode.rotated });
        this.placeRect(x, y, w, h);
      } else {
        item.packed = false;
      }
    });
    return packedItems;
  }

  findNode(w, h, allowRotation) {
    let bestNode = null;
    let bestScore1 = Number.MAX_VALUE;
    let bestScore2 = Number.MAX_VALUE;
    let rotated = false;
    const heuristic = this.heuristic;
    const tryFit = (rect, width, height, isRotated) => {
      if (rect.w >= width && rect.h >= height) {
        let score1, score2;
        if (heuristic === 'blsf') {
          score1 = Math.max(Math.abs(rect.w - width), Math.abs(rect.h - height));
          score2 = Math.min(Math.abs(rect.w - width), Math.abs(rect.h - height));
        } else if (heuristic === 'baf') {
          score1 = (rect.w * rect.h) - (width * height);
          score2 = Math.min(Math.abs(rect.w - width), Math.abs(rect.h - height));
        } else { // bssf
          score1 = Math.min(Math.abs(rect.w - width), Math.abs(rect.h - height));
          score2 = Math.max(Math.abs(rect.w - width), Math.abs(rect.h - height));
        }
        const better = score1 < bestScore1 || (score1 === bestScore1 && score2 < bestScore2);
        let sameBetterPos = false;
        if (score1 === bestScore1 && score2 === bestScore2) {
          if (!bestNode || rect.y < bestNode.y || (rect.y === bestNode.y && rect.x < bestNode.x)) {
            sameBetterPos = true;
          }
        }
        if (better || sameBetterPos) {
          bestNode = { x: rect.x, y: rect.y, w: width, h: height };
          bestScore1 = score1; bestScore2 = score2; rotated = isRotated;
        }
      }
    };
    for (let i = 0; i < this.freeRectangles.length; i++) {
      tryFit(this.freeRectangles[i], w, h, false);
      if (allowRotation) tryFit(this.freeRectangles[i], h, w, true);
    }
    return { bestNode, rotated };
  }

  placeRect(x, y, w, h) {
    const rect = { x, y, w, h };
    let i = 0;
    while (i < this.freeRectangles.length) {
      if (this.isIntersecting(this.freeRectangles[i], rect)) {
        const free = this.freeRectangles[i];
        if (free.x < rect.x + rect.w && free.x + free.w > rect.x) {
          if (free.y < rect.y && free.y + free.h > rect.y)
            this.freeRectangles.push({ x: free.x, y: free.y, w: free.w, h: rect.y - free.y });
          if (free.y < rect.y + rect.h && free.y + free.h > rect.y + rect.h)
            this.freeRectangles.push({ x: free.x, y: rect.y + rect.h, w: free.w, h: free.y + free.h - (rect.y + rect.h) });
        }
        if (free.y < rect.y + rect.h && free.y + free.h > rect.y) {
          if (free.x < rect.x && free.x + free.w > rect.x)
            this.freeRectangles.push({ x: free.x, y: free.y, w: rect.x - free.x, h: free.h });
          if (free.x < rect.x + rect.w && free.x + free.w > rect.x + rect.w)
            this.freeRectangles.push({ x: rect.x + rect.w, y: free.y, w: free.x + free.w - (rect.x + rect.w), h: free.h });
        }
        this.freeRectangles.splice(i, 1);
      } else i++;
    }
    for (let j = 0; j < this.freeRectangles.length; j++) {
      for (let k = j + 1; k < this.freeRectangles.length; k++) {
        if (this.isContained(this.freeRectangles[k], this.freeRectangles[j])) {
          this.freeRectangles.splice(k, 1); k--;
        } else if (this.isContained(this.freeRectangles[j], this.freeRectangles[k])) {
          this.freeRectangles.splice(j, 1); j--; break;
        }
      }
    }
  }

  isIntersecting(r1, r2) {
    return r1.x < r2.x + r2.w && r1.x + r1.w > r2.x && r1.y < r2.y + r2.h && r1.y + r1.h > r2.y;
  }

  isContained(a, b) {
    return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
  }
}

export class PixelPacker {
  constructor(width, height, stopRef) {
    this.width = Math.ceil(width);
    this.height = Math.ceil(height);
    this.sheet = new Uint8Array(this.width * this.height);
    this.stopRef = stopRef || null;
    this.stopped = false;
  }

  async findBestPosition(mask) {
    const limitY = this.height - mask.h;
    const limitX = this.width - mask.w;
    if (limitX < 0 || limitY < 0) return null;
    for (let y = 0; y <= limitY; y++) {
      if (this.stopRef && this.stopRef.current) { this.stopped = true; return null; }
      // Yield toutes les 20 lignes pour laisser le thread respirer
      if (y > 0 && y % 20 === 0) await new Promise(r => setTimeout(r, 0));
      for (let x = 0; x <= limitX; x++) {
        if (!this.checkCollision(mask, x, y)) return { x, y };
      }
    }
    return null;
  }

  async fit(items, allowRotation = true, sortMode = 'area') {
    let packedItems = [];
    this.stopped = false;
    if (sortMode === 'area') {
      items.sort((a, b) => (b.mask.w * b.mask.h) - (a.mask.w * a.mask.h));
    } else if (sortMode === 'width') {
      items.sort((a, b) => Math.max(b.mask.w, b.mask.h) - Math.max(a.mask.w, a.mask.h));
    }
    for (let item of items) {
      if (this.stopRef && this.stopRef.current) { this.stopped = true; break; }
      let bestPos = null;
      let chosenRotated = false;
      let chosenMask = item.mask;
      const posNormal = await this.findBestPosition(item.mask);
      if (this.stopped) break;
      let posRotated = null;
      let rotatedMask = null;
      if (allowRotation) {
        rotatedMask = this.rotateMask(item.mask);
        posRotated = await this.findBestPosition(rotatedMask);
        if (this.stopped) break;
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
          ...item, x: bestPos.x + chosenMask.margin, y: bestPos.y + chosenMask.margin,
          w: chosenRotated ? item.h : item.w, h: chosenRotated ? item.w : item.h,
          rotated: chosenRotated, mask: chosenMask
        });
      } else {
        item.packed = false;
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
    return { ...mask, w: newW, h: newH, grid: newGrid, margin: mask.margin };
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
