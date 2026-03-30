// ============================================================
//  App.jsx — Etape 2 : Upload + Preview fichiers
//  Design PMT + upload API /api/upload
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { Icons } from './components/Icons';
import { launchImposition, fillPageWithImage, terminatePixelWorker } from './lib/imposition';
import { PRIX_TABLES, FORMAT_MULTIPLES, roundToMultiple, getPrixUnitaire } from './lib/pricing';
import { jsPDF } from 'jspdf';

const PRODUCT_FORMATS = {
  'DTF': {
    'M1': { w: 1000, h: 575 }, 'A2': { w: 575, h: 420 }, 'A3': { w: 420, h: 280 },
    'A4': { w: 280, h: 202 }, 'A5': { w: 202, h: 132 }, 'A6': { w: 132, h: 93 },
  },
  'UV DTF': {
    'A2+': { w: 670, h: 480 }, 'A3+': { w: 480, h: 305 }, 'A4+': { w: 305, h: 232 },
    'A5+': { w: 232, h: 144.5 }, 'A6+': { w: 144.5, h: 104 }, 'A7+': { w: 104, h: 60 },
    'A8+': { w: 60, h: 44 },
  },
  'SeriQuadri': {
    'A3': { w: 404, h: 281 }, 'A4': { w: 281, h: 194 }, 'A5': { w: 194, h: 132 },
    'A6': { w: 132, h: 89 }, 'A7': { w: 89, h: 58 }, 'A8': { w: 58, h: 36 },
  },
  'SeriLight': {
    'A3': { w: 404, h: 281 }, 'A4': { w: 281, h: 194 }, 'A5': { w: 194, h: 132 },
    'A6': { w: 132, h: 89 }, 'A7': { w: 89, h: 58 }, 'A8': { w: 58, h: 36 },
  },
};

// ── Limite dynamique selon la RAM du client ──
function getMaxQuantity() {
  const ram = navigator.deviceMemory || 4; // en Go (fallback 4 Go si non supporté)
  if (ram <= 4) return 500;
  if (ram <= 8) return 1500;
  return 5000;
}
const MAX_QUANTITY = getMaxQuantity();

export default function App() {
  // ── Etat general ──
  const [productMode, setProductMode] = useState('DTF');
  const [selectedFormat, setSelectedFormat] = useState('A2');
  const [impositionMode, setImpositionMode] = useState('massicot');
  const [margin, setMargin] = useState(6);

  // ── Fichiers ──
  const [files, setFiles] = useState([]);
  const [uploadStatus, setUploadStatus] = useState(null); // { step, fileName, current, total }
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // ── Imposition ──
  const [sheets, setSheets] = useState([]);
  const [stats, setStats] = useState(null);
  const [impositionErrors, setImpositionErrors] = useState([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [variantsChooser, setVariantsChooser] = useState(null); // { variants: [{items, label}], runs, currentIdx }
  const [calcProgress, setCalcProgress] = useState(''); // progression du calcul imbrication
  const [currentSheetIndex, setCurrentSheetIndex] = useState(0);
  const [allowRotation, setAllowRotation] = useState(true);
  const [allowMove, setAllowMove] = useState(false);
  const [autoCrop, setAutoCrop] = useState(true);

  // ── Modal optimal ──
  const [showOptimalModal, setShowOptimalModal] = useState(false);
  const [optimalPanel, setOptimalPanel] = useState([]);
  const [optimalFilters, setOptimalFilters] = useState({ massicot: true, imbrique: true, imbrication: true });
  const [isOptimalRunning, setIsOptimalRunning] = useState(false);
  const [optimalProgress, setOptimalProgress] = useState(''); // texte progression
  const optimalCacheRef = useRef({});
  const optimalStopRef = useRef(false);
  const calcStopRef = useRef(false);
  const [modalPos, setModalPos] = useState({ x: 0, y: 80 });
  const modalDragRef = useRef(null);

  // ── Alerte erreur ──
  const [errorAlert, setErrorAlert] = useState(null); // { title, message, solution }
  const [quantityWarning, setQuantityWarning] = useState(null); // { totalQty, action }

  const formats = PRODUCT_FORMATS[productMode] || {};
  const sheetSize = formats[selectedFormat] || { w: 575, h: 420 };

  // ── Fermer le chooser de variantes dès qu'on fait une action ──
  useEffect(() => {
    if (variantsChooser) setVariantsChooser(null);
  }, [files, selectedFormat, margin, impositionMode, allowRotation, isCalculating, showOptimalModal]);

  // ── Rognage automatique des nouveaux fichiers à l'ouverture ──
  useEffect(() => {
    if (!autoCrop) return;
    const uncropped = files.filter(f => !f.cropped);
    if (uncropped.length === 0) return;
    uncropped.forEach(f => cropFile(f.id));
  }, [files, autoCrop]);

  // ── Upload d'un fichier vers /api/upload ──
  const uploadFile = async (file, current, total) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!response.ok) throw new Error(`Erreur serveur ${response.status}`);
    return await response.json();
  };

  // ── Gestion des fichiers selectionnes ──
  const handleFiles = useCallback(async (fileList) => {
    const validFiles = Array.from(fileList).filter(f =>
      /\.(pdf|tiff?|png)$/i.test(f.name) || f.type === 'application/pdf' || f.type === 'image/tiff' || f.type === 'image/png'
    );
    if (validFiles.length === 0) return;

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      try {
        // Phase 1 : chargement
        setUploadStatus({ step: 'Chargement...', fileName: file.name, current: i + 1, total: validFiles.length });

        // Phase 2 : conversion ICC
        setUploadStatus({ step: 'Conversion ICC en cours...', fileName: file.name, current: i + 1, total: validFiles.length });

        const result = await uploadFile(file, i + 1, validFiles.length);

        if (result.error) {
          console.error(`Erreur upload ${file.name}:`, result.error);
          setErrorAlert({ title: 'Erreur d\'envoi', message: `Le fichier "${file.name}" n'a pas pu etre traite : ${result.error}`, solution: 'Verifiez le format du fichier (PDF, TIFF, PNG). Si le probleme persiste, contactez Printmytransfer au 04 76 36 61 15.' });
          continue;
        }

        // Phase 3 : finalisation
        setUploadStatus({ step: 'Finalisation...', fileName: file.name, current: i + 1, total: validFiles.length });

        setFiles(prev => [...prev, {
          id: result.id,
          name: result.name,
          type: result.type,
          width: result.width_mm,
          height: result.height_mm,
          widthPx: result.width_px,
          heightPx: result.height_px,
          hasAlpha: result.has_alpha,
          iccProfile: result.icc_profile,
          iccSource: result.icc_source,
          thumbnailUrl: result.thumbnail_url,
          quantity: 1,
        }]);
      } catch (err) {
        console.error(`Erreur upload ${file.name}:`, err);
        if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
          setErrorAlert({ title: 'Connexion perdue', message: `Impossible d'envoyer "${file.name}".`, solution: 'Verifiez votre connexion internet et reessayez.' });
        } else {
          setErrorAlert({ title: 'Erreur serveur', message: `Erreur lors de l'envoi de "${file.name}" : ${err.message}`, solution: 'Reessayez dans quelques instants. Si le probleme persiste, contactez Printmytransfer au 04 76 36 61 15.' });
        }
      }
    }
    setUploadStatus(null);
  }, []);

  // ── Drag & Drop ──
  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback(() => setIsDragging(false), []);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  // ── Input file change ──
  const handleFileInput = useCallback((e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  }, [handleFiles]);

  // ── Modifier quantite ──
  const updateQuantity = (id, delta) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, quantity: Math.max(1, f.quantity + delta) } : f));
    resetPlanche();
  };

  // ── Modifier dimension (largeur ou hauteur) ──
  const updateDimension = (id, field, value) => {
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0) {
      setFiles(prev => prev.map(f => f.id === id ? { ...f, [field]: num } : f));
      resetPlanche();
    }
  };

  // ── Supprimer un fichier ──
  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    resetPlanche();
  };

  // ── Remettre la planche à zéro (sans toucher aux fichiers) ──
  const resetPlanche = () => { setSheets([]); setStats(null); setImpositionErrors([]); setCurrentSheetIndex(0); };

  // ── Rogner un fichier (auto-crop via serveur ImageMagick) ──
  const cropFile = useCallback(async (id, force = false) => {
    const f = files.find(x => x.id === id);
    if (!f || (!force && f.cropped)) return;
    try {
      console.log('[crop] Rognage de', f.name, '(id:', id, ')');
      const resp = await fetch(`/api/upload/trim/${id}`);
      if (!resp.ok) throw new Error(`Trim error ${resp.status}`);
      const data = await resp.json();
      console.log('[crop] Resultat:', data);
      setFiles(p => p.map(ff => ff.id !== id ? ff : {
        ...ff,
        width: data.trimmed.width_mm,
        height: data.trimmed.height_mm,
        widthPx: data.pixels.cropW,
        heightPx: data.pixels.cropH,
        thumbnailUrl: data.thumbnail_url,
        cropped: true,
      }));
      resetPlanche();
    } catch (err) {
      console.error('Erreur rognage:', err);
      setFiles(p => p.map(ff => ff.id !== id ? ff : { ...ff, cropped: true }));
    }
  }, [files]);

  // ── Rogner tous les fichiers (force = true pour re-rogner même si déjà fait) ──
  const cropAll = useCallback(() => {
    files.forEach(f => cropFile(f.id, true));
  }, [files, cropFile]);

  // ── Tout effacer ──
  const clearAll = () => { setFiles([]); resetPlanche(); };

  // ── Lancer l'imposition ──
  const handleMonter = async (force = false) => {
    // Si calcul en cours → arrêter
    if (isCalculating) {
      calcStopRef.current = true;
      terminatePixelWorker();
      setIsCalculating(false);
      return;
    }
    if (files.length === 0) return;
    // Protection : avertissement si quantité élevée
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
    // Timeout de sécurité : 60 secondes
    const calcTimeout = setTimeout(() => {
      calcStopRef.current = true;
      terminatePixelWorker();
      setIsCalculating(false);
      setErrorAlert({ title: 'Calcul trop long', message: 'Le calcul a d\u00e9pass\u00e9 60 secondes et a \u00e9t\u00e9 interrompu.', solution: 'R\u00e9duisez les quantit\u00e9s ou utilisez un format plus grand. Si le probl\u00e8me persiste, contactez Printmytransfer au 04 76 36 61 15.' });
    }, 60000);
    try {
      // Mapper les fichiers pour l'API imposition.js
      const mappedFiles = files.map(f => ({
        id: f.id,
        name: f.name,
        width_mm: f.width,
        height_mm: f.height,
        quantity: f.quantity,
        thumbnailUrl: f.thumbnailUrl,
      }));
      const activeTab = allowRotation ? 'compact' : 'norotate';
      const result = await launchImposition({
        files: mappedFiles,
        sheetSize,
        margin,
        impositionMode,
        activeTab,
        stopRef: calcStopRef,
        onAskMoreVariants: (runs, variants, isComplete) => {
          const mappedVariants = variants.map((v, i) => ({ items: v.items, label: v.label || `Variante ${i + 1}` }));
          setVariantsChooser(prev => {
            const idx = prev?.currentIdx || 0;
            // Afficher la variante sélectionnée dans la planche
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
      // Recalculer made avec arrondi format
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

  // ── Remplir (1 seul fichier) : calcule la qté max puis lance l'imposition ──
  const handleRemplir = async () => {
    if (files.length !== 1) return;
    const f = files[0];
    const activeTab = allowRotation ? 'compact' : 'norotate';
    const qty = fillPageWithImage({
      files: [{ ...f, width_mm: f.width, height_mm: f.height }],
      sheetSize,
      margin,
      impositionMode,
      activeTab,
    });
    if (qty && qty > 0) {
      // Mettre à jour la quantité
      const updatedFiles = files.map(file => file.id === f.id ? { ...file, quantity: qty } : file);
      setFiles(updatedFiles);
      // Lancer l'imposition automatiquement avec les fichiers mis à jour
      setIsCalculating(true);
      setSheets([]);
      setStats(null);
      setImpositionErrors([]);
      setCurrentSheetIndex(0);
      try {
        const mappedFiles = updatedFiles.map(ff => ({
          id: ff.id, name: ff.name, width_mm: ff.width, height_mm: ff.height,
          quantity: ff.quantity, thumbnailUrl: ff.thumbnailUrl,
        }));
        const result = await launchImposition({ files: mappedFiles, sheetSize, margin, impositionMode, activeTab });
        setSheets(result.sheets || []);
        setStats(result.stats || null);
        setImpositionErrors(result.errors || []);
      } catch (err) {
        console.error('Erreur imposition:', err);
        setErrorAlert({ title: 'Erreur de calcul', message: err.message || String(err), solution: 'Si le probleme persiste, contactez Printmytransfer au 04 76 36 61 15.' });
      } finally {
        setIsCalculating(false);
      }
    }
  };

  // ── Lancer le calcul optimal (toutes combinaisons modes x formats) ──
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

    // Filtrer les formats valides (l'image doit tenir)
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
    // Timeout de sécurité : 120 secondes pour l'optimal (teste plusieurs combinaisons)
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
          const activeTab = 'compact'; // teste toutes les combinaisons tri/orientation
          const tCalc = performance.now();
          try {
            console.log(`[optimal] >> ${mode} / ${fmtName} (${fmtDim.w}x${fmtDim.h})...`);
            const result = await launchImposition({
              files: mappedFiles,
              sheetSize: fmtDim,
              margin,
              impositionMode: mode,
              activeTab,
              stopRef: optimalStopRef,
              onProgress: (msg) => setOptimalProgress(`${modeLabel} / ${fmtName} — ${msg}`),
            });
            const runs = result.stats?.totalSheets || 0;
            const dt = (performance.now() - tCalc).toFixed(0);
            console.log(`[optimal] << ${mode} / ${fmtName} = ${runs} planches (${dt}ms) | items/planche: ${result.sheets[0]?.items?.length || 0}`);

            if (runs > 0) {
              // Calcul prix
              const cleanName = fmtName.replace('+', '');
              const priceName = cleanName === 'M1' ? '1M' : cleanName;
              const nb = isSeri ? runs : roundToMultiple(runs, priceName);
              const pu = table ? getPrixUnitaire(priceName, nb, table) : null;
              const totalHT = pu ? pu * nb : null;

              console.log(`[optimal]    prix: ${priceName} x${nb} (arrondi ${runs}->${nb}) @ ${pu}€/u = ${totalHT?.toFixed(2) || '?'}€ HT`);

              const entry = { mode, fmtName, priceName, fmtDim, runs, nb, pu: pu || 0, totalHT: totalHT || 0 };
              results.push(entry);

              // Cache le résultat pour restauration rapide
              const cacheKey = `${mode}_${fmtName}`;
              optimalCacheRef.current[cacheKey] = {
                sheets: result.sheets.map(s => ({ ...s, items: s.items.map(it => ({ ...it })) })),
                stats: { ...result.stats, details: result.stats.details ? [...result.stats.details] : [] },
              };
              setOptimalPanel([...results]);

              // Mise à jour preview en temps réel
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
          await new Promise(r => setTimeout(r, 0)); // laisser le rendu respirer
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

  // ── Appliquer un résultat optimal (clic sur ligne du tableau) ──
  const applyOptimalResult = async (entry) => {
    // Mettre à jour le mode et le format
    setImpositionMode(entry.mode);
    // Trouver le nom du format dans les formats du produit actuel
    const fmts = PRODUCT_FORMATS[productMode];
    if (fmts[entry.fmtName]) {
      setSelectedFormat(entry.fmtName);
    }
    // Restaurer depuis le cache
    const cacheKey = `${entry.mode}_${entry.fmtName}`;
    const cached = optimalCacheRef.current[cacheKey];
    if (cached) {
      setSheets(cached.sheets);
      setStats(cached.stats);
      setImpositionErrors([]);
      setCurrentSheetIndex(0);
    }
  };

  // ── Calcul du total exemplaires ──
  const totalExemplaires = stats ? stats.totalSheets : 0;
  const currentSheet = sheets[currentSheetIndex] || null;

  // ── Scale homothétique de la planche ──
  const previewRef = useRef(null);
  const [previewScale, setPreviewScale] = useState(1);

  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;
    const computeScale = () => {
      const padding = 16; // marge de sécurité en px
      const availW = container.clientWidth - padding * 2;
      const availH = container.clientHeight - padding * 2;
      if (availW <= 0 || availH <= 0) return;
      const scale = Math.min(availW / sheetSize.w, availH / sheetSize.h);
      setPreviewScale(scale);
    };
    computeScale();
    const ro = new ResizeObserver(computeScale);
    ro.observe(container);
    return () => ro.disconnect();
  }, [sheetSize.w, sheetSize.h]);

  // ── Utilitaire : injecter DPI dans PNG (pHYs chunk) ──
  const pngSetDpi = (dataUrl, dpi) => {
    const base64 = dataUrl.split(',')[1];
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const ppm = Math.round(dpi / 0.0254);
    const phys = new Uint8Array(21);
    const dv = new DataView(phys.buffer);
    dv.setUint32(0, 9);
    phys[4] = 0x70; phys[5] = 0x48; phys[6] = 0x59; phys[7] = 0x73;
    dv.setUint32(8, ppm); dv.setUint32(12, ppm); phys[16] = 1;
    const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
    let crc = 0xFFFFFFFF;
    for (let i = 4; i <= 16; i++) crc = crcTable[(crc ^ phys[i]) & 0xFF] ^ (crc >>> 8);
    crc ^= 0xFFFFFFFF;
    dv.setUint32(17, crc >>> 0);
    const insertPos = 33;
    let cleanBytes = bytes;
    let pos = 8;
    while (pos < cleanBytes.length - 12) {
      const chunkLen = (cleanBytes[pos] << 24) | (cleanBytes[pos+1] << 16) | (cleanBytes[pos+2] << 8) | cleanBytes[pos+3];
      const chunkType = String.fromCharCode(cleanBytes[pos+4], cleanBytes[pos+5], cleanBytes[pos+6], cleanBytes[pos+7]);
      if (chunkType === 'pHYs') { const before = cleanBytes.slice(0, pos); const after = cleanBytes.slice(pos + 12 + chunkLen); const merged = new Uint8Array(before.length + after.length); merged.set(before); merged.set(after, before.length); cleanBytes = merged; break; }
      pos += 12 + chunkLen;
    }
    const result = new Uint8Array(cleanBytes.length + phys.length);
    result.set(cleanBytes.slice(0, insertPos)); result.set(phys, insertPos); result.set(cleanBytes.slice(insertPos), insertPos + phys.length);
    let binStr = ''; for (let i = 0; i < result.length; i++) binStr += String.fromCharCode(result[i]);
    return 'data:image/png;base64,' + btoa(binStr);
  };

  // ── Utilitaire : pivoter une image 90° ──
  const rotateImage = (src, w, h) => {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas'), scale = 4;
        canvas.width = h * scale; canvas.height = w * scale;
        const ctx = canvas.getContext('2d');
        ctx.translate((h * scale) / 2, (w * scale) / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(img, -(w * scale) / 2, -(h * scale) / 2, w * scale, h * scale);
        res(canvas.toDataURL('image/png'));
      };
      img.src = src;
    });
  };

  // ── Export 1 : Montage PNG 300 DPI ──
  const handleExportPNG = async () => {
    if (sheets.length === 0) return;
    setIsCalculating(true);
    try {
      const sheet = sheets[currentSheetIndex];
      const exportItems = sheet.items.map(item => ({
        file_id: item.fileId,
        x: item.x + margin,
        y: item.y + margin,
        realW: item.rotated ? item.realH : item.realW,
        realH: item.rotated ? item.realW : item.realH,
        rotated: item.rotated,
      }));
      const resp = await fetch('/api/export/dessin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet_size: sheetSize, items: exportItems }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `montage-${productMode}-${selectedFormat}-dessin.png`;
      link.href = url; link.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error('Erreur Export PNG:', err); }
    finally { setIsCalculating(false); }
  };

  // ── Export 2 : Coupe PDF (traits de coupe vectoriels) ──
  const handleExportCut = async () => {
    if (sheets.length === 0) return;
    setIsCalculating(true);
    try {
      const sheet = sheets[currentSheetIndex];
      const exportItems = sheet.items.map(item => ({
        file_id: item.fileId,
        x: item.x + margin,
        y: item.y + margin,
        realW: item.rotated ? item.realH : item.realW,
        realH: item.rotated ? item.realW : item.realH,
        rotated: item.rotated,
      }));
      const resp = await fetch('/api/export/coupe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet_size: sheetSize, items: exportItems, margin }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `montage-${productMode}-${selectedFormat}-coupe.pdf`;
      link.href = url; link.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error('Erreur Export Coupe:', err); }
    finally { setIsCalculating(false); }
  };

  // ── Export 3 : Composite PDF basse définition (images + traits de coupe) ──
  const handleExportComposite = async () => {
    if (sheets.length === 0) return;
    setIsCalculating(true);
    try {
      const sheet = sheets[currentSheetIndex];
      const exportItems = sheet.items.map(item => ({
        file_id: item.fileId,
        x: item.x + margin,
        y: item.y + margin,
        realW: item.rotated ? item.realH : item.realW,
        realH: item.rotated ? item.realW : item.realH,
        rotated: item.rotated,
      }));
      const resp = await fetch('/api/export/composite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sheet_size: sheetSize, items: exportItems, margin }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `montage-${productMode}-${selectedFormat}-composite.pdf`;
      link.href = url; link.click();
      URL.revokeObjectURL(url);
    } catch (err) { console.error('Erreur Export Composite:', err); }
    finally { setIsCalculating(false); }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-200">

      {/* ── Filtre SVG pour outline rose en mode imbrication (identique PMT) ── */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <filter id="outline-effect">
            <feMorphology in="SourceAlpha" result="DILATED" operator="dilate" radius={Math.max(1, Math.ceil(margin / 2))} />
            <feFlood floodColor="#fbcfe8" result="PINK" />
            <feComposite in="PINK" in2="DILATED" operator="in" result="OUTLINE" />
            <feMerge>
              <feMergeNode in="OUTLINE" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      {/* ══════════════════════════════════════════════════════ */}
      {/*  SIDEBAR                                              */}
      {/* ══════════════════════════════════════════════════════ */}
      <aside className="w-[420px] bg-white border-r border-gray-300 flex flex-col shadow-lg z-10 flex-shrink-0">

        {/* ── Header vert ── */}
        <div className="p-4 bg-green-700 text-white text-center flex-shrink-0">
          <h1 className="text-lg font-bold uppercase tracking-wider">Montage Automatique</h1>
          <h2 className="text-xl font-bold text-white mt-1">by Printmytransfer</h2>
          <div className="mt-2 flex flex-col gap-1">
            <div className="flex justify-center gap-1">
              {Object.keys(PRODUCT_FORMATS).map(m => (
                <button key={m} onClick={() => { setProductMode(m); setSelectedFormat(Object.keys(PRODUCT_FORMATS[m])[0]); resetPlanche(); }}
                  className={`px-2 py-1 rounded text-[10px] font-bold transition-all
                    ${productMode === m ? 'bg-white text-green-800 shadow' : 'bg-green-600 text-white hover:bg-green-500'}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Parametres feuille ── */}
        <div className="flex-shrink-0 border-b border-gray-200 bg-white">
          <div className="p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-600 w-16">Format</span>
              <select value={selectedFormat} onChange={e => { setSelectedFormat(e.target.value); resetPlanche(); }}
                className="flex-1 text-xs border border-gray-300 rounded px-2 py-1.5 bg-white">
                {Object.entries(formats).map(([name, size]) => (
                  <option key={name} value={name}>{name} ({size.w} x {size.h} mm)</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-600 w-16">Bordure</span>
              <input type="range" min="0" max="10" step="0.5" value={margin}
                onChange={e => { setMargin(parseFloat(e.target.value)); resetPlanche(); }}
                className="flex-1 accent-green-600" />
              <span className="text-xs font-bold text-gray-700 w-12 text-right">{margin} mm</span>
            </div>
          </div>
        </div>

        {/* ── Modes d'imposition ── */}
        <div className="p-2 bg-gray-50 border-b border-gray-300 shadow-md z-20 flex-shrink-0">
          <div className="flex gap-2">
            <button onClick={() => { setImpositionMode('massicot'); resetPlanche(); }}
              className={`flex-1 h-[50px] flex flex-col items-center justify-center border-2 rounded transition-all
                ${impositionMode === 'massicot' ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}>
              <Icons.Layout />
              <span className="font-bold text-[14px] mt-0.5">Massicotable</span>
            </button>
            <button onClick={() => { setImpositionMode('imbrique'); resetPlanche(); }}
              className={`flex-1 h-[50px] flex flex-col items-center justify-center border-2 rounded transition-all
                ${impositionMode === 'imbrique' ? 'border-purple-600 bg-purple-50 text-purple-700 shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}>
              <Icons.Scissors />
              <span className="font-bold text-[14px] mt-0.5">Non Massicotable</span>
            </button>
            <button onClick={() => { setImpositionMode('imbrication'); resetPlanche(); }}
              className={`flex-1 h-[50px] flex flex-col items-center justify-center border-2 rounded transition-all
                ${impositionMode === 'imbrication' ? 'border-orange-600 bg-orange-50 text-orange-700 shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}>
              <Icons.Puzzle />
              <span className="font-bold text-[14px] mt-0.5">Imbrication</span>
            </button>
          </div>
        </div>

        {/* ── Barre fichiers ── */}
        <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex-shrink-0">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <button onClick={handleRemplir}
                className={`text-xs flex items-center gap-1.5 font-bold px-2 py-1 rounded transition-colors
                ${files.length === 1 ? 'text-blue-600 hover:text-blue-800 hover:bg-blue-50' : 'text-gray-300 cursor-not-allowed'}`}>
                <Icons.Copy /> REMPLIR
              </button>
              <button onClick={cropAll} disabled={files.length === 0}
                className={`text-xs flex items-center gap-1.5 font-bold px-2 py-1 rounded transition-colors
                ${files.length > 0 ? 'text-green-600 hover:text-green-800 hover:bg-green-50' : 'text-gray-300 cursor-not-allowed'}`}>
                <Icons.Crop size={12} /> TOUT ROGNER
              </button>
              <label className="flex items-center gap-1 cursor-pointer select-none">
                <input type="checkbox" checked={autoCrop} onChange={e => setAutoCrop(e.target.checked)}
                  className="w-3 h-3 accent-green-600" />
                <span className="text-[10px] text-gray-500">Rogner a l&apos;ouverture</span>
              </label>
            </div>
            <button onClick={clearAll}
              className={`text-xs flex items-center gap-1.5 font-bold px-2 py-1 rounded transition-colors
                ${files.length > 0 ? 'text-red-500 hover:text-red-700 hover:bg-red-50' : 'text-gray-300 cursor-not-allowed'}`}>
              <Icons.Trash /> TOUT EFFACER
            </button>
          </div>
        </div>

        {/* ── Zone fichiers ── */}
        <div className={`flex-1 overflow-y-auto bg-green-50 p-3 space-y-3 relative custom-scrollbar pb-6
          ${isDragging ? 'ring-4 ring-inset ring-green-400 bg-green-100' : ''}`}
          onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>

          {files.length === 0 && !uploadStatus && (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 pointer-events-none select-none" style={{ minHeight: 200 }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span className="text-lg font-semibold mt-3 text-gray-500">Deposez vos fichiers ici</span>
              <span className="text-xs text-gray-400 mt-1">PDF, TIFF, PNG</span>
            </div>
          )}

          {/* ── Liste des fichiers uploades (style PMT) ── */}
          {files.map(f => (
            <div key={f.id} className="bg-white border border-gray-200 rounded-lg shadow-sm p-2 flex gap-3 items-start hover:shadow-md transition-shadow">
              {/* Miniature */}
              <div className="w-[80px] h-[80px] flex-shrink-0 bg-gray-100 rounded overflow-hidden flex items-center justify-center border border-gray-200">
                <img src={f.thumbnailUrl} alt={f.name}
                  className={`max-w-full max-h-full object-contain `} />
              </div>
              {/* Infos */}
              <div className="flex-1 min-w-0">
                {/* Ligne 1 : nom + icones */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-800 truncate">{f.name}</span>
                  <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                    <button onClick={() => cropFile(f.id, true)} className="text-gray-400 hover:text-green-600 transition-colors p-0.5">
                      <Icons.Crop size={12} />
                    </button>
                    <button onClick={() => removeFile(f.id)}
                      className="text-gray-400 hover:text-red-500 transition-colors p-0.5">
                      <Icons.X size={14} />
                    </button>
                  </div>
                </div>
                {/* Ligne 2 : LARG. HAUT. QTE */}
                <div className="flex items-end gap-2 mt-2">
                  <div className="flex-1">
                    <div className="text-[10px] font-bold text-gray-500 uppercase">Larg.</div>
                    <input type="number" value={f.width} step="1" min="1"
                      onChange={e => updateDimension(f.id, 'width', e.target.value)}
                      className="w-full text-sm font-bold text-green-600 border border-gray-200 rounded px-1.5 py-1 bg-gray-50 focus:border-green-400 focus:outline-none" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] font-bold text-gray-500 uppercase">Haut.</div>
                    <input type="number" value={f.height} step="1" min="1"
                      onChange={e => updateDimension(f.id, 'height', e.target.value)}
                      className="w-full text-sm font-bold text-green-600 border border-gray-200 rounded px-1.5 py-1 bg-gray-50 focus:border-green-400 focus:outline-none" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] font-bold text-gray-500 uppercase">Qte</div>
                    <div className="flex items-center border border-gray-200 rounded bg-white">
                      <input type="number" value={f.quantity} min="0"
                        onFocus={e => e.target.select()}
                        onChange={e => {
                          const v = Math.abs(parseInt(e.target.value)) || 0;
                          setFiles(prev => prev.map(ff => ff.id === f.id ? { ...ff, quantity: v } : ff));
                          resetPlanche();
                        }}
                        className="w-full text-sm font-bold text-gray-800 px-1.5 py-1 bg-white focus:outline-none rounded-l" />
                      <div className="flex flex-col border-l border-gray-200 h-full">
                        <button onClick={() => { setFiles(prev => prev.map(ff => ff.id === f.id ? { ...ff, quantity: ff.quantity + 1 } : ff)); resetPlanche(); }}
                          className="px-1 py-0 hover:bg-gray-100 text-gray-500 text-[8px] leading-[14px]">
                          <Icons.ArrowUp />
                        </button>
                        <button onClick={() => { setFiles(prev => prev.map(ff => ff.id === f.id ? { ...ff, quantity: Math.max(0, ff.quantity - 1) } : ff)); resetPlanche(); }}
                          className="px-1 py-0 hover:bg-gray-100 text-gray-500 text-[8px] leading-[14px] border-t border-gray-200">
                          <Icons.ArrowDown />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Profil ICC + alpha */}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] text-gray-400">{f.iccSource || 'Profil inconnu'}</span>
                  {f.hasAlpha && <span className="text-[9px] text-pink-500 font-bold">alpha</span>}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Boutons bas (Upload + Monter) ── */}
        <div className="p-4 border-t border-gray-200 bg-gray-50 flex-shrink-0 flex gap-2">
          <label className={`flex-1 h-[60px] flex flex-col items-center justify-center border-2 border-dashed rounded-lg cursor-pointer transition-colors shadow-sm
            ${files.length === 0 ? 'bg-green-100 border-green-500 text-green-700 animate-pulse-fast hover:bg-green-200' : 'bg-white border-gray-300 text-gray-700 hover:bg-white hover:border-blue-400'}`}>
            <Icons.Upload />
            <span className="font-bold text-[11px] mt-1 text-gray-900 text-center leading-tight">Fichiers PDF, TIFF, PNG</span>
            <input ref={fileInputRef} type="file" className="hidden" multiple
              accept="application/pdf,.pdf,.tiff,.tif,.png,image/tiff,image/png"
              onChange={handleFileInput} />
          </label>
          <button onClick={handleMonter} disabled={files.length === 0 && !isCalculating}
            className={`flex-1 h-[60px] flex flex-col items-center justify-center border-2 rounded-lg transition-all
            ${isCalculating ? 'bg-red-600 border-red-700 text-white hover:bg-red-700 shadow-md transform hover:scale-[1.02] animate-pulse-fast cursor-pointer' : files.length > 0 ? 'bg-green-600 border-green-700 text-white hover:bg-green-700 shadow-md transform hover:scale-[1.02] animate-pulse-fast' : 'bg-gray-200 border-gray-300 text-gray-400 cursor-not-allowed'}`}>
            {isCalculating ? <Icons.Loader size={18} /> : <Icons.Refresh />}
            <span className="font-bold text-xs mt-1">{isCalculating ? 'Arrêter' : 'Monter'}</span>
          </button>
        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════ */}
      {/*  ZONE PRINCIPALE                                      */}
      {/* ══════════════════════════════════════════════════════ */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">

        {/* ── Barre header ── */}
        <div className="h-[220px] bg-white border-b border-gray-300 flex shadow-sm z-10 flex-shrink-0">
          {/* Colonne 1 : Tirage */}
          <div className="w-[180px] border-r border-gray-200 flex flex-col items-center justify-start p-3 bg-gray-50 flex-shrink-0">
            <div className="w-full px-3 py-2 bg-gray-400 text-white text-sm font-bold rounded shadow text-center cursor-not-allowed">
              Accueil
            </div>
            <div className="flex items-baseline gap-1 mt-2">
              <span className="text-4xl font-bold text-blue-600">{totalExemplaires}</span>
              <span className="text-xs text-gray-500">exemplaires</span>
              <span className="text-2xl font-bold text-gray-700">{selectedFormat}</span>
            </div>
            <button onClick={() => { if (files.length > 0) { setShowOptimalModal(true); setOptimalPanel([]); } }}
              disabled={files.length === 0}
              className={`mt-3 px-5 py-2 text-sm font-bold rounded-full shadow transition-colors
              ${files.length > 0 ? 'bg-green-600 hover:bg-green-700 text-white animate-pulse-fast' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
              Voir les montages les plus economiques
            </button>
          </div>

          {/* Colonne 2 : Exports + Details */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-2 border-b border-gray-100">
              <div className="flex gap-1">
                <button onClick={handleExportCut} disabled={sheets.length === 0}
                  className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1 font-bold text-[9px] transition-all ${sheets.length > 0 ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                  <Icons.Scissors /> Coupe
                </button>
                <button onClick={handleExportComposite} disabled={sheets.length === 0}
                  className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1 font-bold text-[9px] transition-all ${sheets.length > 0 ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                  <Icons.Layers /> Composite
                </button>
                <button onClick={handleExportPNG} disabled={sheets.length === 0}
                  className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1 font-bold text-[9px] transition-all ${sheets.length > 0 ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                  <Icons.Download /> Charger le PNG dans mon espace
                </button>
              </div>
            </div>
            {/* Grille details fichiers */}
            <div className="flex-1 p-2 overflow-hidden">
              <div className="grid grid-cols-3 gap-2 overflow-y-auto h-full content-start pr-0.5">
                {files.length === 0 ? (
                  <div className="col-span-3 flex items-center justify-center h-full text-gray-400 text-sm">
                    Aucun fichier
                  </div>
                ) : stats && stats.details ? (
                  stats.details.map(d => (
                    <div key={d.id} className="bg-white border border-gray-200 rounded p-1.5 flex gap-2 shadow-sm h-[60px] items-center">
                      <div className="w-[40px] h-[40px] flex-shrink-0 bg-gray-50 rounded overflow-hidden flex items-center justify-center">
                        <img src={d.src} alt={d.name} className="max-w-full max-h-full object-contain" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-bold text-gray-700 truncate">{d.name}</div>
                        <div className="text-gray-600 flex justify-between leading-tight" style={{ fontSize: '13px' }}>
                          <span>{d.req} cmd</span>
                          <span className="font-bold">{d.made} fab</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-0.5 mt-0.5">
                          <div className={`h-0.5 rounded-full ${d.made >= d.req ? 'bg-green-500' : 'bg-blue-500'}`}
                            style={{ width: `${Math.min(100, (d.made / d.req) * 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  files.map(f => (
                    <div key={f.id} className="bg-white border border-gray-200 rounded p-1 flex gap-1.5 shadow-sm h-[56px] items-center">
                      <div className="w-[40px] h-[40px] flex-shrink-0 bg-gray-50 rounded overflow-hidden flex items-center justify-center">
                        <img src={f.thumbnailUrl} alt={f.name} className="max-w-full max-h-full object-contain" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[9px] font-bold text-gray-700 truncate">{f.name}</div>
                        <div className="text-[8px] text-gray-400">{f.width}x{f.height}mm</div>
                        <div className="text-[8px] text-gray-500">x{f.quantity}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Options rotation ── */}
        <div className="w-full flex justify-center border-b border-gray-300 bg-gray-200 py-2 z-20 flex-shrink-0">
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm font-bold text-gray-700 cursor-pointer select-none">
              <input type="checkbox" checked={allowRotation} onChange={e => { setAllowRotation(e.target.checked); resetPlanche(); }}
                className="w-4 h-4 accent-blue-600" />
              Autoriser la rotation
            </label>
            <label className="flex items-center gap-2 text-sm font-bold text-gray-700 cursor-pointer select-none">
              <input type="checkbox" checked={allowMove} onChange={e => setAllowMove(e.target.checked)}
                className="w-4 h-4 accent-orange-600" />
              cocher la case pour deplacer ou tourner les dessins (double clic)
            </label>
          </div>
        </div>

        {/* ── Zone preview ── */}
        <div ref={previewRef} className="flex-1 relative w-full overflow-hidden">
          {/* Overlay horloge pendant calcul */}
          {(isOptimalRunning || isCalculating) && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center text-center pointer-events-none">
              <div className="animate-spin-slow text-green-800 mb-3">
                <svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
                  <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
                </svg>
              </div>
              {isOptimalRunning && optimalProgress && (
                <div className="text-sm font-mono text-gray-700 bg-white bg-opacity-90 px-4 py-2 rounded shadow">
                  {optimalProgress}
                </div>
              )}
              {isCalculating && !isOptimalRunning && (
                <div className="text-sm font-mono text-gray-700 bg-white bg-opacity-90 px-4 py-2 rounded shadow">
                  {calcProgress || 'Calcul en cours...'}
                </div>
              )}
            </div>
          )}
          <div className="w-full h-full flex flex-col items-center justify-center">
            {/* Navigation planches */}
            {sheets.length > 1 && (
              <div className="flex items-center gap-3 mb-2 flex-shrink-0">
                <button onClick={() => setCurrentSheetIndex(Math.max(0, currentSheetIndex - 1))}
                  disabled={currentSheetIndex === 0}
                  className={`px-3 py-1 rounded text-sm font-bold ${currentSheetIndex === 0 ? 'text-gray-300' : 'text-blue-600 hover:bg-blue-50'}`}>
                  ◀
                </button>
                <span className="text-sm font-bold text-gray-700">
                  Planche {currentSheetIndex + 1} / {sheets.length}
                </span>
                <button onClick={() => setCurrentSheetIndex(Math.min(sheets.length - 1, currentSheetIndex + 1))}
                  disabled={currentSheetIndex === sheets.length - 1}
                  className={`px-3 py-1 rounded text-sm font-bold ${currentSheetIndex === sheets.length - 1 ? 'text-gray-300' : 'text-blue-600 hover:bg-blue-50'}`}>
                  ▶
                </button>
              </div>
            )}
            {/* Planche (scalée homothétiquement) */}
            <div style={{ width: `${sheetSize.w * previewScale}px`, height: `${sheetSize.h * previewScale}px` }}>
            <div className="relative bg-white shadow-xl"
              style={{
                width: `${sheetSize.w}px`,
                height: `${sheetSize.h}px`,
                transform: `scale(${previewScale})`,
                transformOrigin: 'top left',
              }}>
              <div className="w-full h-full relative overflow-hidden border border-gray-300">
                {/* Fond vide ou message d'erreur centré */}
                {!currentSheet && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
                    {impositionErrors.length > 0 ? (
                      <div className="text-red-500 font-bold text-center px-4"
                        style={{ fontSize: `${Math.max(14, 18 / previewScale)}px` }}>
                        {impositionErrors.map((e, i) => <div key={i}>{e}</div>)}
                      </div>
                    ) : (
                      <div className="text-gray-300"
                        style={{ fontSize: `${Math.max(12, 16 / previewScale)}px` }}>
                        {sheetSize.w} x {sheetSize.h} mm
                      </div>
                    )}
                  </div>
                )}
                {/* Items positionnes — structure identique à PMT */}
                {currentSheet && currentSheet.items.map((item, idx) => {
                  const isImbrication = impositionMode === 'imbrication';
                  return (
                    <div key={idx}
                      className={`absolute flex items-center justify-center ${isImbrication ? 'overflow-visible' : 'overflow-hidden'}`}
                      style={{
                        left: `${item.x}px`,
                        top: `${item.y}px`,
                        width: `${item.w}px`,
                        height: `${item.h}px`,
                        zIndex: 10,
                        backgroundColor: isImbrication ? 'transparent' : 'white',
                        cursor: allowMove ? 'move' : 'default',
                      }}
                      onMouseDown={allowMove ? (e) => {
                        e.preventDefault();
                        const startX = e.clientX, startY = e.clientY;
                        const origX = item.x, origY = item.y;
                        const onMove = (ev) => {
                          const dx = (ev.clientX - startX) / previewScale;
                          const dy = (ev.clientY - startY) / previewScale;
                          setSheets(prev => prev.map((s, si) => si !== currentSheetIndex ? s : {
                            ...s, items: s.items.map((it, ii) => ii !== idx ? it : { ...it, x: origX + dx, y: origY + dy })
                          }));
                        };
                        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                        document.addEventListener('mousemove', onMove);
                        document.addEventListener('mouseup', onUp);
                      } : undefined}
                      onDoubleClick={allowMove ? () => {
                        setSheets(prev => prev.map((s, si) => si !== currentSheetIndex ? s : {
                          ...s, items: s.items.map((it, ii) => ii !== idx ? it : { ...it, rotated: !it.rotated, w: it.h, h: it.w })
                        }));
                      } : undefined}>
                      <div className="w-full h-full relative flex items-center justify-center">
                        <div className="flex items-center justify-center relative"
                          style={{
                            width: `${(item.rotated ? item.realH : item.realW) + margin * 2}px`,
                            height: `${(item.rotated ? item.realW : item.realH) + margin * 2}px`,
                          }}>
                          <img src={item.src} alt="" draggable={false}
                            className={`relative z-10 ${!isImbrication ? 'bg-blue-100' : ''} `}
                            style={{
                              width: `${item.realW}px`,
                              height: `${item.realH}px`,
                              maxWidth: 'none',
                              maxHeight: 'none',
                              objectFit: 'fill',
                              transform: item.rotated ? 'rotate(90deg)' : 'none',
                              filter: isImbrication ? 'url(#outline-effect)' : undefined,
                            }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
                {/* Contours rouges autour de chaque image — segments uniques pour éviter les doublons */}
                {currentSheet && (impositionMode === 'massicot' || impositionMode === 'imbrique') && (() => {
                  const items = currentSheet.items;
                  const EPSILON = 0.3;
                  // Collecter tous les segments horizontaux et verticaux
                  const hSegs = new Set(); // "y|x1|x2"
                  const vSegs = new Set(); // "x|y1|y2"
                  items.forEach(item => {
                    const x1 = Math.round(item.x * 10) / 10;
                    const y1 = Math.round(item.y * 10) / 10;
                    const x2 = Math.round((item.x + item.w) * 10) / 10;
                    const y2 = Math.round((item.y + item.h) * 10) / 10;
                    hSegs.add(`${y1}|${x1}|${x2}`); // haut
                    hSegs.add(`${y2}|${x1}|${x2}`); // bas
                    vSegs.add(`${x1}|${y1}|${y2}`); // gauche
                    vSegs.add(`${x2}|${y1}|${y2}`); // droite
                  });
                  const lines = [];
                  hSegs.forEach(seg => {
                    const [y, x1, x2] = seg.split('|').map(Number);
                    lines.push(<div key={`hc-${seg}`} className="absolute pointer-events-none" style={{ left: `${x1}px`, top: `${y}px`, width: `${x2 - x1}px`, height: 0, borderTop: '0.5px solid #dc2626', zIndex: 15 }} />);
                  });
                  vSegs.forEach(seg => {
                    const [x, y1, y2] = seg.split('|').map(Number);
                    lines.push(<div key={`vc-${seg}`} className="absolute pointer-events-none" style={{ left: `${x}px`, top: `${y1}px`, width: 0, height: `${y2 - y1}px`, borderLeft: '0.5px solid #dc2626', zIndex: 15 }} />);
                  });
                  return lines;
                })()}
                {/* Lames de massicot en bleu — coupes traversantes réelles */}
                {currentSheet && impositionMode === 'massicot' && (() => {
                  const items = currentSheet.items;
                  const EPSILON = 0.5;
                  const W = sheetSize.w;
                  const H = sheetSize.h;

                  // Collecter toutes les coordonnées Y et X des bords d'images
                  const allY = new Set();
                  const allX = new Set();
                  items.forEach(item => {
                    allY.add(Math.round(item.y * 10) / 10);
                    allY.add(Math.round((item.y + item.h) * 10) / 10);
                    allX.add(Math.round(item.x * 10) / 10);
                    allX.add(Math.round((item.x + item.w) * 10) / 10);
                  });

                  // Coupes horizontales : un Y est une lame valide si la ligne traverse
                  // toute la largeur sans couper à l'intérieur d'une image
                  const hCuts = Array.from(allY).filter(y => {
                    if (y <= EPSILON || y >= H - EPSILON) return false;
                    // Vérifier qu'aucune image n'est coupée verticalement par cette ligne
                    return !items.some(item => y > item.y + EPSILON && y < item.y + item.h - EPSILON);
                  });

                  // Coupes verticales par bande : après les coupes horizontales, on a des bandes
                  // Pour chaque bande, trouver les coupes verticales valides
                  const sortedH = [0, ...hCuts.sort((a, b) => a - b), H];
                  const vCutSegments = [];

                  for (let bi = 0; bi < sortedH.length - 1; bi++) {
                    const bandTop = sortedH[bi];
                    const bandBot = sortedH[bi + 1];
                    // Items dans cette bande
                    const bandItems = items.filter(item =>
                      item.y >= bandTop - EPSILON && item.y + item.h <= bandBot + EPSILON
                    );
                    if (bandItems.length === 0) continue;

                    // Collecter les X de cette bande
                    const bandX = new Set();
                    bandItems.forEach(item => {
                      bandX.add(Math.round(item.x * 10) / 10);
                      bandX.add(Math.round((item.x + item.w) * 10) / 10);
                    });

                    // Filtrer : X valide si ne coupe aucune image de la bande
                    Array.from(bandX).forEach(x => {
                      if (x <= EPSILON || x >= W - EPSILON) return;
                      const cutsImage = bandItems.some(item => x > item.x + EPSILON && x < item.x + item.w - EPSILON);
                      if (!cutsImage) {
                        vCutSegments.push({ x, top: bandTop, bottom: bandBot });
                      }
                    });
                  }

                  return (
                    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 4 }}>
                      {/* Coupes horizontales traversantes */}
                      {hCuts.map(y => (
                        <div key={`hcut-${y}`} className="absolute left-0 right-0"
                          style={{ top: `${y}px`, borderTop: '1px solid #2563eb' }} />
                      ))}
                      {/* Coupes verticales par bande */}
                      {vCutSegments.map((seg, i) => (
                        <div key={`vcut-${i}`} className="absolute"
                          style={{
                            left: `${seg.x}px`,
                            top: `${seg.top}px`,
                            height: `${seg.bottom - seg.top}px`,
                            borderLeft: '1px solid #2563eb',
                          }} />
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
            </div>
            {/* Infos planche */}
            <div className="flex-shrink-0 mt-2">
              {currentSheet && (
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span><strong>{currentSheet.items.length}</strong> images</span>
                  {currentSheet.copies > 1 && <span>x <strong>{currentSheet.copies}</strong> copies</span>}
                  {currentSheet.efficiency !== 'N/A' && <span>Remplissage: <strong>{currentSheet.efficiency}%</strong></span>}
                </div>
              )}
              {/* Erreurs imposition — vide, affiché au centre de la planche */}
            </div>
          </div>
        </div>
      </main>

      {/* ══════════════════════════════════════════════════════ */}

      {/* ══════════════════════════════════════════════════════ */}
      {/*  MODAL VARIANTES IMBRICATION                          */}


      {/* Fenetre choix variantes imbrication */}
      {variantsChooser && (
        <div className="fixed z-50" style={{ top: '50%', left: '440px', transform: 'translateY(-50%)' }}>
          <div className="bg-white rounded-xl shadow-2xl p-5 text-center border-2 border-green-600" style={{ width: '320px' }}>
            {variantsChooser.searching && (
              <div className="text-sm text-blue-600 mb-2 italic">Je recherche d'autres placements...</div>
            )}
            <div className="text-lg font-bold text-green-700 mb-3">
              {variantsChooser.variants.length} variante{variantsChooser.variants.length > 1 ? 's' : ''} trouvee{variantsChooser.variants.length > 1 ? 's' : ''}
            </div>
            {variantsChooser.variants.length > 1 && (
              <div className="flex items-center justify-center gap-4 mb-4">
                <button onClick={() => {
                    const newIdx = Math.max(0, variantsChooser.currentIdx - 1);
                    setVariantsChooser({ ...variantsChooser, currentIdx: newIdx });
                    setSheets([{ id: newIdx + 1, items: variantsChooser.variants[newIdx].items, copies: variantsChooser.runs, efficiency: 'N/A' }]);
                  }}
                  disabled={variantsChooser.currentIdx === 0}
                  className={`px-3 py-1 rounded text-lg font-bold ${variantsChooser.currentIdx === 0 ? 'text-gray-300' : 'text-blue-600 hover:bg-blue-50'}`}>
                  ◀
                </button>
                <span className="text-sm font-bold text-gray-700">
                  Variante {variantsChooser.currentIdx + 1} / {variantsChooser.variants.length}
                </span>
                <button onClick={() => {
                    const newIdx = Math.min(variantsChooser.variants.length - 1, variantsChooser.currentIdx + 1);
                    setVariantsChooser({ ...variantsChooser, currentIdx: newIdx });
                    setSheets([{ id: newIdx + 1, items: variantsChooser.variants[newIdx].items, copies: variantsChooser.runs, efficiency: 'N/A' }]);
                  }}
                  disabled={variantsChooser.currentIdx === variantsChooser.variants.length - 1}
                  className={`px-3 py-1 rounded text-lg font-bold ${variantsChooser.currentIdx === variantsChooser.variants.length - 1 ? 'text-gray-300' : 'text-blue-600 hover:bg-blue-50'}`}>
                  ▶
                </button>
              </div>
            )}
            <div className="flex gap-3 justify-center">
              {variantsChooser.searching && (
                <button onClick={() => { calcStopRef.current = true; terminatePixelWorker(); }}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-bold text-sm">
                  Arreter
                </button>
              )}
              <button onClick={() => setVariantsChooser(null)}
                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-bold text-sm">
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════ */}
      {/*  MODAL TABLEAU COMPARATIF (optimal)                   */}
      {/* ══════════════════════════════════════════════════════ */}
      {showOptimalModal && (() => {
        const allResults = Array.isArray(optimalPanel) ? optimalPanel : [];
        const activeModes = ['massicot', 'imbrique', 'imbrication'].filter(m => optimalFilters[m]);
        const globalBest = allResults.length > 0 ? Math.min(...allResults.filter(r => r.totalHT > 0).map(r => r.totalHT)) : null;
        const dataByMode = {};
        activeModes.forEach(mode => {
          const entries = allResults.filter(r => r.mode === mode);
          const byFormat = {};
          entries.forEach(e => { if (!byFormat[e.fmtName] || e.nb < byFormat[e.fmtName].nb) byFormat[e.fmtName] = e; });
          dataByMode[mode] = Object.values(byFormat).sort((a, b) => (a.totalHT || 999999) - (b.totalHT || 999999));
        });
        const modeLabels = { massicot: 'Massicotable', imbrique: 'Non massicotable', imbrication: 'Imbrication' };
        const modeColors = { massicot: 'text-blue-700 bg-blue-50', imbrique: 'text-purple-700 bg-purple-50', imbrication: 'text-orange-700 bg-orange-50' };

        return (
          <div className="fixed inset-0 z-[90]" style={{ pointerEvents: 'none' }}>
            <div className="bg-white rounded-lg shadow-2xl border border-gray-200 overflow-hidden absolute"
              style={{ maxHeight: '85vh', width: '640px', pointerEvents: 'auto', left: `${modalPos.x}px`, top: `${modalPos.y}px` }}>
              {/* Header draggable */}
              <div className="bg-green-700 text-white px-6 py-3 relative text-center cursor-grab active:cursor-grabbing select-none"
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startX = e.clientX - modalPos.x;
                  const startY = e.clientY - modalPos.y;
                  const onMove = (ev) => setModalPos({ x: ev.clientX - startX, y: ev.clientY - startY });
                  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }}>
                <div className="font-bold text-base tracking-wide uppercase">Tableau comparatif des differents types d&apos;impositions</div>
                <div className="text-green-200 text-sm mt-1">Trouvez la maniere la plus economique de fabriquer vos transferts</div>
                <button onClick={() => { setShowOptimalModal(false); optimalStopRef.current = true; terminatePixelWorker(); }}
                  className="absolute right-3 top-3 text-lg leading-none text-green-200 hover:text-white">
                  &#10005;
                </button>
              </div>

              {/* Bouton calcul */}
              <div className="flex justify-center py-2 bg-gray-50 border-b border-gray-200">
                {isOptimalRunning && (
                  <span className="text-xs text-gray-500 italic">{optimalProgress}</span>
                )}
              </div>

              {/* Contenu scrollable */}
              <div className="p-6" style={{ maxHeight: 'calc(85vh - 120px)', overflowY: 'auto' }}>
                {/* Filtres */}
                <div className="flex gap-4 mb-3 text-sm justify-center">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={optimalFilters.massicot} onChange={e => setOptimalFilters(p => ({ ...p, massicot: e.target.checked }))} className="w-3 h-3 accent-blue-600" />
                    <span className="font-medium">Massicotable</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={optimalFilters.imbrique} onChange={e => setOptimalFilters(p => ({ ...p, imbrique: e.target.checked }))} className="w-3 h-3 accent-purple-600" />
                    <span className="font-medium">Non massicotable</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" checked={optimalFilters.imbrication} onChange={e => setOptimalFilters(p => ({ ...p, imbrication: e.target.checked }))} className="w-3 h-3 accent-orange-600" />
                    <span className="font-medium">Imbrication</span>
                  </label>
                </div>
                <div className="text-[10px] text-gray-400 text-center mb-1">Pour aller plus vite et si vous n&apos;avez pas besoin du mode imbrication, deselectionnez-le.</div>

                {/* Titre info */}
                <div className="mb-3 text-center">
                  <div className="font-bold text-sm text-gray-700">Pour chaque type de montage, la solution la plus economique est en vert</div>
                  <div className="text-xs text-gray-500 italic">le classement est fait en fonction du tarif catalogue 2026</div>
                </div>

                {/* Tableau 3 colonnes */}
                <div className="flex gap-2">
                  {activeModes.map(mode => (
                    <div key={mode} className="flex-1 min-w-0">
                      <div className={`font-bold text-xs mb-1 px-2 py-1 rounded text-center ${modeColors[mode]}`}>{modeLabels[mode]}</div>
                      {(dataByMode[mode] || []).map((e, i) => {
                        const bestHT = dataByMode[mode][0]?.totalHT;
                        const isBestMode = e.totalHT === bestHT && e.totalHT > 0;
                        const isBestGlobal = e.totalHT === globalBest && e.totalHT > 0;
                        return (
                          <div key={i} onClick={() => applyOptimalResult(e)}
                            className={`grid grid-cols-3 text-xs py-1 px-2 rounded cursor-pointer transition-all mb-0.5
                              ${isBestGlobal ? 'bg-green-200 text-green-900 font-bold ring-1 ring-green-400' : isBestMode ? 'bg-green-100 text-green-800 font-bold' : 'text-gray-700 hover:bg-gray-100'}`}>
                            <span className="text-left">{isBestGlobal ? '\u2605\u2605' : isBestMode ? '\u2605' : ''} <b>{e.fmtName}</b></span>
                            <span className="text-center"><b>{e.nb}</b>f</span>
                            <span className="text-right">{e.totalHT > 0 ? <span className="text-gray-500">{e.totalHT.toFixed(0)}{'\u20AC'}</span> : '\u2014'}</span>
                          </div>
                        );
                      })}
                      {(dataByMode[mode] || []).length === 0 && <div className="text-gray-400 text-[10px] text-center">{isOptimalRunning ? 'Calcul...' : '\u2014'}</div>}
                    </div>
                  ))}
                </div>

                {allResults.length === 0 && !isOptimalRunning && (
                  <div className="text-gray-400 text-xs text-center mt-2">Cliquez sur &quot;Calculer toutes les impositions&quot; pour commencer</div>
                )}
                {allResults.length === 0 && isOptimalRunning && (
                  <div className="text-gray-400 text-xs text-center mt-2">Calcul en cours...</div>
                )}

                {/* Boutons bas : Fermer + Calculer */}
                <div className="flex gap-2 mt-3">
                  <button onClick={() => { setShowOptimalModal(false); optimalStopRef.current = true; terminatePixelWorker(); }}
                    disabled={isOptimalRunning}
                    className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${isOptimalRunning ? 'bg-gray-100 text-gray-300 cursor-not-allowed' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>
                    Fermer
                  </button>
                  {isOptimalRunning ? (
                    <button onClick={() => { optimalStopRef.current = true; terminatePixelWorker(); setIsOptimalRunning(false); }}
                      className="flex-1 px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs rounded font-bold">
                      Arreter le calcul
                    </button>
                  ) : (
                    <button onClick={launchOptimal} disabled={files.length === 0}
                      className={`flex-1 px-4 py-1.5 text-xs rounded font-bold ${files.length > 0 ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                      Calculer toutes les impositions
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════════════════ */}
      {/*  OVERLAY SABLIER (pendant upload/conversion)          */}
      {/* ══════════════════════════════════════════════════════ */}
      {uploadStatus && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999]">
          <div className="bg-gray-900 rounded-2xl px-16 py-10 text-center text-white shadow-2xl">
            <div className="text-6xl mb-4 animate-spin-slow">&#9203;</div>
            <div className="text-xl font-bold mb-2">{uploadStatus.step}</div>
            <div className="text-base text-gray-300 mb-1">{uploadStatus.fileName}</div>
            <div className="text-sm text-gray-500">Fichier {uploadStatus.current} / {uploadStatus.total}</div>
          </div>
        </div>
      )}

      {/* ── Avertissement quantité élevée ── */}
      {quantityWarning && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md mx-4 border-2 border-orange-400">
            <div className="flex items-center gap-2 mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <h3 className="text-lg font-bold text-orange-700">Nombre &eacute;lev&eacute; de transferts command&eacute;s : {quantityWarning.totalQty}</h3>
            </div>
            <p className="text-sm text-gray-700 mb-3">Nous vous recommandons de ne pas d&eacute;passer {MAX_QUANTITY} pi&egrave;ces au total.</p>
            <p className="text-sm text-gray-700 mb-4 font-medium">Voulez-vous lancer n&eacute;anmoins le calcul ?</p>
            <div className="flex justify-center gap-3">
              <button onClick={() => {
                setQuantityWarning(null);
                if (quantityWarning.action === 'monter') {
                  handleMonter(true);
                } else {
                  launchOptimal(true);
                }
              }}
                className="px-5 py-2 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 transition-colors">
                Oui
              </button>
              <button onClick={() => setQuantityWarning(null)}
                className="px-5 py-2 bg-gray-200 text-gray-700 font-bold rounded-lg hover:bg-gray-300 transition-colors">
                Je modifie ma demande
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Alerte erreur ── */}
      {errorAlert && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md mx-4 border-2 border-red-500">
            <div className="flex items-center gap-2 mb-3">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <h3 className="text-lg font-bold text-red-700">{errorAlert.title}</h3>
            </div>
            <p className="text-sm text-gray-700 mb-3">{errorAlert.message}</p>
            <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
              <p className="text-sm text-blue-800"><b>Suggestion :</b> {errorAlert.solution}</p>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setErrorAlert(null)}
                className="px-6 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors">
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
