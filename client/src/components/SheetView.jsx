import { useRef, useEffect, useState } from 'react';
import { Icons } from './Icons';
import TabButton from './TabButton';
import CutLinesOverlay from './CutLinesOverlay';
import { parseInput } from '../lib/bitmapUtils';

export default function SheetView({
  sheets, setSheets, hasCalculated, errors, setErrors,
  sheetSize, activeTab, setActiveTab, impositionMode, margin,
  simulatePrint, dragState, setDragState,
}) {
  const viewContainerRef = useRef(null);
  const [scaleFactor, setScaleFactor] = useState(1);

  // Scale calculation
  useEffect(() => {
    const calculateScale = () => {
      if (!viewContainerRef.current) return;
      const { clientWidth: containerWidth, clientHeight: containerHeight } = viewContainerRef.current;
      const PADDING = 40;
      const availableWidth = containerWidth - PADDING;
      const availableHeight = containerHeight - PADDING;
      const sheetW = parseInput(sheetSize.w);
      const sheetH = parseInput(sheetSize.h);
      if (sheetW === 0 || sheetH === 0) return;
      const scaleX = availableWidth / sheetW;
      const scaleY = availableHeight / sheetH;
      const newScale = Math.min(scaleX, scaleY);
      setScaleFactor(Math.min(Math.max(newScale, 0.1), 1.5));
    };
    calculateScale();
    const observer = new ResizeObserver(calculateScale);
    if (viewContainerRef.current) observer.observe(viewContainerRef.current);
    return () => observer.disconnect();
  }, [sheets, sheetSize, hasCalculated]);

  // Drag handling
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!dragState) return;
      e.preventDefault();
      const deltaX = (e.clientX - dragState.startX) / scaleFactor;
      const deltaY = (e.clientY - dragState.startY) / scaleFactor;
      setSheets(prevSheets => prevSheets.map(sheet => ({
        ...sheet,
        items: sheet.items.map(item => {
          if (item.uuid === dragState.itemId) {
            return { ...item, x: dragState.initialItemX + deltaX, y: dragState.initialItemY + deltaY };
          }
          return item;
        })
      })));
    };
    const handleMouseUp = () => setDragState(null);
    if (dragState) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, scaleFactor, setDragState, setSheets]);

  const handleMouseDown = (e, item) => {
    if (activeTab !== 'manual') return;
    e.preventDefault();
    e.stopPropagation();
    setDragState({ itemId: item.uuid, startX: e.clientX, startY: e.clientY, initialItemX: item.x, initialItemY: item.y });
  };

  const handleDoubleClick = (e, itemToRotate) => {
    if (activeTab !== 'manual') return;
    e.preventDefault();
    e.stopPropagation();
    setSheets(prevSheets => prevSheets.map(sheet => ({
      ...sheet,
      items: sheet.items.map(item => {
        if (item.uuid === itemToRotate.uuid) {
          return { ...item, rotated: !item.rotated, w: item.h, h: item.w };
        }
        return item;
      })
    })));
  };

  const safeMargin = parseInput(margin);

  return (
    <div className="flex-1 bg-gray-200 overflow-hidden relative flex flex-col">
      {/* SVG filter for imbrication */}
      <svg style={{ position: 'absolute', width: 0, height: 0 }}>
        <defs>
          <filter id="outline-effect">
            <feMorphology in="SourceAlpha" result="DILATED" operator="dilate" radius={safeMargin} />
            <feFlood floodColor="#fbcfe8" result="PINK" />
            <feComposite in="PINK" in2="DILATED" operator="in" result="OUTLINE" />
            <feMerge>
              <feMergeNode in="OUTLINE" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      {/* Empty state */}
      {!hasCalculated && sheets.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 pointer-events-none px-8">
          <div className="opacity-20 transform scale-150 mb-4"><Icons.Play /></div>
          <p className="font-semibold text-sm mb-4">Chargez des fichiers et cliquez sur "Monter"</p>
          <div className="bg-white/80 rounded-xl shadow-sm border border-gray-200 p-6 max-w-xl text-left text-[13px] leading-relaxed space-y-5">
            <div>
              <p className="font-bold text-gray-700 text-sm mb-1.5">Réglage de la bordure :</p>
              <p className="text-gray-600">La bordure est réglée à <strong>0 par défaut</strong>.<br/>
              Si vos dessins n'intègrent pas une bordure autour pour la découpe (mini ~5mm) et que vous faites un montage de plus de 1 transfert, veuillez donner une valeur à la bordure pour permettre la découpe (~5mm mini).</p>
            </div>
            <div>
              <p className="font-bold text-gray-700 text-sm mb-1.5">Détection des finesses et réserves :</p>
              <p className="text-gray-600">Cliquez sur le bouton <strong>"Analyser"</strong> pour voir les dessins "critiques".<br/>
              Si un bouton apparaît à côté de la référence d'un transfert, cliquez dessus pour visualiser et faire des corrections des finesses et réserves détectées.</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      {(hasCalculated || sheets.length > 0) && (
        <div className="w-full flex justify-center border-b border-gray-300 bg-gray-200 pt-2 z-20 flex-shrink-0">
          <div className="flex gap-1">
            <TabButton id="standard" label="Mode 1" icon={Icons.Grid} activeTab={activeTab} onClick={setActiveTab} />
            <TabButton id="compact" label="Mode 2" icon={Icons.Maximize} activeTab={activeTab} onClick={setActiveTab} />
            <TabButton id="grouped" label="Mode 3" icon={Icons.Layers} activeTab={activeTab} onClick={setActiveTab} />
            <TabButton id="norotate" label="Mode 4" icon={Icons.Ban} activeTab={activeTab} onClick={setActiveTab} />
            <TabButton id="manual" label="Manuel" icon={Icons.Hand} activeTab={activeTab} onClick={setActiveTab} />
          </div>
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/90 z-30 p-4 text-center backdrop-blur-sm">
          <div className="text-red-500 mb-3"><Icons.AlertTriangle size={48} /></div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">Attention</h3>
          {errors.map((err, i) => <p key={i} className="text-red-600 font-medium mb-1">{err}</p>)}
          <button onClick={() => setErrors([])} className="mt-6 px-6 py-2 bg-gray-200 hover:bg-gray-300 rounded-full text-gray-800 font-bold transition-colors">Fermer</button>
        </div>
      )}

      {/* Sheet rendering */}
      <div className="flex-1 relative w-full overflow-hidden" ref={viewContainerRef}>
        <div className="w-full h-full flex items-center justify-center p-4">
          {sheets.map((sheet, idx) => (
            <div key={idx} className="flex flex-col items-center justify-center transition-all duration-300 ease-out" style={{ transform: `scale(${scaleFactor})`, transformOrigin: 'center center' }}>
              <div className="relative bg-white shadow-xl flex-shrink-0" style={{ width: `${parseInput(sheetSize.w)}px`, height: `${parseInput(sheetSize.h)}px` }}>
                <div className="w-full h-full relative overflow-hidden border border-gray-300">
                  {impositionMode === 'massicot' && (
                    <CutLinesOverlay items={sheet.items} width={sheetSize.w} height={sheetSize.h} />
                  )}
                  {sheet.items.map((item) => (
                    <div
                      key={item.uuid}
                      onMouseDown={(e) => handleMouseDown(e, item)}
                      onDoubleClick={(e) => handleDoubleClick(e, item)}
                      className={`absolute flex items-center justify-center overflow-hidden hover:opacity-80 transition-opacity ${activeTab === 'manual' ? 'cursor-grab active:cursor-grabbing' : ''}`}
                      style={{ left: `${item.x}px`, top: `${item.y}px`, width: `${item.w}px`, height: `${item.h}px`, zIndex: 10 }}
                    >
                      <div className="w-full h-full relative flex items-center justify-center">
                        <div
                          className={`flex items-center justify-center relative ${impositionMode === 'imbrique' ? 'border border-blue-300 border-dashed' : ''}`}
                          style={{
                            width: `${item.rotated ? item.realH + (safeMargin * 2) : item.realW + (safeMargin * 2)}px`,
                            height: `${item.rotated ? item.realW + (safeMargin * 2) : item.realH + (safeMargin * 2)}px`
                          }}
                        >
                          {impositionMode === 'massicot' && (
                            <div className="absolute inset-0 border border-red-600 z-0 pointer-events-none"></div>
                          )}
                          <img
                            src={item.src}
                            alt="transfert"
                            className={`relative z-10 ${impositionMode === 'imbrication' ? '' : 'bg-blue-100'} ${simulatePrint ? 'print-simulated' : ''}`}
                            style={{
                              width: `${item.realW}px`,
                              height: `${item.realH}px`,
                              maxWidth: 'none',
                              maxHeight: 'none',
                              objectFit: 'fill',
                              transform: item.rotated ? 'rotate(90deg)' : 'none',
                              filter: impositionMode === 'imbrication' ? 'url(#outline-effect)' : undefined
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {activeTab === 'manual' && (
                <p className="text-[10px] text-gray-500 mt-2 italic font-medium" style={{ transform: `scale(${1 / scaleFactor})` }}>
                  Mode Manuel : Double-cliquez sur une forme pour la faire pivoter de 90°.
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
