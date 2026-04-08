// ============================================================
//  SidebarDTF.jsx — Sidebar Montage DTF avec finesse
// ============================================================

import { Icons } from './Icons';

export function SidebarDTF({
  selectedFormat, setSelectedFormat,
  formats, margin, setMargin,
  impositionMode, setImpositionMode,
  files, setFiles,
  autoCrop, setAutoCrop,
  isDragging, fileInputRef,
  handleDragOver, handleDragLeave, handleDrop, handleFileInput,
  updateDimension, cropFile, cropAll, removeFile, clearAll,
  handleMonter, handleRemplir, isCalculating,
  resetPlanche,
  finesse, openFinesse, analyzeAllFinesse,
  needsAnalysis, isAnalyzing,
}) {
  return (
    <aside className="w-[420px] bg-white border-r border-gray-300 flex flex-col shadow-lg z-10 flex-shrink-0">

      {/* ── Header vert — DTF uniquement ── */}
      <div className="p-4 bg-green-700 text-white text-center flex-shrink-0">
        <h1 className="text-lg font-bold uppercase tracking-wider">Montage et Correction</h1>
        <h1 className="text-lg font-bold uppercase tracking-wider">Automatique</h1>
        <h2 className="text-sm font-bold text-white mt-1">by Printmytransfer.fr</h2>
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
              className="w-24 accent-green-600 flex-shrink-0" />
            <span className="text-xs font-bold text-gray-700 w-12 text-right flex-shrink-0">{margin} mm</span>
            <button onClick={analyzeAllFinesse} disabled={!needsAnalysis}
              className={`flex-1 px-2 py-1.5 rounded text-[10px] font-bold transition-all
                ${isAnalyzing ? 'bg-orange-400 text-white animate-pulse cursor-wait' : needsAnalysis ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
              {isAnalyzing ? 'Analyse...' : 'Analyser finesses'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Modes d'imposition ── */}
      <div className="p-2 bg-gray-50 border-b border-gray-300 shadow-md z-20 flex-shrink-0">
        <div className="flex gap-2">
          <button onClick={() => { setImpositionMode('massicot'); resetPlanche(); }}
            className={`flex-1 h-[56px] flex items-center justify-center border-2 rounded transition-all
              ${impositionMode === 'massicot' ? 'border-blue-600 bg-blue-50 text-blue-700 shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}>
            <span className="font-bold text-[16px] leading-tight text-center">Montage<br/>massicotable</span>
          </button>
          <button onClick={() => { setImpositionMode('imbrique'); resetPlanche(); }}
            className={`flex-1 h-[56px] flex items-center justify-center border-2 rounded transition-all
              ${impositionMode === 'imbrique' ? 'border-purple-600 bg-purple-50 text-purple-700 shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}>
            <span className="font-bold text-[16px] leading-tight text-center">Montage<br/>non massicotable</span>
          </button>
          <button onClick={() => { setImpositionMode('imbrication'); resetPlanche(); }}
            className={`flex-1 h-[56px] flex items-center justify-center border-2 rounded transition-all
              ${impositionMode === 'imbrication' ? 'border-orange-600 bg-orange-50 text-orange-700 shadow-sm' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'}`}>
            <span className="font-bold text-[16px] leading-tight text-center">Montage<br/>en imbrication</span>
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

        {files.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-500 pointer-events-none select-none" style={{ minHeight: 200 }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <span className="text-lg font-semibold mt-3 text-gray-500">Deposez vos fichiers ici</span>
            <span className="text-xs text-gray-400 mt-1">PDF, TIFF, PNG</span>
          </div>
        )}

        {files.map(f => (
          <div key={f.id} className="bg-white border border-gray-200 rounded-lg shadow-sm p-2 flex gap-3 items-start hover:shadow-md transition-shadow">
            <div className="w-[80px] h-[80px] flex-shrink-0 bg-gray-100 rounded overflow-hidden flex items-center justify-center border border-gray-200">
              <img src={f.thumbnailUrl} alt={f.name} className="max-w-full max-h-full object-contain" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-800 truncate">{f.name}</span>
                <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                  {/* Bouton Visualisation / Finesse */}
                  <button onClick={() => openFinesse(f.id)}
                    className={`text-[11px] font-bold px-2 py-0.5 rounded transition-all
                      ${f.hasIssues === true && !f.correctedSrc && !f.corrected ? 'text-white bg-red-500 border border-red-400 animate-[pulse_0.6s_ease-in-out_infinite]' : f.hasIssues === false || f.correctedSrc || f.corrected ? 'text-white bg-green-500 border border-green-400' : 'text-gray-400 bg-gray-100 border border-gray-200'}`}>
                    Visualisation / Finesse
                  </button>
                  <button onClick={() => cropFile(f.id, true)} className="text-gray-400 hover:text-green-600 transition-colors p-0.5">
                    <Icons.Crop size={12} />
                  </button>
                  <button onClick={() => removeFile(f.id)} className="text-gray-400 hover:text-red-500 transition-colors p-0.5">
                    <Icons.X size={14} />
                  </button>
                </div>
              </div>
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
              {/* Statut finesse */}
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[9px] text-gray-400">{f.iccSource || 'Profil inconnu'}</span>
                {f.hasAlpha && <span className="text-[9px] text-pink-500 font-bold">alpha</span>}
                {f.hasIssues === true && <span className="text-[9px] text-red-500 font-bold">finesses détectées</span>}
                {f.hasIssues === false && <span className="text-[9px] text-green-500 font-bold">OK</span>}
                {f.correctedSrc && <span className="text-[9px] text-blue-500 font-bold">corrigé</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Boutons bas ── */}
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
          <span className="font-bold text-xs mt-1">{isCalculating ? 'Arr\u00eater' : 'Monter'}</span>
        </button>
      </div>
    </aside>
  );
}
