import { GuillotinePacker, MaxRectsPacker, PixelPacker } from './packers';
import { parseInput, createBitmapMask } from './bitmapUtils';

export async function launchImposition({ files, sheetSize, margin, impositionMode, activeTab }) {
  if (files.length === 0) return { sheets: [], stats: { totalSheets: 0, details: [] }, errors: [] };

  const currentMode = impositionMode;
  let allowRotation = true;
  let sortMode = 'area';
  switch (activeTab) {
    case 'grouped': sortMode = 'none'; break;
    case 'compact': sortMode = 'optimise'; break;
    case 'norotate': allowRotation = false; break;
    default: sortMode = 'area'; break;
  }

  const startTime = Date.now();
  const TIMEOUT_LIMIT = 30000;
  const safeMargin = (currentMode === 'imbrication') ? Math.max(4, parseInput(margin)) : parseInput(margin);
  const pageW = parseInput(sheetSize.w) || 100;
  const pageH = parseInput(sheetSize.h) || 100;
  const sheetArea = pageW * pageH;

  let totalItemArea = 0;
  let fileData = {};

  files.forEach(f => {
    const w = parseInput(f.width_mm);
    const h = parseInput(f.height_mm);
    const q = Math.abs(parseInt(f.quantity)) || 0;
    if (w > 0 && h > 0 && q > 0) {
      const area = (w + safeMargin * 2) * (h + safeMargin * 2);
      totalItemArea += area * q;
      fileData[f.id] = {
        ...f, wCalc: w + safeMargin * 2, hCalc: h + safeMargin * 2,
        req: q, area, realW: w, realH: h, src: f.thumbnailUrl
      };
    }
  });

  if (totalItemArea === 0) {
    return { sheets: [], stats: { totalSheets: 0, details: [] }, errors: ["Aucun fichier valide."] };
  }

  // MODE IMBRICATION
  if (currentMode === 'imbrication') {
    const IMB_SCALE = 0.4;
    const masksCache = {};
    const packerMarginPx = Math.ceil((safeMargin / 2) * IMB_SCALE);
    const packerPageW = Math.ceil(pageW * IMB_SCALE) + packerMarginPx * 2;
    const packerPageH = Math.ceil(pageH * IMB_SCALE) + packerMarginPx * 2;

    for (let fId in fileData) {
      if (Date.now() - startTime > TIMEOUT_LIMIT) {
        return { sheets: [], stats: { totalSheets: 0, details: [] }, errors: ["Calcul interrompu."] };
      }
      const file = fileData[fId];
      masksCache[fId] = await createBitmapMask(file.src, file.realW, file.realH, safeMargin / 2, IMB_SCALE);
    }

    let solved = false, bestResult = null;
    const rotateMaskFn = (mask) => {
      const g = new Uint8Array(mask.h * mask.w);
      for (let y = 0; y < mask.h; y++)
        for (let x = 0; x < mask.w; x++) {
          if (mask.grid[y * mask.w + x] === 1) {
            const nx = mask.h - 1 - y, ny = x;
            g[ny * mask.h + nx] = 1;
          }
        }
      return { w: mask.h, h: mask.w, margin: mask.margin, grid: g };
    };

    for (let currentRuns = 1; currentRuns < 501; currentRuns++) {
      if (Date.now() - startTime > TIMEOUT_LIMIT) {
        return { sheets: [], stats: { totalSheets: 0, details: [] }, errors: ["Calcul interrompu."] };
      }

      let currentSheetItems = [];
      let canAttempt = true;
      const filesToProcess = (sortMode === 'none') ? files : [...files];

      filesToProcess.forEach(f => {
        const file = fileData[f.id];
        if (!file) return;
        let targetPerSheet = Math.ceil(file.req / currentRuns);
        if (targetPerSheet < 1) targetPerSheet = 1;
        const m = masksCache[file.id];
        const fitsNormal = (m.w <= packerPageW && m.h <= packerPageH);
        const fitsRotated = allowRotation && (m.h <= packerPageW && m.w <= packerPageH);
        if (!fitsNormal && !fitsRotated) canAttempt = false;
        if (canAttempt) {
          for (let i = 0; i < targetPerSheet; i++) {
            currentSheetItems.push({
              fileId: file.id, src: file.src, mask: masksCache[file.id],
              w: file.realW, h: file.realH, realW: file.realW, realH: file.realH,
              uuid: Math.random()
            });
          }
        }
      });
      if (!canAttempt) break;

      let bestPackedImb = [];
      const isOptimiseImb = sortMode === 'optimise';
      const imbSortModes = isOptimiseImb ? ['area', 'width', 'none'] : [sortMode];
      const imbOrients = allowRotation ? [[false, false], [false, true], [true, false], [true, true]] : [[false, false]];

      outerImb: for (const sm of imbSortModes) {
        for (const [preRot, rot] of imbOrients) {
          const variant = preRot
            ? currentSheetItems.map(it => ({ ...it, w: it.h, h: it.w, realW: it.realH, realH: it.realW, mask: rotateMaskFn(it.mask), _prerotated: true }))
            : currentSheetItems.map(it => ({ ...it }));
          const p = new PixelPacker(packerPageW, packerPageH);
          const res = p.fit(variant, rot, sm);
          const fixedRes = res.map(it => it._prerotated ? { ...it, rotated: !it.rotated, realW: it.realH, realH: it.realW } : it);
          if (fixedRes.length > bestPackedImb.length) bestPackedImb = fixedRes;
          if (bestPackedImb.length === currentSheetItems.length) break outerImb;
        }
      }

      if (bestPackedImb.length === currentSheetItems.length) {
        solved = true;
        const rescaledItems = bestPackedImb.map(pi => ({
          ...pi, x: pi.x / IMB_SCALE - safeMargin / 2, y: pi.y / IMB_SCALE - safeMargin / 2
        }));
        bestResult = { items: rescaledItems, runs: currentRuns, efficiency: "N/A" };
        break;
      }
    }

    if (!solved || !bestResult) {
      return { sheets: [], stats: { totalSheets: 0, details: [] }, errors: ["Imbrication impossible."] };
    }

    const countsOnSheet = {};
    bestResult.items.forEach(item => { countsOnSheet[item.fileId] = (countsOnSheet[item.fileId] || 0) + 1; });
    const statsMap = {};
    Object.values(fileData).forEach(f => {
      const onSheet = countsOnSheet[f.id] || 0;
      statsMap[f.id] = { name: f.name, src: f.src, req: f.req, made: onSheet * bestResult.runs };
    });

    return {
      sheets: [{ id: 1, items: bestResult.items, copies: bestResult.runs, efficiency: bestResult.efficiency }],
      stats: {
        totalSheets: bestResult.runs, uniqueMontages: 1,
        details: Object.values(statsMap).map(s => ({ id: Math.random(), ...s })),
        detailsMap: statsMap
      },
      errors: []
    };
  }

  // MODES MASSICOT / IMBRIQUE
  let solved = false, bestResult = null;

  for (let currentRuns = 1; currentRuns < 1001; currentRuns++) {
    if (Date.now() - startTime > TIMEOUT_LIMIT) {
      return { sheets: [], stats: { totalSheets: 0, details: [] }, errors: ["Calcul interrompu."] };
    }

    let currentSheetItems = [];
    let canAttempt = true;

    files.forEach(f => {
      const file = fileData[f.id];
      if (!file) return;
      let targetPerSheet = Math.ceil(file.req / currentRuns);
      if (targetPerSheet < 1) targetPerSheet = 1;
      if (file.wCalc > pageW && file.wCalc > pageH) canAttempt = false;
      if (canAttempt) {
        for (let i = 0; i < targetPerSheet; i++) {
          currentSheetItems.push({
            fileId: file.id, src: file.src,
            w: file.wCalc, h: file.hCalc, realW: file.realW, realH: file.realH,
            uuid: Math.random()
          });
        }
      }
    });
    if (!canAttempt) break;

    let packedItems = [];
    const buildVariant = (items, preRotate) => preRotate
      ? items.map(it => ({ ...it, w: it.h, h: it.w, realW: it.realH, realH: it.realW, _prerotated: true }))
      : items.map(it => ({ ...it }));
    const fixRotated = (res) => res.map(it => it._prerotated ? { ...it, rotated: !it.rotated, realW: it.realH, realH: it.realW } : it);

    const isOptimise = sortMode === 'optimise';
    const sortModesToTry = isOptimise ? ['area', 'width', 'none'] : [sortMode];
    const packersToTry = isOptimise ? ['massicot', 'imbrique'] : [currentMode];
    const orientationsToTry = allowRotation ? [[false, false], [false, true], [true, false], [true, true]] : [[false, false]];

    let found = false;
    for (const sm of sortModesToTry) {
      for (const pm of packersToTry) {
        for (const [preRot, rot] of orientationsToTry) {
          if (!allowRotation && (preRot || rot)) continue;
          const variant = buildVariant(currentSheetItems, preRot);
          const isMassiMode = (currentMode === 'massicot' || currentMode === 'imbrique');
          const packW = isMassiMode ? pageW + safeMargin * 2 : pageW;
          const packH = isMassiMode ? pageH + safeMargin * 2 : pageH;
          let p = pm === 'massicot' ? new GuillotinePacker(packW, packH) : new MaxRectsPacker(packW, packH);
          let res = fixRotated(p.fit(variant.map(it => ({ ...it })), rot, sm));
          if (isMassiMode) res = res.map(it => ({ ...it, x: it.x - safeMargin, y: it.y - safeMargin }));
          if (res.length > packedItems.length) packedItems = res;
          if (packedItems.length === currentSheetItems.length) { found = true; break; }
        }
        if (found) break;
      }
      if (found) break;
    }

    if (packedItems.length === currentSheetItems.length) {
      solved = true;
      const usedArea = packedItems.reduce((acc, i) => acc + (i.w * i.h), 0);
      bestResult = { items: packedItems, runs: currentRuns, efficiency: (usedArea / sheetArea * 100).toFixed(1) };
      break;
    }
  }

  if (!solved || !bestResult) {
    return { sheets: [], stats: { totalSheets: 0, details: [] }, errors: ["Arrangement introuvable."] };
  }

  const countsOnSheet = {};
  bestResult.items.forEach(item => { countsOnSheet[item.fileId] = (countsOnSheet[item.fileId] || 0) + 1; });
  const statsMap = {};
  Object.values(fileData).forEach(f => {
    const onSheet = countsOnSheet[f.id] || 0;
    statsMap[f.id] = { name: f.name, src: f.src, req: f.req, made: onSheet * bestResult.runs };
  });

  return {
    sheets: [{ id: 1, items: bestResult.items, copies: bestResult.runs, efficiency: bestResult.efficiency }],
    stats: {
      totalSheets: bestResult.runs, uniqueMontages: 1,
      details: Object.values(statsMap).map(s => ({ id: Math.random(), ...s })),
      detailsMap: statsMap
    },
    errors: []
  };
}

export function fillPageWithImage({ files, sheetSize, margin, impositionMode, activeTab }) {
  if (files.length !== 1) return null;
  const file = files[0];
  const m = parseInput(margin);
  const pW = parseInput(sheetSize.w);
  const pH = parseInput(sheetSize.h);
  const iW = parseInput(file.width_mm) + m * 2;
  const iH = parseInput(file.height_mm) + m * 2;
  let q = Math.floor((pW * pH) / (iW * iH));
  if (q > 500) q = 500;
  while (q > 0) {
    const isMassiMode = (impositionMode === 'massicot' || impositionMode === 'imbrique');
    const packW = isMassiMode ? pW + m * 2 : pW;
    const packH = isMassiMode ? pH + m * 2 : pH;
    const packer = (impositionMode === 'massicot') ? new GuillotinePacker(packW, packH) : new MaxRectsPacker(packW, packH);
    const items = Array(q).fill(null).map(() => ({ w: iW, h: iH }));
    let sortModeSim = 'area';
    if (activeTab === 'compact') sortModeSim = 'optimise';
    if (activeTab === 'grouped') sortModeSim = 'none';
    if (packer.fit(items, activeTab !== 'norotate', sortModeSim).length === q) break;
    q--;
  }
  return q > 0 ? q : null;
}
