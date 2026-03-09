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
    </div>
  );
}
