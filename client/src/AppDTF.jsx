// ============================================================
//  AppDTF.jsx — Montage DTF (formats DTF uniquement + finesses)
// ============================================================

import { useState, useCallback, useEffect, useRef } from 'react';
import { PRODUCT_FORMATS } from './lib/constants';
import { useFiles } from './hooks/useFiles';
import { useImposition } from './hooks/useImposition';
import { useExport } from './hooks/useExport';
import { usePreview } from './hooks/usePreview';
import { SidebarDTF } from './components/SidebarDTF';
import { SheetPreview } from './components/SheetPreview';
import { OptimalModal } from './components/OptimalModal';
import { VariantsChooser } from './components/VariantsChooser';
import { UploadOverlay, QuantityWarning, ErrorAlert } from './components/Modals';
import FinesseModal from './components/FinesseModal';
// Fonctions client conservées mais plus utilisées (version serveur ci-dessous)
// import { generateExpansionOverlay, applyFinesseATN, generateExpandedImage } from './lib/finesseDetection';

export default function AppDTF() {
  // ── Etat general — DTF uniquement ──
  const productMode = 'DTF'; // fixé
  const [selectedFormat, setSelectedFormat] = useState('A2');
  const [impositionMode, setImpositionMode] = useState('massicot');
  const [margin, setMargin] = useState(6);
  const [allowRotation, setAllowRotation] = useState(true);
  const [allowMove, setAllowMove] = useState(false);
  const [autoCrop, setAutoCrop] = useState(true);
  const [errorAlert, setErrorAlert] = useState(null);

  // ── Finesse ──
  const [finesse] = useState(0.1); // seuil fixé à 0.1 mm
  const [finesseFileId, setFinesseFileId] = useState(null); // fichier ouvert dans la modal
  const [lastAnalyzedFinesse, setLastAnalyzedFinesse] = useState(null); // seuil de la dernière analyse
  const [lastAnalyzedFileCount, setLastAnalyzedFileCount] = useState(0); // nb fichiers lors de la dernière analyse
  const [isAnalyzing, setIsAnalyzing] = useState(false); // analyse en cours
  const [finesseStatus, setFinesseStatus] = useState(null); // { step, fileName, current, total }

  const formats = PRODUCT_FORMATS['DTF'];
  const sheetSize = formats[selectedFormat] || { w: 575, h: 420 };

  // ── Ref stable pour resetPlanche ──
  const resetPlancheRef = { current: () => {} };
  const resetPlanche = useCallback((...args) => resetPlancheRef.current(...args), []);

  // ── Hooks ──
  const filesHook = useFiles({
    autoCrop,
    setErrorAlert,
    resetPlanche,
  });

  const impositionHook = useImposition({
    files: filesHook.files, setFiles: filesHook.setFiles,
    productMode, selectedFormat, setSelectedFormat,
    impositionMode, setImpositionMode: setImpositionMode, margin, allowRotation, sheetSize, setErrorAlert,
  });

  resetPlancheRef.current = impositionHook.resetPlanche;

  const exportHook = useExport({
    sheets: impositionHook.sheets, currentSheetIndex: impositionHook.currentSheetIndex,
    margin, sheetSize, productMode, selectedFormat, impositionMode,
    setIsCalculating: impositionHook.setIsCalculating, setErrorAlert,
  });

  const { previewRef, previewScale } = usePreview(sheetSize);

  const totalExemplaires = impositionHook.stats ? impositionHook.stats.totalSheets : 0;
  const currentSheet = impositionHook.sheets[impositionHook.currentSheetIndex] || null;

  // ── Finesse : fichier sélectionné pour la modal ──
  const finesseFile = finesseFileId ? filesHook.files.find(f => f.id === finesseFileId) : null;

  // ── Appel API serveur pour analyser un fichier ──
  const analyzeFileServer = async (fileId) => {
    const resp = await fetch('/api/analyze/finesses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId, threshold_mm: finesse }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    return await resp.json();
  };

  // ── Analyse automatique des finesses à l'ouverture des fichiers ──
  // Attend que TOUS les fichiers soient croppés avant de lancer l'analyse
  // pour éviter les conflits de fichier (EPERM) entre crop et analyse
  const analyzedRef = useRef(new Set());
  const analyzeTimerRef = useRef(null);
  useEffect(() => {
    // Annuler le timer précédent (un nouveau fichier vient d'arriver)
    if (analyzeTimerRef.current) clearTimeout(analyzeTimerRef.current);

    const allCropped = filesHook.files.length > 0 && filesHook.files.every(f => f.cropped);
    const unanalyzed = filesHook.files.filter(f => f.cropped && !analyzedRef.current.has(f.id) && f.hasIssues === undefined);
    if (!allCropped || unanalyzed.length === 0) return;

    // Délai de 1s après le dernier crop pour laisser le serveur finir les I/O
    analyzeTimerRef.current = setTimeout(() => {
      const analyze = async () => {
        for (let i = 0; i < unanalyzed.length; i++) {
          const f = unanalyzed[i];
          analyzedRef.current.add(f.id);
          setFinesseStatus({ step: 'Analyse des finesses...', fileName: f.name, current: i + 1, total: unanalyzed.length });
          console.log(`[finesse-auto] Analyse serveur de ${f.name}, seuil=${finesse}mm`);
          try {
            const result = await analyzeFileServer(f.id);
            filesHook.setFiles(prev => prev.map(ff => ff.id !== f.id ? ff : {
              ...ff,
              overlaySrc: result.overlay_url + '?t=' + Date.now(),
              pureDefectsSrc: result.pure_defects_url + '?t=' + Date.now(),
              hasIssues: result.has_finesses,
              finessesPercent: result.finesses_percent,
            }));
          } catch (err) {
            console.error(`[finesse-auto] Erreur pour ${f.name}:`, err);
          }
        }
        setFinesseStatus(null);
        setLastAnalyzedFinesse(finesse);
        setLastAnalyzedFileCount(prev => Math.max(prev, filesHook.files.length));
      };
      analyze();
    }, 1000);

    return () => { if (analyzeTimerRef.current) clearTimeout(analyzeTimerRef.current); };
  }, [filesHook.files]);

  // ── Le bouton "Analyser" est actif si quelque chose a changé ──
  const needsAnalysis = filesHook.files.length > 0 && !isAnalyzing && (
    lastAnalyzedFinesse !== finesse ||
    lastAnalyzedFileCount !== filesHook.files.length ||
    filesHook.files.some(f => f.hasIssues === undefined)
  );

  // ── Analyser toutes les finesses (bouton) ──
  const analyzeAllFinesse = async () => {
    setIsAnalyzing(true);
    analyzedRef.current.clear();
    for (let i = 0; i < filesHook.files.length; i++) {
      const f = filesHook.files[i];
      setFinesseStatus({ step: 'Analyse des finesses...', fileName: f.name, current: i + 1, total: filesHook.files.length });
      console.log(`[finesse] Re-analyse serveur de ${f.name}, seuil=${finesse}mm`);
      try {
        const result = await analyzeFileServer(f.id);
        analyzedRef.current.add(f.id);
        filesHook.setFiles(prev => prev.map(ff => ff.id !== f.id ? ff : {
          ...ff,
          overlaySrc: result.overlay_url + '?t=' + Date.now(),
          pureDefectsSrc: result.pure_defects_url + '?t=' + Date.now(),
          hasIssues: result.has_finesses,
          finessesPercent: result.finesses_percent,
          correctedSrc: null,
        }));
      } catch (err) {
        console.error(`[finesse] Erreur pour ${f.name}:`, err);
      }
    }
    setFinesseStatus(null);
    setLastAnalyzedFinesse(finesse);
    setLastAnalyzedFileCount(filesHook.files.length);
    setIsAnalyzing(false);
  };

  // ── Ouvrir la modal finesse ──
  const openFinesse = async (fileId) => {
    const f = filesHook.files.find(x => x.id === fileId);
    if (!f) return;

    // Si pas encore analysé, lancer l'analyse serveur
    if (f.hasIssues === undefined) {
      console.log(`[finesse] Analyse serveur pour ${f.name}, seuil=${finesse}mm`);
      try {
        const result = await analyzeFileServer(fileId);
        filesHook.setFiles(prev => prev.map(ff => ff.id !== fileId ? ff : {
          ...ff,
          overlaySrc: result.overlay_url + '?t=' + Date.now(),
          pureDefectsSrc: result.pure_defects_url + '?t=' + Date.now(),
          hasIssues: result.has_finesses,
          hasReserves: result.has_reserves,
          finessesPercent: result.finesses_percent,
          correctedSrc: null,
        }));
      } catch (err) {
        console.error('[finesse] Erreur analyse:', err);
      }
    }

    setFinesseFileId(fileId);
  };

  // ── Corriger les finesses (serveur ImageMagick) ──
  const handleCorrectFinesse = async (fileId, intensity = 1) => {
    console.log(`[finesse] Correction serveur pour ${fileId}, seuil=${finesse}mm, intensité=${intensity}`);
    try {
      const resp = await fetch('/api/analyze/correct-finesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId, threshold_mm: finesse, intensity }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const result = await resp.json();

      const ts = Date.now();
      filesHook.setFiles(prev => prev.map(ff => ff.id !== fileId ? ff : {
        ...ff,
        correctedSrc: result.corrected_url + '?t=' + ts,
        overlaySrc: result.overlay_url + '?t=' + ts,
        pureDefectsSrc: result.pure_defects_url + '?t=' + ts,
        hasIssues: result.has_finesses,
        thumbnailUrl: result.thumbnail_url || ff.thumbnailUrl,
      }));
    } catch (err) {
      console.error('[finesse] Erreur correction:', err);
      setErrorAlert({ title: 'Erreur correction', message: err.message, solution: 'Vérifiez que le serveur est lancé.' });
    }
  };

  // ── Épaissir les bordures (TODO: route serveur dédiée) ──
  const handleExpandBordure = async (fileId) => {
    console.log(`[finesse] Épaississement bordure pour ${fileId}`);
    // Pour l'instant on utilise la correction serveur comme proxy
    // TODO: créer une route /api/analyze/expand-bordure
    await handleCorrectFinesse(fileId);
  };

  // ── Sauvegarder l'image corrigée (serveur) ──
  const handleSaveFinesse = async (fileId) => {
    console.log(`[finesse] Sauvegarde serveur pour ${fileId}`);
    try {
      const resp = await fetch('/api/analyze/save-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const result = await resp.json();
      console.log('[finesse] Sauvegarde OK:', result.message);

      // Mettre à jour la thumbnail et reset l'état correction
      filesHook.setFiles(prev => prev.map(ff => ff.id !== fileId ? ff : {
        ...ff,
        correctedSrc: null,
        thumbnailUrl: `/uploads/${fileId}/thumbnail.png?t=${Date.now()}`,
      }));

      // Re-analyser après sauvegarde
      const analyzeResult = await analyzeFileServer(fileId);
      filesHook.setFiles(prev => prev.map(ff => ff.id !== fileId ? ff : {
        ...ff,
        overlaySrc: analyzeResult.overlay_url + '?t=' + Date.now(),
        pureDefectsSrc: analyzeResult.pure_defects_url + '?t=' + Date.now(),
        hasIssues: analyzeResult.has_finesses,
      }));
    } catch (err) {
      console.error('[finesse] Erreur sauvegarde:', err);
      setErrorAlert({ title: 'Erreur sauvegarde', message: err.message, solution: 'Vérifiez que le serveur est lancé.' });
    }
  };

  // ── Fermer la modal finesse ──
  const closeFinesseModal = () => {
    setFinesseFileId(null);
  };

  // dummy setProductMode pour la sidebar (pas de changement de produit en DTF)
  const setProductMode = () => {};

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-200">

      {/* ── Filtre SVG pour outline rose en mode imbrication ── */}
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

      <SidebarDTF
        selectedFormat={selectedFormat} setSelectedFormat={setSelectedFormat}
        formats={formats} margin={margin} setMargin={setMargin}
        impositionMode={impositionMode} setImpositionMode={setImpositionMode}
        files={filesHook.files} setFiles={filesHook.setFiles}
        autoCrop={autoCrop} setAutoCrop={setAutoCrop}
        isDragging={filesHook.isDragging} fileInputRef={filesHook.fileInputRef}
        handleDragOver={filesHook.handleDragOver} handleDragLeave={filesHook.handleDragLeave}
        handleDrop={filesHook.handleDrop} handleFileInput={filesHook.handleFileInput}
        updateDimension={filesHook.updateDimension}
        cropFile={filesHook.cropFile} cropAll={filesHook.cropAll}
        removeFile={filesHook.removeFile} clearAll={filesHook.clearAll}
        handleMonter={impositionHook.handleMonter} handleRemplir={impositionHook.handleRemplir}
        isCalculating={impositionHook.isCalculating}
        resetPlanche={resetPlanche}
        finesse={finesse}
        openFinesse={openFinesse} analyzeAllFinesse={analyzeAllFinesse}
        needsAnalysis={needsAnalysis} isAnalyzing={isAnalyzing}
      />

      <SheetPreview
        previewRef={previewRef} previewScale={previewScale}
        sheetSize={sheetSize} margin={margin}
        sheets={impositionHook.sheets} currentSheetIndex={impositionHook.currentSheetIndex}
        setCurrentSheetIndex={impositionHook.setCurrentSheetIndex}
        currentSheet={currentSheet} impositionMode={impositionMode}
        impositionErrors={impositionHook.impositionErrors}
        isOptimalRunning={impositionHook.isOptimalRunning}
        isCalculating={impositionHook.isCalculating}
        optimalProgress={impositionHook.optimalProgress}
        calcProgress={impositionHook.calcProgress}
        allowMove={allowMove} setSheets={impositionHook.setSheets}
        files={filesHook.files} stats={impositionHook.stats}
        selectedFormat={selectedFormat} totalExemplaires={totalExemplaires}
        showOptimalModal={impositionHook.showOptimalModal}
        setShowOptimalModal={impositionHook.setShowOptimalModal}
        setOptimalPanel={impositionHook.setOptimalPanel}
        handleExportCut={exportHook.handleExportCut}
        handleExportComposite={exportHook.handleExportComposite}
        handleExportPNG={exportHook.handleExportPNG}
        allowRotation={allowRotation} setAllowRotation={setAllowRotation}
        setAllowMove={setAllowMove}
        resetPlanche={resetPlanche}
      />

      <VariantsChooser
        variantsChooser={impositionHook.variantsChooser}
        setVariantsChooser={impositionHook.setVariantsChooser}
        setSheets={impositionHook.setSheets}
        calcStopRef={impositionHook.calcStopRef}
      />

      <OptimalModal
        showOptimalModal={impositionHook.showOptimalModal}
        setShowOptimalModal={impositionHook.setShowOptimalModal}
        optimalPanel={impositionHook.optimalPanel}
        optimalFilters={impositionHook.optimalFilters}
        setOptimalFilters={impositionHook.setOptimalFilters}
        isOptimalRunning={impositionHook.isOptimalRunning}
        optimalProgress={impositionHook.optimalProgress}
        optimalStopRef={impositionHook.optimalStopRef}
        files={filesHook.files}
        launchOptimal={impositionHook.launchOptimal}
        applyOptimalResult={impositionHook.applyOptimalResult}
      />

      <UploadOverlay uploadStatus={filesHook.uploadStatus || finesseStatus} />

      <QuantityWarning
        quantityWarning={impositionHook.quantityWarning}
        setQuantityWarning={impositionHook.setQuantityWarning}
        handleMonter={impositionHook.handleMonter}
        launchOptimal={impositionHook.launchOptimal}
      />

      <ErrorAlert errorAlert={errorAlert} setErrorAlert={setErrorAlert} />

      {/* ── Modal Finesse ── */}
      {finesseFile && (
        <FinesseModal
          file={finesseFile}
          finesse={finesse}
          onClose={closeFinesseModal}
          onCorrectFinesse={handleCorrectFinesse}
          onExpandBordure={handleExpandBordure}
          onSave={handleSaveFinesse}
        />
      )}
    </div>
  );
}
