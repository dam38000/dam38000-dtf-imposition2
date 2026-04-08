// ============================================================
//  VariantsChooser.jsx — Fenêtre choix variantes (déplaçable)
// ============================================================

import { useState, useRef, useCallback } from 'react';
import { terminatePixelWorker } from '../lib/imposition';

export function VariantsChooser({ variantsChooser, setVariantsChooser, setSheets, calcStopRef }) {
  const [pos, setPos] = useState({ x: 440, y: 200 });
  const dragRef = useRef(null);

  const onDragStart = useCallback((e) => {
    // Ne pas drag si clic sur un bouton
    if (e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    const startX = e.clientX - pos.x;
    const startY = e.clientY - pos.y;
    const onMove = (ev) => {
      setPos({ x: ev.clientX - startX, y: ev.clientY - startY });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [pos.x, pos.y]);

  if (!variantsChooser) return null;

  return (
    <div className="fixed z-50"
      style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      ref={dragRef}
      onMouseDown={onDragStart}>
      <div className="bg-white rounded-xl shadow-2xl border-2 border-green-600 cursor-grab active:cursor-grabbing"
        style={{ width: '320px', userSelect: 'none' }}>
        <div className="p-5 text-center">
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
                className={`px-3 py-1 rounded text-lg font-bold cursor-pointer ${variantsChooser.currentIdx === 0 ? 'text-gray-300' : 'text-blue-600 hover:bg-blue-50'}`}>
                &#9664;
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
                className={`px-3 py-1 rounded text-lg font-bold cursor-pointer ${variantsChooser.currentIdx === variantsChooser.variants.length - 1 ? 'text-gray-300' : 'text-blue-600 hover:bg-blue-50'}`}>
                &#9654;
              </button>
            </div>
          )}
          <div className="flex gap-3 justify-center">
            {variantsChooser.searching && (
              <button onClick={() => { calcStopRef.current = true; terminatePixelWorker(); }}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white rounded font-bold text-sm cursor-pointer">
                Arreter
              </button>
            )}
            <button onClick={() => setVariantsChooser(null)}
              className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-bold text-sm cursor-pointer">
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
