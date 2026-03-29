import { GuillotinePacker, MaxRectsPacker } from './packers';
import { parseInput, createBitmapMask } from './bitmapUtils';
import PixelWorkerUrl from './pixelWorker.js?url';

// ── Exécuter PixelPacker dans un Web Worker ──
let activeWorker = null;
function runPixelWorkerPack({ packerPageW, packerPageH, items, allowRotation, sortMode }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(PixelWorkerUrl);
    activeWorker = worker;
    // Préparer les items avec gridBuffer (transférable) — conserver _prerotated
    const workerItems = items.map(it => ({
      fileId: it.fileId, src: it.src,
      w: it.w, h: it.h, realW: it.realW, realH: it.realH,
      _prerotated: it._prerotated || false,
      mask: { w: it.mask.w, h: it.mask.h, margin: it.mask.margin, gridBuffer: it.mask.grid.buffer.slice(0) }
    }));
    worker.onmessage = (e) => { activeWorker = null; worker.terminate(); resolve(e.data.result); };
    worker.onerror = (err) => { activeWorker = null; worker.terminate(); reject(err); };
    worker.postMessage({ packerPageW, packerPageH, items: workerItems, allowRotation, sortMode });
  });
}
export function terminatePixelWorker() {
  if (activeWorker) { activeWorker.terminate(); activeWorker = null; }
}

export async function launchImposition({ files, sheetSize, margin, impositionMode, activeTab, stopRef, onAskMoreVariants, onFirstResult, onProgress }) {
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
  const TIMEOUT_LIMIT = 120000; // 2 minutes max
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
    const IMB_SCALE = 0.5;
    const masksCache = {};
    const packerMarginPx = Math.ceil((safeMargin / 2) * IMB_SCALE);
    const packerPageW = Math.ceil(pageW * IMB_SCALE) + packerMarginPx * 2;
    const packerPageH = Math.ceil(pageH * IMB_SCALE) + packerMarginPx * 2;

    console.log(`[imbrication] START — ${Object.keys(fileData).length} fichiers, planche ${pageW}x${pageH}mm, scale=${IMB_SCALE}`);
    console.log(`[imbrication] packerPage: ${packerPageW}x${packerPageH}px, marge=${safeMargin}mm, rotation=${allowRotation}`);

    for (let fId in fileData) {
      if (stopRef && stopRef.current) {
        return { sheets: [], stats: { totalSheets: 0, details: [] }, errors: ["Calcul interrompu."] };
      }
      const file = fileData[fId];
      const t0 = performance.now();
      masksCache[fId] = await createBitmapMask(file.src, file.realW, file.realH, safeMargin / 2, IMB_SCALE);
      const m = masksCache[fId];
      console.log(`[imbrication] mask ${file.name || fId}: ${m.w}x${m.h}px (${(performance.now()-t0).toFixed(0)}ms)`);
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

    const totalPieces = Object.values(fileData).reduce((s, f) => s + f.req, 0);
    console.log(`[imbrication] total pieces a placer: ${totalPieces}`);

    // Test rapide : essayer de placer 1 exemplaire de chaque fichier (run = totalPieces)
    // Si même ça ne passe pas → impossible
    const quickTestItems = [];
    let quickTestOk = true;
    for (const fId in fileData) {
      const m = masksCache[fId];
      const fitsNormal = (m.w <= packerPageW && m.h <= packerPageH);
      const fitsRotated = allowRotation && (m.h <= packerPageW && m.w <= packerPageH);
      if (!fitsNormal && !fitsRotated) {
        console.log(`[imbrication] ABANDON: image ${fileData[fId].name || fId} (${m.w}x${m.h}px) ne rentre pas dans la planche (${packerPageW}x${packerPageH}px)`);
        quickTestOk = false;
        break;
      }
      quickTestItems.push({
        fileId: fId, src: fileData[fId].src, mask: m,
        w: fileData[fId].realW, h: fileData[fId].realH,
        realW: fileData[fId].realW, realH: fileData[fId].realH,
      });
    }
    if (!quickTestOk) {
      return { sheets: [], stats: { totalSheets: 0, details: [] }, errors: ["Montage impossible, passer au format superieur."] };
    }

    // Test rapide : vérifier que toutes les images tiennent ensemble sur une planche
    try {
      const quickRes = await runPixelWorkerPack({ packerPageW, packerPageH, items: quickTestItems, allowRotation, sortMode: 'area' });
      if (quickRes.length < quickTestItems.length) {
        console.log(`[imbrication] ABANDON: meme 1 exemplaire de chaque ne rentre pas (${quickRes.length}/${quickTestItems.length})`);
        return { sheets: [], stats: { totalSheets: 0, details: [] }, errors: ["Montage impossible, passer au format superieur."] };
      }
      console.log(`[imbrication] test rapide OK: ${quickRes.length}/${quickTestItems.length} placees`);
    } catch {
      return { sheets: [], stats: { totalSheets: 0, details: [] }, errors: ["Erreur calcul imbrication."] };
    }

    // Estimation via MaxRectsPacker : trouver le run max (rectangulaire) puis descendre en pixel
    // Phase 1 : trouver le run minimum en rectangulaire (borne haute)
    let maxRunRect = 500;
    const estimT0 = performance.now();
    for (let estRun = 1; estRun <= 500; estRun++) {
      const estItems = [];
      for (const fId in fileData) {
        const file = fileData[fId];
        const perSheet = Math.ceil(file.req / estRun);
        for (let i = 0; i < perSheet; i++) {
          estItems.push({ w: file.wCalc, h: file.hCalc });
        }
      }
      const packer = new MaxRectsPacker(pageW, pageH);
      const packed = packer.fit(estItems, allowRotation, 'area');
      if (packed.length === estItems.length) {
        maxRunRect = estRun;
        console.log(`[imbrication] estimation MaxRects: run=${estRun} (${estItems.length} items) — borne haute (${(performance.now()-estimT0).toFixed(0)}ms)`);
        break;
      }
    }

    // Phase 2 : descendre depuis maxRunRect vers 1
    // L'imbrication cale au moins autant que le rectangulaire, souvent mieux
    // On cherche le run le plus petit où toutes les pièces tiennent (= moins de planches, plus de pièces par planche)
    // Helper : calculer le nombre total de pièces pour un run donné
    const countItemsForRun = (run) => {
      let total = 0;
      for (const fId in fileData) {
        const file = fileData[fId];
        total += Math.max(1, Math.ceil(file.req / run));
      }
      return total;
    };

    // Helper : trouver le prochain run (en descendant) qui change le nombre de pièces
    const findNextDifferentRun = (fromRun) => {
      const currentCount = countItemsForRun(fromRun);
      for (let r = fromRun - 1; r >= 1; r--) {
        if (countItemsForRun(r) !== currentCount) return r;
      }
      return 0; // aucun run différent trouvé
    };

    console.log(`[imbrication] recherche descendante depuis run=${maxRunRect} vers 1`);

    for (let currentRuns = maxRunRect; currentRuns >= 1;) {
      if (stopRef && stopRef.current) {
        console.log(`[imbrication] STOP par utilisateur au run ${currentRuns}`);
        return { sheets: [], stats: { totalSheets: 0, details: [] }, errors: ["Calcul interrompu."] };
      }
      const itemCount = countItemsForRun(currentRuns);
      if (onProgress) onProgress(`Run ${currentRuns} — ${itemCount} pieces sur la planche...`);


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
      if (!canAttempt) { console.log(`[imbrication] run ${currentRuns}: image trop grande, abandon`); break; }

      const runT0 = performance.now();
      let bestPackedImb = [];
      const isOptimiseImb = sortMode === 'optimise';
      const imbSortModes = isOptimiseImb ? ['area', 'width', 'none'] : [sortMode];
      const imbOrients = allowRotation ? [[false, false], [false, true], [true, false], [true, true]] : [[false, false]];
      let variantsTested = 0;

      outerImb: for (const sm of imbSortModes) {
        for (const [preRot, rot] of imbOrients) {
          if (stopRef && stopRef.current) break outerImb;
          const variant = preRot
            ? currentSheetItems.map(it => ({ ...it, w: it.h, h: it.w, realW: it.realH, realH: it.realW, mask: rotateMaskFn(it.mask), _prerotated: true }))
            : currentSheetItems.map(it => ({ ...it }));
          let res;
          const vT0 = performance.now();
          try {
            res = await runPixelWorkerPack({ packerPageW, packerPageH, items: variant, allowRotation: rot, sortMode: sm });
          } catch { break outerImb; }
          variantsTested++;
          if (stopRef && stopRef.current) break outerImb;
          const fixedRes = res.map(it => it._prerotated ? { ...it, rotated: !it.rotated, realW: it.realH, realH: it.realW } : it);
          console.log(`[imbrication] run ${currentRuns} variant ${variantsTested} (sort=${sm} preRot=${preRot} rot=${rot}): ${fixedRes.length}/${currentSheetItems.length} placees (${(performance.now()-vT0).toFixed(0)}ms)`);
          if (fixedRes.length > bestPackedImb.length) bestPackedImb = fixedRes;
          if (bestPackedImb.length === currentSheetItems.length) break outerImb;
        }
      }

      const runDt = (performance.now() - runT0).toFixed(0);
      console.log(`[imbrication] run ${currentRuns}: ${bestPackedImb.length}/${currentSheetItems.length} (${variantsTested} variantes, ${runDt}ms)`);

      if (bestPackedImb.length === currentSheetItems.length) {
        // Ca rentre ! On sauvegarde et on essaie avec moins de planches (plus de pièces par planche)
        solved = true;
        const rescaledItems = bestPackedImb.map(pi => ({
          ...pi, x: pi.x / IMB_SCALE - safeMargin / 2, y: pi.y / IMB_SCALE - safeMargin / 2
        }));
        bestResult = { items: rescaledItems, runs: currentRuns, efficiency: "N/A" };
        if (onProgress) onProgress(`Run ${currentRuns} — ${currentSheetItems.length} pieces OK ✓`);
        // Sauter au prochain run qui change le nombre de pièces
        const nextRun = findNextDifferentRun(currentRuns);
        if (nextRun <= 0) {
          console.log(`[imbrication] OK au run ${currentRuns} — plus de run different possible (${((Date.now()-startTime)/1000).toFixed(1)}s)`);
          break;
        }
        const nextCount = countItemsForRun(nextRun);
        console.log(`[imbrication] OK au run ${currentRuns} (${currentSheetItems.length} items) — saut au run ${nextRun} (${nextCount} items) (${((Date.now()-startTime)/1000).toFixed(1)}s)`);
        currentRuns = nextRun;
        continue;
      } else {
        // Ca ne rentre plus avec les variantes rapides
        if (onProgress) onProgress(`Run ${currentRuns} — ${bestPackedImb.length}/${currentSheetItems.length} pieces ✗`);
        console.log(`[imbrication] run ${currentRuns} ECHEC partiel (${bestPackedImb.length}/${currentSheetItems.length}) — variantes rapides epuisees`);

        if (solved) {
          // Test exhaustif automatique (toutes les variantes)
          if (onProgress) onProgress(`Run ${currentRuns} — test exhaustif...`);
          console.log(`[imbrication] test exhaustif pour run ${currentRuns}...`);
          const exhaustSortModes = ['area', 'width', 'none'];
          const exhaustOrients = allowRotation ? [[false, false], [false, true], [true, false], [true, true]] : [[false, false]];
          let foundBetter = false;

          exhaustSearch: for (const sm of exhaustSortModes) {
            for (const [preRot, rot] of exhaustOrients) {
              if (stopRef && stopRef.current) break exhaustSearch;
              const variant = preRot
                ? currentSheetItems.map(it => ({ ...it, w: it.h, h: it.w, realW: it.realH, realH: it.realW, mask: rotateMaskFn(it.mask), _prerotated: true }))
                : currentSheetItems.map(it => ({ ...it }));
              let res;
              const vT0 = performance.now();
              try {
                res = await runPixelWorkerPack({ packerPageW, packerPageH, items: variant, allowRotation: rot, sortMode: sm });
              } catch { continue; }
              const fixedRes = res.map(it => it._prerotated ? { ...it, rotated: !it.rotated, realW: it.realH, realH: it.realW } : it);
              console.log(`[imbrication] exhaustif run ${currentRuns} (sort=${sm} preRot=${preRot} rot=${rot}): ${fixedRes.length}/${currentSheetItems.length} (${(performance.now()-vT0).toFixed(0)}ms)`);
              if (fixedRes.length === currentSheetItems.length) {
                const rescaledItems = fixedRes.map(pi => ({
                  ...pi, x: pi.x / IMB_SCALE - safeMargin / 2, y: pi.y / IMB_SCALE - safeMargin / 2
                }));
                bestResult = { items: rescaledItems, runs: currentRuns, efficiency: "N/A" };
                console.log(`[imbrication] run ${currentRuns} OK en exhaustif!`);
                foundBetter = true;
                break exhaustSearch;
              }
            }
          }
          if (foundBetter) {
            const nextRun2 = findNextDifferentRun(currentRuns);
            if (nextRun2 <= 0) break;
            currentRuns = nextRun2;
            continue;
          }
        }
        // Vraiment impossible → on garde le meilleur
        if (solved) {
          console.log(`[imbrication] on garde le run ${bestResult.runs} (${((Date.now()-startTime)/1000).toFixed(1)}s total)`);
        }
        break;
      }
    }

    if (!solved || !bestResult) {
      return { sheets: [], stats: { totalSheets: 0, details: [] }, errors: ["Montage impossible, passer au format supérieur"] };
    }

    if (onProgress) onProgress(`Meilleur : ${bestResult.runs} planches`);
    console.log(`[imbrication] BEST: run ${bestResult.runs} (${((Date.now()-startTime)/1000).toFixed(1)}s total)`);

    // Afficher le montage trouvé
    if (onFirstResult) {
      const countsFirst = {};
      bestResult.items.forEach(item => { countsFirst[item.fileId] = (countsFirst[item.fileId] || 0) + 1; });
      const statsFirst = {};
      Object.values(fileData).forEach(f => {
        const onSheet = countsFirst[f.id] || 0;
        statsFirst[f.id] = { name: f.name, src: f.src, req: f.req, made: onSheet * bestResult.runs };
      });
      onFirstResult({
        sheets: [{ id: 1, items: bestResult.items, copies: bestResult.runs, efficiency: 'N/A' }],
        stats: {
          totalSheets: bestResult.runs, uniqueMontages: 1,
          details: Object.values(statsFirst).map(s => ({ id: Math.random(), ...s })),
          detailsMap: statsFirst
        },
      });
    }

    // Recherche automatique de variantes
    if (onAskMoreVariants) {
      const finalSheetItems = [];
      for (const f of files) {
        const file = fileData[f.id];
        if (!file) continue;
        let targetPerSheet = Math.ceil(file.req / bestResult.runs);
        if (targetPerSheet < 1) targetPerSheet = 1;
        for (let i = 0; i < targetPerSheet; i++) {
          finalSheetItems.push({
            fileId: file.id, src: file.src, mask: masksCache[file.id],
            w: file.realW, h: file.realH, realW: file.realW, realH: file.realH,
            uuid: Math.random()
          });
        }
      }

      console.log(`[imbrication] recherche de variantes au run ${bestResult.runs} (${finalSheetItems.length} items)...`);
      const allVariants = [{ items: bestResult.items, label: 'Variante 1' }];
      const allSortModes = ['area', 'width', 'none'];
      const allOrients = allowRotation ? [[false, false], [false, true], [true, false], [true, true]] : [[false, false]];
      let vCount = 1;

      // Notifier le début de la recherche (ouvre la fenêtre de choix)
      onAskMoreVariants(bestResult.runs, allVariants, false);

      for (const sm of allSortModes) {
        for (const [preRot, rot] of allOrients) {
          if (stopRef && stopRef.current) break;
          if (onProgress) onProgress(`Variantes : ${allVariants.length} trouvee(s)...`);
          const variant = preRot
            ? finalSheetItems.map(it => ({ ...it, w: it.h, h: it.w, realW: it.realH, realH: it.realW, mask: rotateMaskFn(it.mask), _prerotated: true }))
            : finalSheetItems.map(it => ({ ...it }));
          let res;
          try {
            res = await runPixelWorkerPack({ packerPageW, packerPageH, items: variant, allowRotation: rot, sortMode: sm });
          } catch { continue; }
          const fixedRes = res.map(it => it._prerotated ? { ...it, rotated: !it.rotated, realW: it.realH, realH: it.realW } : it);
          if (fixedRes.length === finalSheetItems.length) {
            const rescaled = fixedRes.map(pi => ({
              ...pi, x: pi.x / IMB_SCALE - safeMargin / 2, y: pi.y / IMB_SCALE - safeMargin / 2
            }));
            const isDupe = allVariants.some(v => {
              if (v.items.length !== rescaled.length) return false;
              return v.items.every((it, i) => Math.abs(it.x - rescaled[i].x) < 0.5 && Math.abs(it.y - rescaled[i].y) < 0.5);
            });
            if (!isDupe) {
              vCount++;
              allVariants.push({ items: rescaled, label: `Variante ${vCount}` });
              console.log(`[imbrication] variante ${vCount} trouvee (sort=${sm} preRot=${preRot} rot=${rot})`);
              // Notifier en temps réel
              onAskMoreVariants(bestResult.runs, allVariants, false);
            }
          }
        }
      }
      console.log(`[imbrication] ${allVariants.length} variante(s) trouvee(s)`);
      // Notifier la fin de la recherche
      onAskMoreVariants(bestResult.runs, allVariants, true);

      if (allVariants.length > 1) {
        const allSheets = allVariants.map((v, i) => ({
          id: i + 1, items: v.items, copies: bestResult.runs, efficiency: 'N/A', label: v.label
        }));
        const countsOnSheet = {};
        bestResult.items.forEach(item => { countsOnSheet[item.fileId] = (countsOnSheet[item.fileId] || 0) + 1; });
        const statsMap = {};
        Object.values(fileData).forEach(f => {
          const onSheet = countsOnSheet[f.id] || 0;
          statsMap[f.id] = { name: f.name, src: f.src, req: f.req, made: onSheet * bestResult.runs };
        });
        return {
          sheets: allSheets,
          stats: {
            totalSheets: bestResult.runs, uniqueMontages: allVariants.length,
            details: Object.values(statsMap).map(s => ({ id: Math.random(), ...s })),
            detailsMap: statsMap
          },
          errors: []
        };
      }
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
    if ((stopRef && stopRef.current) || Date.now() - startTime > TIMEOUT_LIMIT) {
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
    return { sheets: [], stats: { totalSheets: 0, details: [] }, errors: ["Montage impossible, passer au format supérieur"] };
  }

  // Afficher le premier résultat immédiatement
  if (onFirstResult) {
    const countsOnSheet0 = {};
    bestResult.items.forEach(item => { countsOnSheet0[item.fileId] = (countsOnSheet0[item.fileId] || 0) + 1; });
    const statsMap0 = {};
    Object.values(fileData).forEach(f => {
      const onSheet = countsOnSheet0[f.id] || 0;
      statsMap0[f.id] = { name: f.name, src: f.src, req: f.req, made: onSheet * bestResult.runs };
    });
    onFirstResult({
      sheets: [{ id: 1, items: bestResult.items, copies: bestResult.runs, efficiency: bestResult.efficiency }],
      stats: { totalSheets: bestResult.runs, uniqueMontages: 1, details: Object.values(statsMap0).map(s => ({ id: Math.random(), ...s })), detailsMap: statsMap0 }
    });
  }

  // Recherche de variantes (autres placements avec le même nombre de planches)
  if (onAskMoreVariants) {
    const optRuns = bestResult.runs;
    let currentSheetItems = [];
    files.forEach(f => {
      const file = fileData[f.id];
      if (!file) return;
      let targetPerSheet = Math.ceil(file.req / optRuns);
      if (targetPerSheet < 1) targetPerSheet = 1;
      for (let i = 0; i < targetPerSheet; i++) {
        currentSheetItems.push({ fileId: file.id, src: file.src, w: file.wCalc, h: file.hCalc, realW: file.realW, realH: file.realH, uuid: Math.random() });
      }
    });

    const allSortModes = ['area', 'width', 'none'];
    const allOrients = allowRotation ? [[false, false], [false, true], [true, false], [true, true]] : [[false, false]];
    const allPackers = currentMode === 'massicot' ? ['massicot'] : currentMode === 'imbrique' ? ['imbrique'] : [currentMode];
    const allSplitModes = currentMode === 'massicot' ? ['auto', 'horizontal', 'vertical'] : ['bssf', 'blsf', 'baf'];
    const allVariants = [{ items: bestResult.items, label: 'Variante 1' }];
    let vCount = 1;

    const isMassiMode = (currentMode === 'massicot' || currentMode === 'imbrique');
    const packW = isMassiMode ? pageW + safeMargin * 2 : pageW;
    const packH = isMassiMode ? pageH + safeMargin * 2 : pageH;

    onAskMoreVariants(optRuns, allVariants, false);

    for (const sm of allSortModes) {
      for (const pm of allPackers) {
        for (const splitM of allSplitModes) {
          for (const [preRot, rot] of allOrients) {
            if (stopRef && stopRef.current) break;
            if (!allowRotation && (preRot || rot)) continue;
            const variant = preRot
              ? currentSheetItems.map(it => ({ ...it, w: it.h, h: it.w, realW: it.realH, realH: it.realW, _prerotated: true }))
              : currentSheetItems.map(it => ({ ...it }));
            let p = pm === 'massicot' ? new GuillotinePacker(packW, packH, splitM) : new MaxRectsPacker(packW, packH, splitM);
            let res = p.fit(variant.map(it => ({ ...it })), rot, sm);
            res = res.map(it => it._prerotated ? { ...it, rotated: !it.rotated, realW: it.realH, realH: it.realW } : it);
            if (isMassiMode) res = res.map(it => ({ ...it, x: it.x - safeMargin, y: it.y - safeMargin }));

          if (res.length === currentSheetItems.length) {
            const isDuplicate = allVariants.some(v => {
              if (v.items.length !== res.length) return false;
              return v.items.every((vi, idx) => Math.abs(vi.x - res[idx].x) < 0.01 && Math.abs(vi.y - res[idx].y) < 0.01 && vi.rotated === res[idx].rotated);
            });
            if (!isDuplicate) {
              vCount++;
              allVariants.push({ items: res, label: `Variante ${vCount}` });
              console.log(`[massicot/imbrique] variante ${vCount} trouvee (sort=${sm} packer=${pm} preRot=${preRot} rot=${rot})`);
              onAskMoreVariants(optRuns, allVariants, false);
            }
          }
        }
        }
      }
    }
    console.log(`[massicot/imbrique] ${allVariants.length} variante(s) trouvee(s)`);
    onAskMoreVariants(optRuns, allVariants, true);

    if (allVariants.length > 1) {
      const allSheets = allVariants.map((v, i) => ({
        id: i + 1, items: v.items, label: v.label, copies: optRuns, efficiency: bestResult.efficiency
      }));
      const countsOnSheet = {};
      bestResult.items.forEach(item => { countsOnSheet[item.fileId] = (countsOnSheet[item.fileId] || 0) + 1; });
      const statsMap = {};
      Object.values(fileData).forEach(f => {
        const onSheet = countsOnSheet[f.id] || 0;
        statsMap[f.id] = { name: f.name, src: f.src, req: f.req, made: onSheet * optRuns };
      });
      return {
        sheets: allSheets,
        stats: { totalSheets: optRuns, uniqueMontages: allVariants.length, details: Object.values(statsMap).map(s => ({ id: Math.random(), ...s })), detailsMap: statsMap },
        errors: []
      };
    }
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
  // En mode imbrication, marge forcée à 4mm minimum (comme dans launchImposition)
  const m = (impositionMode === 'imbrication') ? Math.max(4, parseInput(margin)) : parseInput(margin);
  const pW = parseInput(sheetSize.w);
  const pH = parseInput(sheetSize.h);
  const iW = parseInput(file.width_mm) + m * 2;
  const iH = parseInput(file.height_mm) + m * 2;
  let q = Math.floor((pW * pH) / (iW * iH));
  if (q > 500) q = 500;
  const allowRot = activeTab !== 'norotate';
  const isOptimise = activeTab === 'compact';
  const sortModesToTry = isOptimise ? ['area', 'width', 'none'] : [activeTab === 'grouped' ? 'none' : 'area'];
  const packersToTry = isOptimise ? ['massicot', 'imbrique'] : [impositionMode === 'massicot' ? 'massicot' : 'imbrique'];
  // Pour l'imbrication, le packer pixel n'est pas utilisable ici (pas de masque alpha),
  // on utilise le rectangle packing avec les bonnes marges comme estimation conservative.
  while (q > 0) {
    const isMassiMode = (impositionMode === 'massicot' || impositionMode === 'imbrique');
    const packW = isMassiMode ? pW + m * 2 : pW;
    const packH = isMassiMode ? pH + m * 2 : pH;
    const items = Array(q).fill(null).map(() => ({ w: iW, h: iH }));
    let fits = false;
    for (const sm of sortModesToTry) {
      for (const pm of packersToTry) {
        const packer = pm === 'massicot' ? new GuillotinePacker(packW, packH) : new MaxRectsPacker(packW, packH);
        if (packer.fit(items.map(it => ({ ...it })), allowRot, sm).length === q) { fits = true; break; }
      }
      if (fits) break;
    }
    if (fits) break;
    q--;
  }
  return q > 0 ? q : null;
}
