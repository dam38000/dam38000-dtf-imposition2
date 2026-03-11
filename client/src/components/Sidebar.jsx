import { useRef } from 'react';
import { Icons } from './Icons';
import FileList from './FileList';

const PRESETS = {
  '1M': { w: 980, h: 575 },
  'A2': { w: 575, h: 420 },
  'A3': { w: 420, h: 280 },
  'A4': { w: 280, h: 202 },
  'A5': { w: 202, h: 132 },
  'A6': { w: 132, h: 100 },
};

export default function Sidebar({
  sheetSize, setSheetSize,
  margin, setMargin,
  finesse,
  impositionMode, setImpositionMode,
  files, setFiles,
  isCalculating, isAnalyzing,
  onUpload, onMount, onFillPage,
  onAnalyze, finesseResults, onInspectFinesse,
}) {
  const fileInputRef = useRef(null);

  const handlePresetChange = (e) => {
    const preset = PRESETS[e.target.value];
    if (preset) setSheetSize({ w: preset.w, h: preset.h });
  };

  const handleFileSelect = async (e) => {
    const selectedFiles = Array.from(e.target.files);
    if (selectedFiles.length === 0) return;
    await onUpload(selectedFiles);
    e.target.value = '';
  };

  const removeFile = (id) => {
    setFiles(files.filter(f => f.id !== id));
  };

  const removeAllFiles = () => {
    setFiles([]);
  };

  const updateFileQuantity = (id, quantity) => {
    setFiles(files.map(f => f.id === id ? { ...f, quantity } : f));
  };

  return (
    <aside className="w-[420px] bg-white border-r border-gray-300 flex flex-col shadow-lg z-10 flex-shrink-0">
      {/* Header */}
      <div className="p-4 bg-green-700 text-white text-center flex-shrink-0">
        <h1 className="text-lg font-bold uppercase tracking-wider">Montage Automatique</h1>
        <h2 className="text-xl font-bold text-white mt-1">by Printmytransfer</h2>
      </div>

      {/* Overlay traitement */}
      {(isAnalyzing || isCalculating) && (
        <div className="absolute inset-0 bg-white/80 z-30 flex flex-col items-center justify-center text-center backdrop-blur-sm rounded-lg">
          <div className="animate-spin-slow text-green-600 mb-2"><Icons.Loader size={32}/></div>
          <p className="text-xs font-bold text-green-700 uppercase animate-pulse">TRAITEMENT EN COURS...</p>
        </div>
      )}

      {/* Panneau réglages */}
      <div className="flex-shrink-0 max-h-[40vh] overflow-y-auto border-b border-gray-200 bg-white relative">
        <div className="p-3 space-y-2">
          {/* Format de feuille */}
          <div className="space-y-1">
            <label className="block text-gray-800 font-semibold uppercase text-[10px]">Dimension de la feuille (mm)</label>
            <div className="flex gap-2">
              <select onChange={handlePresetChange} defaultValue="A2" className="border border-gray-300 rounded px-1 text-xs bg-white focus:border-blue-500 outline-none font-bold h-7">
                <option value="1M">1M</option>
                <option value="A2">A2</option>
                <option value="A3">A3</option>
                <option value="A4">A4</option>
                <option value="A5">A5</option>
                <option value="A6">A6</option>
              </select>
              <div className="relative flex-1">
                <span className="absolute left-2 top-1.5 text-gray-500 text-[9px]">L</span>
                <input type="text" value={sheetSize.w} onChange={(e) => setSheetSize({...sheetSize, w: e.target.value})} className="w-full pl-5 pr-2 py-1 h-7 text-xs border border-gray-300 rounded focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="relative flex-1">
                <span className="absolute left-2 top-1.5 text-gray-500 text-[9px]">H</span>
                <input type="text" value={sheetSize.h} onChange={(e) => setSheetSize({...sheetSize, h: e.target.value})} className="w-full pl-5 pr-2 py-1 h-7 text-xs border border-gray-300 rounded focus:border-blue-500 focus:outline-none" />
              </div>
            </div>
          </div>

          {/* Marge + Bouton analyse */}
          <div className="space-y-1">
            <div className="flex justify-between">
              <label className="block text-gray-800 font-semibold uppercase text-[10px]">Bordure (Marge)</label>
              <span className="text-blue-600 font-bold text-[10px]">{margin} mm</span>
            </div>
            <div className="flex gap-2 items-center">
              <input type="range" min="0" max="10" value={margin} onChange={(e) => setMargin(parseInt(e.target.value))} className="w-1/2 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"/>
              <button onClick={onAnalyze} disabled={files.length === 0 || isAnalyzing} className="flex items-center gap-1.5 px-2 py-1 bg-orange-500 hover:bg-orange-600 text-white rounded text-[10px] font-bold transition-all shadow-md disabled:bg-gray-300 h-6">
                {isAnalyzing ? <span className="animate-spin"><Icons.Loader size={10} /></span> : <Icons.Search size={10} />} Analyse finesses et réserves
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sélecteur mode imposition */}
      <div className="p-2 bg-gray-50 border-b border-gray-300 shadow-md z-20 flex-shrink-0 relative">
        <div className="flex gap-2">
          <button onClick={() => setImpositionMode('massicot')} className={`flex-1 h-[50px] flex flex-col items-center justify-center border-2 rounded transition-all ${impositionMode === 'massicot' ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}>
            <Icons.Layout /> <span className="font-bold text-[9px] mt-0.5">Massicotable</span>
          </button>
          <button onClick={() => setImpositionMode('imbrique')} className={`flex-1 h-[50px] flex flex-col items-center justify-center border-2 rounded transition-all ${impositionMode === 'imbrique' ? 'border-purple-600 bg-purple-50 text-purple-700 shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}>
            <Icons.Scissors /> <span className="font-bold text-[9px] mt-0.5">Non Massicotable</span>
          </button>
          <button onClick={() => setImpositionMode('imbrication')} className={`flex-1 h-[50px] flex flex-col items-center justify-center border-2 rounded transition-all opacity-50 cursor-not-allowed ${impositionMode === 'imbrication' ? 'border-orange-600 bg-orange-50 text-orange-700 shadow-sm' : 'border-gray-200 bg-white text-gray-700'}`} disabled>
            <Icons.Puzzle /> <span className="font-bold text-[9px] mt-0.5">Imbrication</span>
          </button>
        </div>
      </div>

      {/* Liste fichiers */}
      <FileList
        files={files}
        onRemove={removeFile}
        onRemoveAll={removeAllFiles}
        onUpdateQuantity={updateFileQuantity}
        simulatePrint={false}
        finesseResults={finesseResults}
        onInspectFinesse={onInspectFinesse}
      />

      {/* Barre actions bas */}
      <div className="p-4 border-t border-gray-200 bg-gray-50 flex-shrink-0 flex gap-2">
        <label className="flex-1 h-[60px] flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:bg-white hover:border-blue-400 transition-colors bg-white shadow-sm">
          <Icons.Upload />
          <span className="text-gray-700 font-medium text-xs mt-1">Fichiers (PNG/PDF/TIFF)</span>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".png,.pdf,.tif,.tiff"
            onChange={handleFileSelect}
          />
        </label>
        <button
          onClick={onMount}
          disabled={files.length === 0 || isCalculating}
          className={`flex-1 h-[60px] flex flex-col items-center justify-center border-2 rounded-lg transition-all ${files.length > 0 ? 'bg-green-600 border-green-700 text-white hover:bg-green-700 shadow-md transform hover:scale-[1.02]' : 'bg-gray-200 border-gray-300 text-gray-400 cursor-not-allowed'}`}
        >
          <Icons.Refresh />
          <span className="font-bold text-xs mt-1">{isCalculating ? 'Calcul...' : 'Monter'}</span>
        </button>
        <button
          onClick={onFillPage}
          disabled={files.length !== 1 || isCalculating}
          className={`w-[60px] h-[60px] flex flex-col items-center justify-center border-2 rounded-lg transition-all flex-shrink-0 ${files.length === 1 ? 'bg-blue-600 border-blue-700 text-white hover:bg-blue-700 shadow-md' : 'bg-gray-200 border-gray-300 text-gray-400 cursor-not-allowed'}`}
          title="Remplir la feuille"
        >
          <Icons.Maximize size={16} />
          <span className="font-bold text-[8px] mt-0.5">REMPLIR</span>
        </button>
      </div>
    </aside>
  );
}
