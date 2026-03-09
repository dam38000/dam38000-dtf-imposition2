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
      {/* Modale inspection finesses */}
      {inspectFinesseId && finesseResults[inspectFinesseId] && (() => {
        const file = files.find(f => f.id === inspectFinesseId);
        const result = finesseResults[inspectFinesseId];
        if (!file) return null;
        return (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-8" onClick={() => setInspectFinesseId(null)}>
            <div className="bg-white rounded-xl shadow-2xl max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="flex justify-between items-center px-5 py-3 border-b bg-red-50">
                <div>
                  <h3 className="font-bold text-red-700 text-sm">⚠ Finesses et Réserves — {file.name}</h3>
                  <p className="text-xs text-red-600 mt-0.5">
                    Seuil : {result.threshold_mm} mm ({result.radius_px} px) — {result.finesses_percent}% de la surface affectée
                  </p>
                </div>
                <button onClick={() => setInspectFinesseId(null)} className="text-gray-400 hover:text-gray-700 text-2xl font-bold leading-none">&times;</button>
              </div>
              <div className="flex-1 overflow-auto p-5 bg-gray-100 flex items-center justify-center" style={{ backgroundImage: 'repeating-conic-gradient(#d1d5db 0% 25%, transparent 0% 50%)', backgroundSize: '20px 20px' }}>
                <div className="relative inline-block">
                  <img src={`/uploads/${file.id}/converted.png`} alt="design" className="max-h-[70vh] max-w-full object-contain" />
                  <img src={result.finesses_overlay_url} alt="finesses" className="absolute inset-0 w-full h-full object-contain opacity-80" />
                </div>
              </div>
              <div className="px-5 py-3 border-t bg-gray-50 flex justify-between items-center">
                <p className="text-[11px] text-gray-500">Les zones <span className="text-red-600 font-bold">rouges</span> indiquent les détails plus fins que {result.threshold_mm} mm qui risquent de mal s'imprimer.</p>
                <button onClick={() => setInspectFinesseId(null)} className="px-4 py-1.5 bg-gray-700 text-white rounded font-bold text-xs hover:bg-gray-800">Fermer</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
