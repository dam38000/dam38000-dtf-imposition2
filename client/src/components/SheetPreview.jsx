// ============================================================
//  SheetPreview.jsx — Zone principale : preview planche + items + traits de coupe
// ============================================================

import { Icons } from './Icons';

export function SheetPreview({
  previewRef, previewScale, sheetSize, margin,
  sheets, currentSheetIndex, setCurrentSheetIndex,
  currentSheet, impositionMode,
  impositionErrors,
  isOptimalRunning, isCalculating, optimalProgress, calcProgress,
  allowMove, setSheets,
  files, stats, selectedFormat, totalExemplaires,
  showOptimalModal, setShowOptimalModal, setOptimalPanel,
  handleExportCut, handleExportComposite, handleExportPNG,
  allowRotation, setAllowRotation, setAllowMove,
  resetPlanche,
  handleSearchVariants, isSearchingVariants,
}) {
  return (
    <main className="flex-1 flex flex-col h-full overflow-hidden">

      {/* ── Barre header ── */}
      <div className="h-[185px] bg-white border-b border-gray-300 flex shadow-sm z-10 flex-shrink-0">
        {/* Colonne 1 : Tirage */}
        <div className="w-[240px] border-r border-gray-200 flex flex-col items-center justify-start p-3 bg-gray-50 flex-shrink-0">
          <div className="w-full px-3 py-2 bg-gray-400 text-white text-sm font-bold rounded shadow text-center cursor-not-allowed">
            Accueil
          </div>
          <div className="flex items-baseline gap-1 mt-2">
            <span className="text-4xl font-bold text-blue-600">{totalExemplaires}</span>
            <span className="text-xs text-gray-500">exemplaires</span>
            <span className="text-2xl font-bold text-gray-700">{selectedFormat}</span>
          </div>
          <button onClick={() => { if (files.length > 0) { setShowOptimalModal(true); setOptimalPanel([]); } }}
            disabled={files.length === 0}
            title={files.length === 0 ? "Ajoutez des fichiers pour accéder à l'optimisation" : "Trouver la combinaison de formats de feuille la plus économique pour votre tirage"}
            className={`mt-3 px-5 py-2 text-sm font-bold rounded-full shadow transition-colors
            ${files.length > 0 ? 'bg-green-600 hover:bg-green-700 text-white animate-pulse-fast' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
            Voir les montages les plus economiques
          </button>
        </div>

        {/* Colonne 2 : Exports + Details */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <div className="flex gap-1">
              <button onClick={handleExportCut} disabled={sheets.length === 0}
                title={sheets.length === 0 ? "Lancez un montage avant d'exporter" : "Exporter un PDF avec les traits de coupe pour la découpe à la massicot"}
                className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1 font-bold text-[9px] transition-all ${sheets.length > 0 ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                <Icons.Scissors /> Coupe
              </button>
              <button onClick={handleExportComposite} disabled={sheets.length === 0}
                title={sheets.length === 0 ? "Lancez un montage avant d'exporter" : "Exporter un PDF composite 300 DPI avec tous les dessins assemblés sur la planche"}
                className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1 font-bold text-[9px] transition-all ${sheets.length > 0 ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                <Icons.Layers /> Composite
              </button>
              <button onClick={handleExportPNG} disabled={sheets.length === 0}
                title={sheets.length === 0 ? "Lancez un montage avant d'exporter" : "Exporter la planche en PNG 300 DPI et la charger dans votre espace de travail"}
                className={`flex-1 py-1.5 rounded flex items-center justify-center gap-1 font-bold text-[9px] transition-all ${sheets.length > 0 ? 'bg-purple-600 hover:bg-purple-700 text-white' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                <Icons.Download /> Charger le PNG dans mon espace
              </button>
            </div>
          </div>
          {/* Grille details fichiers */}
          <div className="flex-1 p-2 overflow-hidden">
            <div className="grid grid-cols-3 gap-2 overflow-y-auto h-full content-start pr-0.5">
              {files.length === 0 ? (
                <div className="col-span-3 flex items-center justify-center h-full text-gray-400 text-sm">
                  Aucun fichier
                </div>
              ) : stats && stats.details ? (
                stats.details.map(d => (
                  <div key={d.id} className="bg-white border border-gray-200 rounded px-1.5 py-0.5 flex gap-2 shadow-sm items-center">
                    <div className="w-[40px] h-[40px] flex-shrink-0 bg-gray-50 rounded overflow-hidden flex items-center justify-center">
                      <img src={d.src} alt={d.name} className="max-w-full max-h-full object-contain" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[18px] font-bold text-gray-700 truncate">{d.name}</div>
                      <div className="font-bold text-gray-600 flex gap-3 leading-tight" style={{ fontSize: '13px' }}>
                        <span>Qté cdé : <strong>{d.req}</strong></span>
                        <span>Qté fab : <strong>{d.made}</strong></span>
                        <div className="flex-1 flex items-center">
                          <div className="w-full bg-gray-200 rounded-full h-0.5">
                            <div className={`h-0.5 rounded-full ${d.made >= d.req ? 'bg-green-500' : 'bg-blue-500'}`}
                              style={{ width: `${Math.min(100, (d.made / d.req) * 100)}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                files.map(f => (
                  <div key={f.id} className="bg-white border border-gray-200 rounded px-1.5 py-0.5 flex gap-2 shadow-sm items-center">
                    <div className="w-[40px] h-[40px] flex-shrink-0 bg-gray-50 rounded overflow-hidden flex items-center justify-center">
                      <img src={f.thumbnailUrl} alt={f.name} className="max-w-full max-h-full object-contain" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] font-bold text-gray-700 truncate">{f.name}</div>
                      <div className="font-bold text-[13px] text-gray-500 flex gap-4">
                        <span>Qté cdé : <strong>{f.quantity}</strong></span>
                        <span className="text-gray-300">Qté fab : —</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Options rotation ── */}
      <div className="w-full flex justify-center border-b border-gray-300 bg-gray-200 py-2 z-20 flex-shrink-0">
        <div className="flex items-center gap-4">
          <label title="Autoriser l'algorithme à pivoter les dessins à 90° pour optimiser le placement" className="flex items-center gap-2 text-sm font-bold text-gray-700 cursor-pointer select-none">
            <input type="checkbox" checked={allowRotation} onChange={e => { setAllowRotation(e.target.checked); resetPlanche(); }}
              className="w-4 h-4 accent-blue-600" />
            Autoriser la rotation
          </label>
          <label title="Activer le déplacement manuel des dessins sur la planche (double-clic pour pivoter)" className="flex items-center gap-2 text-sm font-bold text-gray-700 cursor-pointer select-none">
            <input type="checkbox" checked={allowMove} onChange={e => setAllowMove(e.target.checked)}
              className="w-4 h-4 accent-orange-600" />
            cocher la case pour deplacer ou tourner les dessins (double clic)
          </label>
        </div>
      </div>

      {/* ── Zone preview ── */}
      <div ref={previewRef} className="flex-1 relative w-full overflow-hidden">

        {/* Panneau d'aide — affiché uniquement si aucune planche et aucune erreur */}
        {sheets.length === 0 && impositionErrors.length === 0 && (
          <div className="absolute inset-0 z-20 flex items-start justify-center pt-4 px-8 select-none pointer-events-none">
            <div className="bg-white rounded-xl shadow-lg w-full max-w-4xl px-8 pt-5 pb-6">
              <h2 className="text-2xl font-bold uppercase tracking-widest text-gray-500 text-center border-b border-gray-200 pb-3 mb-5">
                Utilisation du programme de montage
              </h2>
              <div className="grid grid-cols-2 gap-x-12 gap-y-5 text-base text-gray-600">
                <div>
                  <div className="font-bold text-gray-800 text-lg mb-1">1 — Charger vos fichiers</div>
                  <p className="leading-relaxed mb-1">Chargez vos fichiers ou déposez-les dans l'espace vert clair. Par défaut, les fichiers seront rognés à 1mm du bord. Si vous ne le souhaitez pas, décochez la case correspondante. Vous pouvez rogner chaque dessin individuellement ou globalement.</p>
                  <p>• Le bouton <span className="font-semibold text-gray-700">"Remplir"</span> permet de remplir la feuille à condition qu'un seul dessin soit chargé.</p>
                </div>
                <div>
                  <div className="font-bold text-gray-800 text-lg mb-1">3 — Montage le plus économique</div>
                  <p className="leading-relaxed">Le bouton <span className="font-semibold text-gray-700">"Voir les montages les plus économiques"</span> calcule les prix pour tous les types et formats. Le tableau vous affichera toutes les possibilités pour choisir la plus économique.</p>
                  <p className="mt-2 text-gray-500 italic">Nota : le classement de la solution la plus économique est basé sur le prix catalogue.</p>
                </div>
                <div>
                  <div className="font-bold text-gray-800 text-lg mb-1">2 — Faire une imposition</div>
                  <p>• Choisissez le format (en haut)</p>
                  <p>• Définissez la bordure (défaut 6mm)</p>
                  <p>• Choisissez le type de montage : <span className="font-bold text-gray-700">Massicotable — Non Massicotable — Imbrication</span></p>
                  <p>• Lancez le montage</p>
                  <p className="mt-1">Une fenêtre vous proposera d'autres agencements avec le même nombre d'exemplaires.</p>
                </div>
                <div>
                  <div className="font-bold text-gray-800 text-lg mb-1">4 — Export</div>
                  <p className="leading-relaxed">Le bouton <span className="font-semibold text-gray-700">"Export dans votre espace"</span> exporte le montage vers printmytransfer.fr. Vous pouvez aussi exporter le fichier de découpe.</p>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Overlay horloge pendant calcul */}
        {(isOptimalRunning || isCalculating) && (
          <div className="absolute inset-0 z-30 flex flex-col items-center justify-center text-center pointer-events-none">
            <div className="animate-spin-slow text-green-800 mb-3">
              <svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
                <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
              </svg>
            </div>
            {isOptimalRunning && optimalProgress && (
              <div className="text-sm font-mono text-gray-700 bg-white bg-opacity-90 px-4 py-2 rounded shadow">
                {optimalProgress}
              </div>
            )}
            {isCalculating && !isOptimalRunning && (
              <div className="text-sm font-mono text-gray-700 bg-white bg-opacity-90 px-4 py-2 rounded shadow">
                {calcProgress || 'Calcul en cours...'}
              </div>
            )}
          </div>
        )}
        <div className="w-full h-full flex flex-col items-center justify-center">
          {/* Navigation planches supprimée */}
          {/* Planche */}
          <div style={{ width: `${sheetSize.w * previewScale}px`, height: `${sheetSize.h * previewScale}px` }}>
          <div className="relative bg-white shadow-xl"
            style={{
              width: `${sheetSize.w}px`,
              height: `${sheetSize.h}px`,
              transform: `scale(${previewScale})`,
              transformOrigin: 'top left',
            }}>
            <div className="w-full h-full relative overflow-hidden border border-gray-300">
              {/* Fond vide ou message d'erreur */}
              {!currentSheet && (
                <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
                  {impositionErrors.length > 0 ? (
                    <div className="text-red-500 font-bold text-center px-4"
                      style={{ fontSize: `${Math.max(10, 4.5 / previewScale)}px` }}>
                      {impositionErrors.map((e, i) => <div key={i}>{e}</div>)}
                    </div>
                  ) : (
                    <div className="text-gray-200 select-none"
                      style={{ fontSize: `${Math.max(12, 16 / previewScale)}px` }}>
                      {sheetSize.w} x {sheetSize.h} mm
                    </div>
                  )}
                </div>
              )}
              {/* Items positionnes */}
              {currentSheet && currentSheet.items.map((item, idx) => {
                const isImbrication = impositionMode === 'imbrication';
                return (
                  <div key={idx}
                    className={`absolute flex items-center justify-center ${isImbrication ? 'overflow-visible' : 'overflow-hidden'}`}
                    style={{
                      left: `${item.x}px`, top: `${item.y}px`,
                      width: `${item.w}px`, height: `${item.h}px`,
                      zIndex: 10,
                      backgroundColor: isImbrication ? 'transparent' : 'white',
                      cursor: allowMove ? 'move' : 'default',
                    }}
                    onMouseDown={allowMove ? (e) => {
                      e.preventDefault();
                      const startX = e.clientX, startY = e.clientY;
                      const origX = item.x, origY = item.y;
                      const onMove = (ev) => {
                        const dx = (ev.clientX - startX) / previewScale;
                        const dy = (ev.clientY - startY) / previewScale;
                        setSheets(prev => prev.map((s, si) => si !== currentSheetIndex ? s : {
                          ...s, items: s.items.map((it, ii) => ii !== idx ? it : { ...it, x: origX + dx, y: origY + dy })
                        }));
                      };
                      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
                      document.addEventListener('mousemove', onMove);
                      document.addEventListener('mouseup', onUp);
                    } : undefined}
                    onDoubleClick={allowMove ? () => {
                      setSheets(prev => prev.map((s, si) => si !== currentSheetIndex ? s : {
                        ...s, items: s.items.map((it, ii) => ii !== idx ? it : { ...it, rotated: !it.rotated, w: it.h, h: it.w })
                      }));
                    } : undefined}>
                    <div className="w-full h-full relative flex items-center justify-center">
                      {isImbrication ? (
                        <img src={item.src} alt="" draggable={false}
                          className="relative z-10"
                          style={{
                            width: `${item.realW}px`, height: `${item.realH}px`,
                            maxWidth: 'none', maxHeight: 'none', objectFit: 'fill',
                            transform: item.rotated ? 'rotate(90deg)' : 'none',
                            filter: 'url(#outline-effect)',
                          }} />
                      ) : (
                        <div className="flex items-center justify-center relative"
                          style={{
                            width: `${(item.rotated ? item.realH : item.realW) + margin * 2}px`,
                            height: `${(item.rotated ? item.realW : item.realH) + margin * 2}px`,
                          }}>
                          <img src={item.src} alt="" draggable={false}
                            className="relative z-10 bg-blue-100"
                            style={{
                              width: `${item.realW}px`, height: `${item.realH}px`,
                              maxWidth: 'none', maxHeight: 'none', objectFit: 'fill',
                              transform: item.rotated ? 'rotate(90deg)' : 'none',
                            }} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* Contours rouges */}
              {currentSheet && (impositionMode === 'massicot' || impositionMode === 'imbrique') && (() => {
                const items = currentSheet.items;
                const hSegs = new Set();
                const vSegs = new Set();
                items.forEach(item => {
                  const x1 = Math.round(item.x * 10) / 10;
                  const y1 = Math.round(item.y * 10) / 10;
                  const x2 = Math.round((item.x + item.w) * 10) / 10;
                  const y2 = Math.round((item.y + item.h) * 10) / 10;
                  hSegs.add(`${y1}|${x1}|${x2}`);
                  hSegs.add(`${y2}|${x1}|${x2}`);
                  vSegs.add(`${x1}|${y1}|${y2}`);
                  vSegs.add(`${x2}|${y1}|${y2}`);
                });
                const lines = [];
                hSegs.forEach(seg => {
                  const [y, x1, x2] = seg.split('|').map(Number);
                  lines.push(<div key={`hc-${seg}`} className="absolute pointer-events-none" style={{ left: `${x1}px`, top: `${y}px`, width: `${x2 - x1}px`, height: 0, borderTop: '1px solid #dc2626', zIndex: 15 }} />);
                });
                vSegs.forEach(seg => {
                  const [x, y1, y2] = seg.split('|').map(Number);
                  lines.push(<div key={`vc-${seg}`} className="absolute pointer-events-none" style={{ left: `${x}px`, top: `${y1}px`, width: 0, height: `${y2 - y1}px`, borderLeft: '1px solid #dc2626', zIndex: 15 }} />);
                });
                return lines;
              })()}
              {/* Lame de massicot en bleu */}
              {currentSheet && impositionMode === 'massicot' && (() => {
                const items = currentSheet.items;
                const EPSILON = 0.5;
                const W = sheetSize.w;
                const H = sheetSize.h;

                const allY = new Set();
                items.forEach(item => {
                  allY.add(Math.round(item.y * 10) / 10);
                  allY.add(Math.round((item.y + item.h) * 10) / 10);
                });
                const hCuts = Array.from(allY).filter(y => {
                  if (y <= EPSILON || y >= H - EPSILON) return false;
                  return !items.some(item => y > item.y + EPSILON && y < item.y + item.h - EPSILON);
                });

                const allX = new Set();
                items.forEach(item => {
                  allX.add(Math.round(item.x * 10) / 10);
                  allX.add(Math.round((item.x + item.w) * 10) / 10);
                });
                const vCuts = Array.from(allX).filter(x => {
                  if (x <= EPSILON || x >= W - EPSILON) return false;
                  return !items.some(item => x > item.x + EPSILON && x < item.x + item.w - EPSILON);
                });

                const sortedH = hCuts.sort((a, b) => a - b);
                const sortedV = vCuts.sort((a, b) => a - b);
                const firstH = sortedH.length > 0 ? sortedH[0] : null;
                const firstV = firstH === null && sortedV.length > 0 ? sortedV[0] : null;

                // 2ème coupe : perpendiculaire à la 1ère, dans la PLUS GRANDE bande
                // Fonction utilitaire : trouver les coupes dans une bande
                const findCutsInBand = (bandItems, axis, bandMin, bandMax) => {
                  const coords = new Set();
                  bandItems.forEach(it => {
                    if (axis === 'v') {
                      coords.add(Math.round(it.x * 10) / 10);
                      coords.add(Math.round((it.x + it.w) * 10) / 10);
                    } else {
                      coords.add(Math.round(it.y * 10) / 10);
                      coords.add(Math.round((it.y + it.h) * 10) / 10);
                    }
                  });
                  const limit = axis === 'v' ? W : H;
                  return Array.from(coords).filter(c => {
                    if (c <= EPSILON || c >= limit - EPSILON) return false;
                    if (axis === 'v') {
                      return !bandItems.some(it => c > it.x + EPSILON && c < it.x + it.w - EPSILON);
                    } else {
                      return !bandItems.some(it => c > it.y + EPSILON && c < it.y + it.h - EPSILON);
                    }
                  }).sort((a, b) => a - b);
                };

                let secondCut = null;
                if (firstH !== null) {
                  // Bande haut (0 → firstH) et bande bas (firstH → H)
                  const bandTop = items.filter(it => it.y < firstH - EPSILON);
                  const bandBot = items.filter(it => it.y + it.h > firstH + EPSILON);
                  const cutsTop = findCutsInBand(bandTop, 'v');
                  const cutsBot = findCutsInBand(bandBot, 'v');
                  // Préférer la plus grande bande
                  if (firstH < H / 2) {
                    // Bande bas est plus grande → essayer d'abord
                    if (cutsBot.length > 0) {
                      secondCut = { type: 'v', x: cutsBot[0], y1: firstH, y2: H };
                    } else if (cutsTop.length > 0) {
                      secondCut = { type: 'v', x: cutsTop[0], y1: 0, y2: firstH };
                    }
                  } else {
                    if (cutsTop.length > 0) {
                      secondCut = { type: 'v', x: cutsTop[0], y1: 0, y2: firstH };
                    } else if (cutsBot.length > 0) {
                      secondCut = { type: 'v', x: cutsBot[0], y1: firstH, y2: H };
                    }
                  }
                } else if (firstV !== null) {
                  // Bande gauche (0 → firstV) et bande droite (firstV → W)
                  const bandLeft = items.filter(it => it.x < firstV - EPSILON);
                  const bandRight = items.filter(it => it.x + it.w > firstV + EPSILON);
                  const cutsLeft = findCutsInBand(bandLeft, 'h');
                  const cutsRight = findCutsInBand(bandRight, 'h');
                  // Préférer la plus grande bande
                  if (firstV < W / 2) {
                    // Bande droite est plus grande → essayer d'abord
                    if (cutsRight.length > 0) {
                      secondCut = { type: 'h', y: cutsRight[0], x1: firstV, x2: W };
                    } else if (cutsLeft.length > 0) {
                      secondCut = { type: 'h', y: cutsLeft[0], x1: 0, x2: firstV };
                    }
                  } else {
                    if (cutsLeft.length > 0) {
                      secondCut = { type: 'h', y: cutsLeft[0], x1: 0, x2: firstV };
                    } else if (cutsRight.length > 0) {
                      secondCut = { type: 'h', y: cutsRight[0], x1: firstV, x2: W };
                    }
                  }
                }

                console.log('[massicot] 2ème coupe:', secondCut);

                return (
                  <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 16 }}>
                    {firstH !== null && (
                      <div className="absolute left-0 right-0"
                        style={{ top: `${firstH}px`, borderTop: '1px solid #2563eb' }} />
                    )}
                    {firstV !== null && (
                      <div className="absolute top-0 bottom-0"
                        style={{ left: `${firstV}px`, borderLeft: '1px solid #2563eb' }} />
                    )}
                    {secondCut && secondCut.type === 'v' && (
                      <div className="absolute"
                        style={{ left: `${secondCut.x}px`, top: `${secondCut.y1}px`, height: `${secondCut.y2 - secondCut.y1}px`, width: '1px', background: '#2563eb' }} />
                    )}
                    {secondCut && secondCut.type === 'h' && (
                      <div className="absolute"
                        style={{ top: `${secondCut.y}px`, left: `${secondCut.x1}px`, width: `${secondCut.x2 - secondCut.x1}px`, height: '1px', background: '#2563eb' }} />
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
          </div>
          {/* Infos planche */}
          <div className="flex-shrink-0 mt-2">
            {currentSheet && (
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span><strong>{currentSheet.items.length}</strong> images</span>
                {currentSheet.copies > 1 && <span>x <strong>{currentSheet.copies}</strong> copies</span>}
                {currentSheet.efficiency !== 'N/A' && <span>Remplissage: <strong>{currentSheet.efficiency}%</strong></span>}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
