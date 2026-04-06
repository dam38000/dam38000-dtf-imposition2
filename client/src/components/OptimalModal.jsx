// ============================================================
//  OptimalModal.jsx — Tableau comparatif des impositions
// ============================================================

import { useState } from 'react';
import { terminatePixelWorker } from '../lib/imposition';

export function OptimalModal({
  showOptimalModal, setShowOptimalModal,
  optimalPanel, optimalFilters, setOptimalFilters,
  isOptimalRunning, optimalProgress, optimalStopRef,
  files, launchOptimal, applyOptimalResult,
}) {
  const [modalPos, setModalPos] = useState({ x: 0, y: 80 });

  if (!showOptimalModal) return null;

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

          {/* Boutons bas */}
          <div className="flex gap-2 mt-3">
            <button onClick={() => { setShowOptimalModal(false); optimalStopRef.current = true; terminatePixelWorker(); }}
              disabled={isOptimalRunning}
              className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${isOptimalRunning ? 'bg-gray-100 text-gray-300 cursor-not-allowed' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}>
              Fermer
            </button>
            {isOptimalRunning ? (
              <button onClick={() => { optimalStopRef.current = true; terminatePixelWorker(); }}
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
}
