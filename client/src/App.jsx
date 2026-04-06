// ============================================================
//  App.jsx — Assemblage des hooks et composants
// ============================================================

import { useState, useCallback } from 'react';
import { PRODUCT_FORMATS } from './lib/constants';
import { useFiles } from './hooks/useFiles';
import { useImposition } from './hooks/useImposition';
import { useExport } from './hooks/useExport';
import { usePreview } from './hooks/usePreview';
import { Sidebar } from './components/Sidebar';
import { SheetPreview } from './components/SheetPreview';
import { OptimalModal } from './components/OptimalModal';
import { VariantsChooser } from './components/VariantsChooser';
import { UploadOverlay, QuantityWarning, ErrorAlert } from './components/Modals';

export default function App() {
  // ── Etat general ──
  const [productMode, setProductMode] = useState('DTF');
  const [selectedFormat, setSelectedFormat] = useState('A2');
  const [impositionMode, setImpositionMode] = useState('massicot');
  const [margin, setMargin] = useState(6);
  const [allowRotation, setAllowRotation] = useState(true);
  const [allowMove, setAllowMove] = useState(false);
  const [autoCrop, setAutoCrop] = useState(true);
  const [errorAlert, setErrorAlert] = useState(null);

  const formats = PRODUCT_FORMATS[productMode] || {};
  const sheetSize = formats[selectedFormat] || { w: 575, h: 420 };

  // ── Ref stable pour resetPlanche (évite la dépendance circulaire hooks) ──
  const resetPlancheRef = { current: () => {} };
  const resetPlanche = useCallback((...args) => resetPlancheRef.current(...args), []);

  // ── Hook fichiers ──
  const filesHook = useFiles({
    autoCrop,
    setErrorAlert,
    resetPlanche,
  });

  // ── Hook imposition ──
  const impositionHook = useImposition({
    files: filesHook.files, setFiles: filesHook.setFiles,
    productMode, selectedFormat, setSelectedFormat,
    impositionMode, setImpositionMode, margin, allowRotation, sheetSize, setErrorAlert,
  });

  // Connecter la ref stable
  resetPlancheRef.current = impositionHook.resetPlanche;

  // ── Hook export ──
  const exportHook = useExport({
    sheets: impositionHook.sheets, currentSheetIndex: impositionHook.currentSheetIndex,
    margin, sheetSize, productMode, selectedFormat, impositionMode,
    setIsCalculating: impositionHook.setIsCalculating, setErrorAlert,
  });

  // ── Hook preview ──
  const { previewRef, previewScale } = usePreview(sheetSize);

  const totalExemplaires = impositionHook.stats ? impositionHook.stats.totalSheets : 0;
  const currentSheet = impositionHook.sheets[impositionHook.currentSheetIndex] || null;

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

      <Sidebar
        productMode={productMode} setProductMode={setProductMode}
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

      <UploadOverlay uploadStatus={filesHook.uploadStatus} />

      <QuantityWarning
        quantityWarning={impositionHook.quantityWarning}
        setQuantityWarning={impositionHook.setQuantityWarning}
        handleMonter={impositionHook.handleMonter}
        launchOptimal={impositionHook.launchOptimal}
      />

      <ErrorAlert errorAlert={errorAlert} setErrorAlert={setErrorAlert} />
    </div>
  );
}
