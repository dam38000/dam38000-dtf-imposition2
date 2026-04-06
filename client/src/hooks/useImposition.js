// ============================================================
//  useImposition.js — Calcul imposition, optimal, variantes
// ============================================================

import { useState, useRef, useEffect } from 'react';
import { launchImposition, fillPageWithImage, terminatePixelWorker } from '../lib/imposition';
import { PRIX_TABLES, FORMAT_MULTIPLES, roundToMultiple, getPrixUnitaire } from '../lib/pricing';
import { PRODUCT_FORMATS, MAX_QUANTITY } from '../lib/constants';

export function useImposition({ files, setFiles, productMode, selectedFormat, setSelectedFormat, impositionMode, setImpositionMode, margin, allowRotation, sheetSize, setErrorAlert }) {
  // ── Imposition ──
  const [sheets, setSheets] = useState([]);
  const [stats, setStats] = useState(null);
  const [impositionErrors, setImpositionErrors] = useState([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [variantsChooser, setVariantsChooser] = useState(null);
  const [calcProgress, setCalcProgress] = useState('');
  const [currentSheetIndex, setCurrentSheetIndex] = useState(0);

  // ── Modal optimal ──
  const [showOptimalModal, setShowOptimalModal] = useState(false);
  const [optimalPanel, setOptimalPanel] = useState([]);
  const [optimalFilters, setOptimalFilters] = useState({ massicot: true, imbrique: true, imbrication: true });
  const [isOptimalRunning, setIsOptimalRunning] = useState(false);
  const [optimalProgress, setOptimalProgress] = useState('');
  const optimalCacheRef = useRef({});
  const optimalStopRef = useRef(false);
  const calcStopRef = useRef(false);

  // ── Alerte quantité ──
  const [quantityWarning, setQuantityWarning] = useState(null);

  // ── Remettre la planche à zéro ──
  const resetPlanche = () => { setSheets([]); setStats(null); setImpositionErrors([]); setCurrentSheetIndex(0); };

  // ── Fermer le chooser de variantes dès qu'on fait une action ──
  useEffect(() => {
    if (variantsChooser) setVariantsChooser(null);
  }, [files, selectedFormat, margin, impositionMode, allowRotation, showOptimalModal]);

  // ── Lancer l'imposition ──
  const handleMonter = async (force = false) => {
    if (isCalculating) {
      calcStopRef.current = true;
      terminatePixelWorker();
      setIsCalculating(false);
      return;
    }
    if (files.length === 0) return;
    if (!force) {
      const totalQty = files.reduce((sum, f) => sum + f.quantity, 0);
      if (totalQty > MAX_QUANTITY) {
        setQuantityWarning({ totalQty, action: 'monter' });
        return;
      }
    }
    calcStopRef.current = false;
    setIsCalculating(true);
    setCalcProgress('');
    setSheets([]);
    setStats(null);
    setImpositionErrors([]);
    setCurrentSheetIndex(0);
    const calcTimeout = setTimeout(() => {
      calcStopRef.current = true;
      terminatePixelWorker();
      setIsCalculating(false);
      setErrorAlert({ title: 'Calcul trop long', message: 'Le calcul a d\u00e9pass\u00e9 60 secondes et a \u00e9t\u00e9 interrompu.', solution: 'R\u00e9duisez les quantit\u00e9s ou utilisez un format plus grand. Si le probl\u00e8me persiste, contactez Printmytransfer au 04 76 36 61 15.' });
    }, 60000);
    try {
      const mappedFiles = files.map(f => ({
        id: f.id, name: f.name, width_mm: f.width, height_mm: f.height,
        quantity: f.quantity, thumbnailUrl: f.thumbnailUrl,
      }));
      const activeTab = allowRotation ? 'compact' : 'norotate';
      const result = await launchImposition({
        files: mappedFiles, sheetSize, margin, impositionMode, activeTab,
        stopRef: calcStopRef,
        onAskMoreVariants: (runs, variants, isComplete) => {
          const mappedVariants = variants.map((v, i) => ({ items: v.items, label: v.label || `Variante ${i + 1}` }));
          setVariantsChooser(prev => {
            const idx = prev?.currentIdx || 0;
            if (mappedVariants.length > 0 && idx < mappedVariants.length) {
              setSheets([{ id: idx + 1, items: mappedVariants[idx].items, copies: runs, efficiency: 'N/A' }]);
            }
            return { variants: mappedVariants, runs, currentIdx: idx, searching: !isComplete };
          });
        },
        onProgress: (msg) => setCalcProgress(msg),
        onFirstResult: (intermediateResult) => {
          setSheets(intermediateResult.sheets || []);
          setStats(intermediateResult.stats || null);
          setIsCalculating(false);
        },
      });
      const isSeri = productMode === 'SeriQuadri' || productMode === 'SeriLight';
      const runsArrondi = isSeri ? (result.stats?.totalSheets || 0) : roundToMultiple(result.stats?.totalSheets || 0, selectedFormat);
      if (result.stats?.details) {
        result.stats.details = result.stats.details.map(d => {
          const onSheet = result.sheets[0]?.items?.filter(it => it.fileId === d.id || it.src === d.src).length || 0;
          return { ...d, made: onSheet > 0 ? onSheet * runsArrondi : d.made };
        });
      }
      setSheets(result.sheets || []);
      setStats(result.stats || null);
      setImpositionErrors(result.errors || []);
    } catch (err) {
      console.error('Erreur imposition:', err);
      const msg = err.message || String(err);
      if (msg.includes('memory') || msg.includes('Maximum') || msg.includes('MAX_FREE_RECTS')) {
        setErrorAlert({ title: 'Calcul impossible', message: 'Le calcul necessite trop de memoire pour cette combinaison.', solution: 'Reduisez les quantites, utilisez un format plus grand, ou essayez le mode Massicotable.' });
      } else if (msg.includes('timeout') || msg.includes('Timeout')) {
        setErrorAlert({ title: 'Calcul trop long', message: 'Le calcul a depasse le temps limite.', solution: 'Reduisez les quantites ou simplifiez le montage.' });
      } else {
        setErrorAlert({ title: 'Erreur de calcul', message: msg, solution: 'Si le probleme persiste, contactez Printmytransfer au 04 76 36 61 15.' });
      }
      setImpositionErrors([]);
    } finally {
      clearTimeout(calcTimeout);
      setIsCalculating(false);
    }
  };

  // ── Remplir (1 seul fichier) ──
  const handleRemplir = async () => {
    if (files.length !== 1) return;
    const f = files[0];
    const activeTab = allowRotation ? 'compact' : 'norotate';
    const qty = fillPageWithImage({
      files: [{ ...f, width_mm: f.width, height_mm: f.height }],
      sheetSize, margin, impositionMode, activeTab,
    });
    if (qty && qty > 0) {
      const updatedFiles = files.map(file => file.id === f.id ? { ...file, quantity: qty } : file);
      setFiles(updatedFiles);
      setIsCalculating(true);
      setSheets([]); setStats(null); setImpositionErrors([]); setCurrentSheetIndex(0);
      try {
        const mappedFiles = updatedFiles.map(ff => ({
          id: ff.id, name: ff.name, width_mm: ff.width, height_mm: ff.height,
          quantity: ff.quantity, thumbnailUrl: ff.thumbnailUrl,
        }));
        const result = await launchImposition({ files: mappedFiles, sheetSize, margin, impositionMode, activeTab });
        setSheets(result.sheets || []); setStats(result.stats || null); setImpositionErrors(result.errors || []);
      } catch (err) {
        console.error('Erreur imposition:', err);
        setErrorAlert({ title: 'Erreur de calcul', message: err.message || String(err), solution: 'Si le probleme persiste, contactez Printmytransfer au 04 76 36 61 15.' });
      } finally { setIsCalculating(false); }
    }
  };

  // ── Lancer le calcul optimal ──
  const launchOptimal = async (force = false) => {
    if (files.length === 0) return;
    if (!force) {
      const totalQty = files.reduce((sum, f) => sum + f.quantity, 0);
      if (totalQty > MAX_QUANTITY) {
        setQuantityWarning({ totalQty, action: 'optimal' });
        return;
      }
    }
    const fmts = PRODUCT_FORMATS[productMode];
    const table = PRIX_TABLES[productMode];
    const isSeri = productMode === 'SeriQuadri' || productMode === 'SeriLight';
    const activeModes = [];
    if (optimalFilters.massicot) activeModes.push('massicot');
    if (optimalFilters.imbrique) activeModes.push('imbrique');
    if (optimalFilters.imbrication) activeModes.push('imbrication');

    console.log('[optimal] START — produit:', productMode, '| modes:', activeModes, '| fichiers:', files.length);
    console.log('[optimal] fichiers:', files.map(f => `${f.name} ${f.width}x${f.height}mm qty=${f.quantity}`));

    const maxW = Math.max(...files.map(f => f.width));
    const maxH = Math.max(...files.map(f => f.height));
    console.log('[optimal] dimensions max image:', maxW, 'x', maxH, 'mm');

    const validFmts = Object.entries(fmts).filter(([, d]) =>
      (maxW <= d.w && maxH <= d.h) || (maxW <= d.h && maxH <= d.w)
    ).sort((a, b) => (b[1].w * b[1].h) - (a[1].w * a[1].h));

    console.log('[optimal] formats valides:', validFmts.map(([n, d]) => `${n} (${d.w}x${d.h})`));
    console.log('[optimal] formats exclus:', Object.entries(fmts).filter(([n]) => !validFmts.find(([vn]) => vn === n)).map(([n, d]) => `${n} (${d.w}x${d.h}) — trop petit`));

    const results = [];
    optimalCacheRef.current = {};
    optimalStopRef.current = false;
    setIsOptimalRunning(true);
    setOptimalPanel([]);
    setOptimalProgress('Demarrage...');
    const optimalTimeout = setTimeout(() => {
      optimalStopRef.current = true;
      terminatePixelWorker();
      setIsOptimalRunning(false);
      setOptimalProgress('');
      setErrorAlert({ title: 'Calcul trop long', message: 'Le calcul optimal a d\u00e9pass\u00e9 2 minutes et a \u00e9t\u00e9 interrompu.', solution: 'R\u00e9duisez les quantit\u00e9s ou d\u00e9s\u00e9lectionnez le mode Imbrication. Si le probl\u00e8me persiste, contactez Printmytransfer au 04 76 36 61 15.' });
    }, 120000);

    const mappedFiles = files.map(f => ({
      id: f.id, name: f.name, width_mm: f.width, height_mm: f.height,
      quantity: f.quantity, thumbnailUrl: f.thumbnailUrl,
    }));

    const t0 = performance.now();

    try {
      for (const mode of activeModes) {
        if (optimalStopRef.current) { console.log('[optimal] STOP demande par utilisateur'); break; }
        console.log(`[optimal] ── mode: ${mode} ──`);
        for (const [fmtName, fmtDim] of validFmts) {
          if (optimalStopRef.current) break;
          const modeLabel = { massicot: 'Massicot', imbrique: 'Imbrique', imbrication: 'Imbrication' }[mode];
          setOptimalProgress(`${modeLabel} / ${fmtName} — ${results.length} resultat${results.length > 1 ? 's' : ''}`);
          const activeTab = 'compact';
          const tCalc = performance.now();
          try {
            console.log(`[optimal] >> ${mode} / ${fmtName} (${fmtDim.w}x${fmtDim.h})...`);
            const result = await launchImposition({
              files: mappedFiles, sheetSize: fmtDim, margin, impositionMode: mode, activeTab,
              stopRef: optimalStopRef,
              onProgress: (msg) => setOptimalProgress(`${modeLabel} / ${fmtName} — ${msg}`),
            });
            const runs = result.stats?.totalSheets || 0;
            const dt = (performance.now() - tCalc).toFixed(0);
            console.log(`[optimal] << ${mode} / ${fmtName} = ${runs} planches (${dt}ms) | items/planche: ${result.sheets[0]?.items?.length || 0}`);

            if (runs > 0) {
              const cleanName = fmtName.replace('+', '');
              const priceName = cleanName === 'M1' ? '1M' : cleanName;
              const nb = isSeri ? runs : roundToMultiple(runs, priceName);
              const pu = table ? getPrixUnitaire(priceName, nb, table) : null;
              const totalHT = pu ? pu * nb : null;

              console.log(`[optimal]    prix: ${priceName} x${nb} (arrondi ${runs}->${nb}) @ ${pu}€/u = ${totalHT?.toFixed(2) || '?'}€ HT`);

              const entry = { mode, fmtName, priceName, fmtDim, runs, nb, pu: pu || 0, totalHT: totalHT || 0 };
              results.push(entry);

              const cacheKey = `${mode}_${fmtName}`;
              optimalCacheRef.current[cacheKey] = {
                sheets: result.sheets.map(s => ({ ...s, items: s.items.map(it => ({ ...it })) })),
                stats: { ...result.stats, details: result.stats.details ? [...result.stats.details] : [] },
              };
              setOptimalPanel([...results]);

              setSelectedFormat(fmtName);
              setSheets(result.sheets);
              setCurrentSheetIndex(0);
              setImpositionMode(mode);
            } else {
              console.log(`[optimal]    aucune planche produite (0 items)`);
            }
          } catch (err) {
            console.warn(`[optimal] ERREUR ${mode}/${fmtName}:`, err);
            const msg = err.message || String(err);
            if (msg.includes('memory') || msg.includes('Maximum') || msg.includes('MAX_FREE_RECTS')) {
              console.warn(`[optimal] Skipping ${mode}/${fmtName} — memoire insuffisante`);
            }
          }
          await new Promise(r => setTimeout(r, 0));
        }
      }
    } catch (err) {
      console.error('[optimal] ERREUR GLOBALE:', err);
      setErrorAlert({ title: 'Erreur calcul optimal', message: err.message || String(err), solution: 'Reduisez les quantites ou deselectionnez le mode Imbrication. Si le probleme persiste, contactez Printmytransfer au 04 76 36 61 15.' });
    } finally {
      clearTimeout(optimalTimeout);
      const totalTime = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(`[optimal] TERMINE — ${results.length} resultats en ${totalTime}s`);
      console.table(results.map(r => ({ mode: r.mode, format: r.fmtName, planches: r.nb, prixU: r.pu, totalHT: r.totalHT.toFixed(2) })));
      setIsOptimalRunning(false);
      setOptimalProgress('');
    }
  };

  // ── Appliquer un résultat optimal ──
  const applyOptimalResult = async (entry) => {
    setImpositionMode(entry.mode);
    const fmts = PRODUCT_FORMATS[productMode];
    if (fmts[entry.fmtName]) {
      setSelectedFormat(entry.fmtName);
    }
    const cacheKey = `${entry.mode}_${entry.fmtName}`;
    const cached = optimalCacheRef.current[cacheKey];
    if (cached) {
      setSheets(cached.sheets);
      setStats(cached.stats);
      setImpositionErrors([]);
      setCurrentSheetIndex(0);
    }
  };

  return {
    sheets, setSheets,
    stats, setStats,
    impositionErrors, setImpositionErrors,
    isCalculating, setIsCalculating,
    variantsChooser, setVariantsChooser,
    calcProgress,
    currentSheetIndex, setCurrentSheetIndex,
    showOptimalModal, setShowOptimalModal,
    optimalPanel, setOptimalPanel,
    optimalFilters, setOptimalFilters,
    isOptimalRunning, setIsOptimalRunning,
    optimalProgress,
    optimalStopRef, calcStopRef,
    quantityWarning, setQuantityWarning,
    resetPlanche,
    handleMonter,
    handleRemplir,
    launchOptimal,
    applyOptimalResult,
  };
}
