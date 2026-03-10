import { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import MainArea from './components/MainArea';
import { launchImposition, fillPageWithImage } from './lib/imposition';

export default function App() {
  const [sheetSize, setSheetSize] = useState({ w: 575, h: 420 });
  const [margin, setMargin] = useState(0);
  const [finesse, setFinesse] = useState(0.3);
  const [impositionMode, setImpositionMode] = useState('massicot');
  const [files, setFiles] = useState([]);
  const [sheets, setSheets] = useState([]);
  const [isCalculating, setIsCalculating] = useState(false);
  const [hasCalculated, setHasCalculated] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [simulatePrint, setSimulatePrint] = useState(false);
  const [errors, setErrors] = useState([]);
  const [activeTab, setActiveTab] = useState('standard');
  const [dragState, setDragState] = useState(null);
  const [manualSheets, setManualSheets] = useState(null);
  const [stats, setStats] = useState({ totalSheets: 0, details: [] });
  const [isExporting, setIsExporting] = useState(false);
  const [finesseResults, setFinesseResults] = useState({});
  const [inspectFinesseId, setInspectFinesseId] = useState(null);
  const [correctedPreview, setCorrectedPreview] = useState(null);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

  // Ref pour toujours avoir les valeurs à jour dans les callbacks
  const stateRef = useRef({ files, sheetSize, margin, impositionMode, activeTab });
  stateRef.current = { files, sheetSize, margin, impositionMode, activeTab };

  const runImposition = useCallback(async (overrideTab, overrideFiles) => {
    const currentFiles = overrideFiles || stateRef.current.files;
    const targetTab = overrideTab || stateRef.current.activeTab;
    if (currentFiles.length === 0) return;
    if (targetTab === 'manual') return;

    setIsCalculating(true);
    setErrors([]);
    try {
      const result = await launchImposition({
        files: currentFiles,
        sheetSize: stateRef.current.sheetSize,
        margin: stateRef.current.margin,
        impositionMode: stateRef.current.impositionMode,
        activeTab: targetTab,
      });
      if (result.errors.length > 0) {
        setErrors(result.errors);
        setSheets([]);
        setStats({ totalSheets: 0, details: [] });
      } else {
        setSheets(result.sheets);
        setStats(result.stats);
      }
      setHasCalculated(true);
    } catch (err) {
      setErrors([err.message]);
      setSheets([]);
    } finally {
      setIsCalculating(false);
    }
  }, []);

  const handleMount = useCallback(() => {
    if (stateRef.current.activeTab === 'manual' && manualSheets) {
      setSheets(manualSheets);
      return;
    }
    runImposition();
  }, [manualSheets, runImposition]);

  // Re-run imposition when tab changes (except manual)
  useEffect(() => {
    if (!hasCalculated) return;
    if (activeTab === 'manual') {
      setManualSheets(sheets.map(s => ({ ...s, items: s.items.map(i => ({ ...i })) })));
      return;
    }
    runImposition(activeTab);
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run imposition when margin, sheetSize or mode changes
  useEffect(() => {
    if (!hasCalculated) return;
    if (activeTab === 'manual') return;
    runImposition();
  }, [margin, sheetSize, impositionMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFillPage = useCallback(async () => {
    const currentFiles = stateRef.current.files;
    if (currentFiles.length !== 1) return;
    const { sheetSize: ss, margin: m, impositionMode: im, activeTab: at } = stateRef.current;
    const maxQ = fillPageWithImage({ files: currentFiles, sheetSize: ss, margin: m, impositionMode: im, activeTab: at });
    if (maxQ && maxQ > 0) {
      const updatedFiles = currentFiles.map(f => ({ ...f, quantity: maxQ }));
      setFiles(updatedFiles);
      await runImposition(null, updatedFiles);
    }
  }, [runImposition]);

  const buildExportItems = useCallback(() => {
    if (sheets.length === 0 || !sheets[0].items) return null;
    return sheets[0].items.map(item => ({
      file_id: item.fileId,
      x: item.x,
      y: item.y,
      realW: item.realW,
      realH: item.realH,
      rotated: item.rotated || false,
    }));
  }, [sheets]);

  const handleExport = useCallback(async (type) => {
    const exportItems = buildExportItems();
    if (!exportItems) return;

    setIsExporting(type);
    try {
      const body = {
        sheet_size: { w: parseFloat(stateRef.current.sheetSize.w), h: parseFloat(stateRef.current.sheetSize.h) },
        items: exportItems,
      };
      if (type === 'coupe' || type === 'composite') {
        body.margin = parseFloat(stateRef.current.margin) || 0;
        body.mode = stateRef.current.impositionMode;
      }

      const res = await fetch(`/api/export/${type}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `Erreur export ${type}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = type === 'dessin' ? 'dessin_300dpi.png' : type === 'coupe' ? 'coupe.pdf' : 'composite.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrors(prev => [...prev, err.message]);
    } finally {
      setIsExporting(false);
    }
  }, [buildExportItems]);

  const handleExportDessin = useCallback(() => handleExport('dessin'), [handleExport]);
  const handleExportCoupe = useCallback(() => handleExport('coupe'), [handleExport]);
  const handleExportComposite = useCallback(() => handleExport('composite'), [handleExport]);

  const handleAnalyze = useCallback(async () => {
    const currentFiles = stateRef.current.files;
    if (currentFiles.length === 0) return;
    setIsAnalyzing(true);
    try {
      const results = {};
      for (const f of currentFiles) {
        try {
          const res = await fetch('/api/analyze/finesses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: f.id, threshold_mm: finesse }),
          });
          if (res.ok) {
            results[f.id] = await res.json();
          }
        } catch (err) {
          console.error(`Erreur analyse ${f.id}:`, err);
        }
      }
      setFinesseResults(results);
    } finally {
      setIsAnalyzing(false);
    }
  }, [finesse]);

  // === Handlers correction finesses/réserves ===
  const handleCorrectFinesses = useCallback(async (fileId) => {
    setIsCorrecting(true);
    try {
      const res = await fetch('/api/analyze/correct-finesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId, threshold_mm: finesse }),
      });
      if (res.ok) {
        const data = await res.json();
        data._ts = Date.now(); // cache bust
        setCorrectedPreview(data);
      }
    } catch (err) {
      console.error('Erreur correction finesses:', err);
    } finally {
      setIsCorrecting(false);
    }
  }, [finesse]);

  const handleCorrectReserves = useCallback(async (fileId) => {
    setIsCorrecting(true);
    try {
      const res = await fetch('/api/analyze/correct-reserves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId, threshold_mm: finesse }),
      });
      if (res.ok) {
        const data = await res.json();
        data._ts = Date.now();
        setCorrectedPreview(data);
      }
    } catch (err) {
      console.error('Erreur correction réserves:', err);
    } finally {
      setIsCorrecting(false);
    }
  }, [finesse]);

  const handleSaveCorrection = useCallback(async () => {
    if (!correctedPreview || !inspectFinesseId) return;
    try {
      const res = await fetch('/api/analyze/save-correction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: inspectFinesseId }),
      });
      if (res.ok) {
        // Mettre à jour les résultats finesses avec les résultats corrigés
        setFinesseResults(prev => ({
          ...prev,
          [inspectFinesseId]: {
            ...correctedPreview,
            // Remettre les URLs de l'analyse principale (recalculer)
            finesses_overlay_url: `/uploads/${inspectFinesseId}/finesses_overlay.png`,
            finesses_thumb_url: `/uploads/${inspectFinesseId}/finesses_thumb.png`,
          }
        }));
        // Mettre à jour la miniature du fichier
        setFiles(prev => prev.map(f => f.id === inspectFinesseId
          ? { ...f, thumbnailUrl: `/uploads/${f.id}/thumbnail.png?t=${Date.now()}` }
          : f
        ));
        setSaveMessage('Dessin sauvegardé !');
        setTimeout(() => setSaveMessage(null), 2000);
        setCorrectedPreview(null);
        // Relancer l'analyse sur l'image sauvegardée
        try {
          const analysisRes = await fetch('/api/analyze/finesses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: inspectFinesseId, threshold_mm: finesse }),
          });
          if (analysisRes.ok) {
            const analysisData = await analysisRes.json();
            setFinesseResults(prev => ({ ...prev, [inspectFinesseId]: analysisData }));
          }
        } catch {}
      }
    } catch (err) {
      console.error('Erreur sauvegarde:', err);
    }
  }, [correctedPreview, inspectFinesseId, finesse]);

  const handleCloseInspect = useCallback(() => {
    if (correctedPreview) {
      setShowUnsavedDialog(true);
    } else {
      setInspectFinesseId(null);
      setCorrectedPreview(null);
    }
  }, [correctedPreview]);

  const confirmSaveAndClose = useCallback(async () => {
    await handleSaveCorrection();
    setShowUnsavedDialog(false);
    setInspectFinesseId(null);
    setCorrectedPreview(null);
  }, [handleSaveCorrection]);

  const confirmDiscardAndClose = useCallback(async () => {
    if (inspectFinesseId) {
      try {
        await fetch('/api/analyze/discard-correction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_id: inspectFinesseId }),
        });
      } catch {}
    }
    setShowUnsavedDialog(false);
    setInspectFinesseId(null);
    setCorrectedPreview(null);
  }, [inspectFinesseId]);

  const handleUpload = async (selectedFiles) => {
    setIsAnalyzing(true);
    setErrors([]);

    const newFiles = [];
    for (const file of selectedFiles) {
      try {
        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || 'Erreur upload');
        }

        const data = await res.json();
        newFiles.push({
          id: data.id,
          name: data.name,
          thumbnailUrl: `/uploads/${data.id}/thumbnail.png`,
          width_mm: data.width_mm,
          height_mm: data.height_mm,
          dpiSource: data.dpi_source,
          iccSource: data.icc_source,
          quantity: 1,
        });
      } catch (err) {
        setErrors(prev => [...prev, `${file.name}: ${err.message}`]);
      }
    }

    if (newFiles.length > 0) {
      setFiles(prev => [...prev, ...newFiles]);
    }
    setIsAnalyzing(false);
  };

  return (
    <div className="flex h-screen w-full bg-gray-100 font-sans overflow-hidden text-sm">
      <Sidebar
        sheetSize={sheetSize}
        setSheetSize={setSheetSize}
        margin={margin}
        setMargin={setMargin}
        finesse={finesse}
        setFinesse={setFinesse}
        impositionMode={impositionMode}
        setImpositionMode={setImpositionMode}
        files={files}
        setFiles={setFiles}
        isCalculating={isCalculating}
        isAnalyzing={isAnalyzing}
        simulatePrint={simulatePrint}
        setSimulatePrint={setSimulatePrint}
        onUpload={handleUpload}
        onMount={handleMount}
        onFillPage={handleFillPage}
        onAnalyze={handleAnalyze}
        finesseResults={finesseResults}
        onInspectFinesse={setInspectFinesseId}
      />
      <MainArea
        sheetSize={sheetSize}
        sheets={sheets}
        setSheets={setSheets}
        hasCalculated={hasCalculated}
        errors={errors}
        setErrors={setErrors}
        stats={stats}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        impositionMode={impositionMode}
        margin={margin}
        simulatePrint={simulatePrint}
        dragState={dragState}
        setDragState={setDragState}
        onExportDessin={handleExportDessin}
        onExportCoupe={handleExportCoupe}
        onExportComposite={handleExportComposite}
        isExporting={isExporting}
      />
      {/* Modale inspection finesses — 2 panneaux comme montage.html */}
      {inspectFinesseId && finesseResults[inspectFinesseId] && (() => {
        const file = files.find(f => f.id === inspectFinesseId);
        const originalResult = finesseResults[inspectFinesseId];
        if (!file) return null;

        // Si correction en cours, utiliser les données corrigées
        const result = correctedPreview || originalResult;
        const ts = correctedPreview?._ts || Date.now();
        const imageUrl = correctedPreview?.corrected_url
          ? `${correctedPreview.corrected_url}?t=${ts}`
          : `/uploads/${file.id}/converted.png?t=${ts}`;
        const rawOverlay = correctedPreview
          ? result.overlay_url
          : (result.overlay_url || result.finesses_overlay_url);
        const overlayUrl = rawOverlay ? `${rawOverlay}?t=${ts}` : null;
        const rawPure = correctedPreview
          ? result.pure_defects_url
          : (result.pure_defects_url || result.overlay_url || result.finesses_overlay_url);
        const pureDefectsUrl = rawPure ? `${rawPure}?t=${ts}` : null;

        return (
          <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center" onClick={handleCloseInspect}>
            <div className="bg-white rounded-lg max-w-[95vw] max-h-[95vh] w-full flex flex-col shadow-2xl" onClick={e => e.stopPropagation()} style={{ maxWidth: '1400px' }}>

              {/* HEADER */}
              <div className="flex justify-between items-center px-4 py-2 border-b border-gray-200 flex-shrink-0">
                <div className="flex items-center gap-4">
                  <h3 className="font-bold text-sm">Inspection: {file.name}</h3>
                  <button
                    onClick={handleSaveCorrection}
                    disabled={!correctedPreview}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold transition-all ${
                      correctedPreview
                        ? 'bg-green-600 hover:bg-green-700 text-white animate-pulse shadow-md'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    ✓ Enregistrer modification
                  </button>
                  {saveMessage && <span className="text-green-600 text-xs font-bold animate-pulse">{saveMessage}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-white bg-fuchsia-500 px-2 py-1 rounded font-bold uppercase">
                    Finesse ≤ {finesse} mm
                  </span>
                  <span className="text-[10px] text-black bg-green-400 px-2 py-1 rounded font-bold uppercase">
                    Réserves ≤ {finesse} mm
                  </span>
                  <button onClick={handleCloseInspect} className="text-gray-400 hover:text-gray-700 text-2xl font-bold leading-none ml-2">&times;</button>
                </div>
              </div>

              {/* BOUTONS CORRECTION */}
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex gap-2 flex-shrink-0">
                <button
                  onClick={() => handleCorrectFinesses(file.id)}
                  disabled={isCorrecting}
                  className="flex-1 py-2.5 text-white rounded font-bold text-sm flex items-center justify-center gap-2 transition-all hover:brightness-110 shadow-md disabled:opacity-50"
                  style={{ backgroundColor: '#FF00FF' }}
                >
                  {isCorrecting ? '⏳' : '↗'} Corriger Finesses (auto)
                </button>
                <button
                  onClick={() => handleCorrectReserves(file.id)}
                  disabled={isCorrecting}
                  className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-50"
                >
                  {isCorrecting ? '⏳' : '✂'} Corriger Réserves (Élargir)
                </button>
              </div>

              {/* ZONE IMAGES — 2 panneaux */}
              <div className="flex-1 flex overflow-hidden min-h-0 relative">
                {/* Overlay chargement */}
                {isCorrecting && (
                  <div className="absolute inset-0 bg-white/80 z-30 flex flex-col items-center justify-center backdrop-blur-sm">
                    <div className="animate-spin text-4xl mb-2">⏳</div>
                    <p className="text-xs font-bold text-gray-700 uppercase animate-pulse">Correction en cours...</p>
                  </div>
                )}

                {/* GAUCHE : Design + overlay défauts */}
                <div
                  className="w-1/2 p-4 flex items-center justify-center relative overflow-auto"
                  style={{ backgroundColor: '#4b5563', backgroundImage: 'repeating-conic-gradient(#555 0% 25%, #444 0% 50%)', backgroundSize: '20px 20px' }}
                >
                  <div className="relative inline-block">
                    <img
                      src={imageUrl}
                      alt="design"
                      className="max-h-[65vh] max-w-full object-contain"
                      style={{ imageRendering: 'pixelated' }}
                    />
                    {overlayUrl && (
                      <img
                        src={overlayUrl}
                        alt="overlay défauts"
                        className="absolute inset-0 w-full h-full object-contain"
                        style={{ imageRendering: 'pixelated' }}
                      />
                    )}
                  </div>
                </div>

                {/* DROITE : Défauts purs sur fond gris */}
                <div
                  className="w-1/2 p-4 flex items-center justify-center relative overflow-auto"
                  style={{ backgroundColor: '#6b7280' }}
                >
                  {pureDefectsUrl && (
                    <img
                      src={pureDefectsUrl}
                      alt="défauts purs"
                      className="max-h-[65vh] max-w-full object-contain"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  )}
                </div>
              </div>

              {/* FOOTER — statistiques */}
              <div className="px-4 py-2 border-t bg-gray-50 flex justify-between items-center flex-shrink-0">
                <div className="flex gap-4 text-[11px]">
                  <span className="text-gray-500">
                    Seuil : <span className="font-bold">{result.threshold_mm} mm</span> ({result.radius_px} px)
                  </span>
                  {result.finesses_percent > 0 && (
                    <span className="text-fuchsia-600 font-bold">
                      Finesses : {result.finesses_percent}%
                    </span>
                  )}
                  {result.reserves_percent > 0 && (
                    <span className="text-green-600 font-bold">
                      Réserves : {result.reserves_percent}%
                    </span>
                  )}
                  {!result.has_finesses && !result.has_reserves && (
                    <span className="text-green-600 font-bold">✓ Aucun défaut détecté</span>
                  )}
                </div>
                <p className="text-[10px] text-gray-400">
                  <span className="text-fuchsia-500 font-bold">■</span> Finesses &nbsp;
                  <span className="text-green-500 font-bold">■</span> Réserves
                </p>
              </div>
            </div>

            {/* DIALOG modifications non sauvegardées */}
            {showUnsavedDialog && (
              <div className="absolute inset-0 bg-black/60 z-60 flex items-center justify-center" onClick={e => e.stopPropagation()}>
                <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md">
                  <h4 className="font-bold text-sm mb-3">⚠ Modifications non sauvegardées</h4>
                  <p className="text-xs text-gray-600 mb-4">
                    Vous avez des corrections en attente. Que souhaitez-vous faire ?
                  </p>
                  <div className="flex gap-2">
                    <button onClick={confirmSaveAndClose} className="flex-1 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-bold text-xs">
                      Sauvegarder
                    </button>
                    <button onClick={confirmDiscardAndClose} className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white rounded font-bold text-xs">
                      Quitter sans sauver
                    </button>
                    <button onClick={() => setShowUnsavedDialog(false)} className="flex-1 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded font-bold text-xs">
                      Annuler
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
