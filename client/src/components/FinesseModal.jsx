import { useState, useRef, useCallback, useEffect } from 'react';
import { Icons } from './Icons';

const ZOOM = 10;
const LENS_RADIUS = 120;

const BG_COLORS = [
  { color: '#ffffff', border: '#d1d5db' },
  { color: '#ef4444', border: '#ef4444' },
  { color: '#3b82f6', border: '#3b82f6' },
  { color: '#22c55e', border: '#22c55e' },
  { color: '#6b7280', border: '#6b7280' },
  { color: '#000000', border: '#374151' },
  { color: '#f59e0b', border: '#f59e0b' },
  { color: '#8b5cf6', border: '#8b5cf6' },
];

export default function FinesseModal({ file, finesse, onClose, onCorrectFinesse, onCorrectReserves }) {
  const [bgColor, setBgColor] = useState('#6b7280');
  const [isCorrectingFinesse, setIsCorrectingFinesse] = useState(false);
  const [isCorrectingReserves, setIsCorrectingReserves] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);
  const leftImgRef = useRef(null);
  const rightImgRef = useRef(null);
  const leftOverlayRef = useRef(null);
  const lensCanvasRef = useRef(null);
  const lensRef = useRef(null);
  const showOverlayRef = useRef(showOverlay);
  showOverlayRef.current = showOverlay;
  const bgColorRef = useRef(bgColor);
  bgColorRef.current = bgColor;

  // Images HD off-screen pour la loupe (pleine résolution)
  const hdImgRef = useRef(null);
  const hdOverlayRef = useRef(null);
  const hdDefectsRef = useRef(null);

  // Charger les images HD off-screen
  useEffect(() => {
    if (!file) return;
    const src = file.correctedSrc || `/uploads/${file.id}/converted.png`;
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = src;
    hdImgRef.current = img;

    if (file.defectsSrc) {
      const overlay = new Image();
      overlay.crossOrigin = 'Anonymous';
      overlay.src = file.defectsSrc;
      hdOverlayRef.current = overlay;
    }

    if (file.pureDefectsSrc) {
      const defects = new Image();
      defects.crossOrigin = 'Anonymous';
      defects.src = file.pureDefectsSrc;
      hdDefectsRef.current = defects;
    }
  }, [file?.id, file?.correctedSrc, file?.defectsSrc, file?.pureDefectsSrc]);

  const handleMouseMove = useCallback((panelKey, e) => {
    const panelRef = panelKey === 'left' ? leftPanelRef : rightPanelRef;
    const imgRef = panelKey === 'left' ? leftImgRef : rightImgRef;

    const panel = panelRef.current;
    const img = imgRef.current;
    const canvas = lensCanvasRef.current;
    const lensEl = lensRef.current;
    if (!panel || !img || !canvas || !lensEl) return;

    // Image HD source pour la loupe
    const hdImg = panelKey === 'left' ? hdImgRef.current : hdDefectsRef.current;
    if (!hdImg || !hdImg.complete || !hdImg.naturalWidth) return;

    const panelRect = panel.getBoundingClientRect();
    const x = e.clientX - panelRect.left;
    const y = e.clientY - panelRect.top;

    // Position the lens element directly (no React state)
    lensEl.style.display = 'block';
    lensEl.style.left = (e.clientX - LENS_RADIUS) + 'px';
    lensEl.style.top = (e.clientY - LENS_RADIUS) + 'px';

    // Calculate where the image actually renders (object-fit: contain)
    const panelW = panelRect.width;
    const panelH = panelRect.height;
    const imgNatW = hdImg.naturalWidth;
    const imgNatH = hdImg.naturalHeight;
    const scale = Math.min(panelW / imgNatW, panelH / imgNatH);
    const offsetX = (panelW - (imgNatW * scale)) / 2;
    const offsetY = (panelH - (imgNatH * scale)) / 2;

    // Position in natural image coordinates
    const natX = (x - offsetX) / scale;
    const natY = (y - offsetY) / scale;

    // Draw on canvas
    const ctx = canvas.getContext('2d');
    const size = LENS_RADIUS * 2;
    if (canvas.width !== size) canvas.width = size;
    if (canvas.height !== size) canvas.height = size;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(LENS_RADIUS, LENS_RADIUS, LENS_RADIUS, 0, Math.PI * 2);
    ctx.clip();

    // Fill with panel bg color
    ctx.fillStyle = panelKey === 'left' ? bgColorRef.current : '#6b7280';
    ctx.fillRect(0, 0, size, size);

    // Draw zoomed HD image
    const srcRadius = LENS_RADIUS / ZOOM;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      hdImg,
      natX - srcRadius, natY - srcRadius, srcRadius * 2, srcRadius * 2,
      0, 0, size, size
    );

    // Draw HD overlay if visible (left panel only)
    if (panelKey === 'left' && hdOverlayRef.current && hdOverlayRef.current.complete && showOverlayRef.current) {
      ctx.drawImage(
        hdOverlayRef.current,
        natX - srcRadius, natY - srcRadius, srcRadius * 2, srcRadius * 2,
        0, 0, size, size
      );
    }

    ctx.restore();

    // Border
    ctx.beginPath();
    ctx.arc(LENS_RADIUS, LENS_RADIUS, LENS_RADIUS - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, []);

  const handleMouseLeave = useCallback(() => {
    const lensEl = lensRef.current;
    if (lensEl) lensEl.style.display = 'none';
  }, []);

  if (!file) return null;

  const handleCorrectFinesse = async () => {
    if (!onCorrectFinesse) return;
    setIsCorrectingFinesse(true);
    await onCorrectFinesse(file.id);
    setIsCorrectingFinesse(false);
  };

  const handleCorrectReserves = async () => {
    if (!onCorrectReserves) return;
    setIsCorrectingReserves(true);
    await onCorrectReserves(file.id);
    setIsCorrectingReserves(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg p-2 flex flex-col w-full h-full max-w-[95vw] max-h-[95vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-4">
            <h3 className="font-bold text-lg text-gray-800 truncate max-w-[300px]">
              Inspection: {file.name}
            </h3>
            <button
              disabled
              className="px-3 py-1 rounded font-bold text-xs flex items-center gap-1 bg-gray-300 text-gray-500 cursor-not-allowed"
            >
              <Icons.CheckCircle /> Enregistrer modification
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-white bg-fuchsia-500 px-2 py-1 rounded font-bold uppercase">
              Finesse &le; {finesse} mm
            </span>
            <span className="text-[10px] text-black bg-green-400 px-2 py-1 rounded font-bold uppercase">
              R&eacute;serves &le; {finesse} mm
            </span>
            <button
              onClick={onClose}
              className="bg-red-600 text-white rounded-full p-1 shadow hover:bg-red-700 transition-colors"
            >
              <Icons.X size={16} />
            </button>
          </div>
        </div>

        {/* Boutons correction */}
        <div className="bg-gray-50 p-2 rounded border border-gray-200 mb-2 flex gap-2 flex-shrink-0">
          <button
            onClick={handleCorrectFinesse}
            disabled={isCorrectingFinesse || isCorrectingReserves}
            className="flex-1 py-1.5 text-white rounded font-bold text-xs shadow flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
            style={{ backgroundColor: '#FF00FF' }}
            onMouseOver={(e) => { if (!e.target.disabled) e.target.style.backgroundColor = '#DD00DD'; }}
            onMouseOut={(e) => { e.target.style.backgroundColor = '#FF00FF'; }}
          >
            <Icons.Maximize size={14} /> {isCorrectingFinesse ? 'Correction en cours...' : 'Corriger Finesses (+2px)'}
          </button>
          <button
            onClick={handleCorrectReserves}
            disabled={isCorrectingFinesse || isCorrectingReserves}
            className="flex-1 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded font-bold text-xs shadow flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
          >
            <Icons.Scissors size={14} /> {isCorrectingReserves ? 'Correction en cours...' : 'Corriger R\u00e9serves (\u00c9largir)'}
          </button>
          <button
            onClick={() => setShowOverlay(v => !v)}
            className={`flex-1 py-1.5 rounded font-bold text-xs shadow flex items-center justify-center gap-2 transition-colors ${showOverlay ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
          >
            <Icons.Eye size={14} /> {showOverlay ? 'Masquer finesses et r\u00e9serves' : 'Visualiser finesses et r\u00e9serves'}
          </button>
        </div>

        {/* Panneaux */}
        <div className="flex flex-1 gap-2 min-h-0">
          {/* Panneau gauche : original + overlay */}
          <div
            ref={leftPanelRef}
            className="w-1/2 h-full rounded flex items-center justify-center overflow-hidden relative cursor-crosshair"
            style={{ backgroundColor: bgColor }}
            onMouseMove={(e) => handleMouseMove('left', e)}
            onMouseLeave={handleMouseLeave}
          >
            {/* Barre outils verticale */}
            <div className="absolute left-2 top-2 z-10 flex flex-col gap-2 bg-white/80 rounded p-1.5 shadow">
              <span className="text-[8px] font-bold text-gray-500 uppercase text-center" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                Couleur du fond
              </span>
              {BG_COLORS.map((c) => (
                <button
                  key={c.color}
                  onClick={() => setBgColor(c.color)}
                  className={`w-7 h-7 rounded border-2 transition-all ${bgColor === c.color ? 'ring-2 ring-blue-500 scale-110' : ''}`}
                  style={{ backgroundColor: c.color, borderColor: c.border }}
                />
              ))}
              {/* Color picker custom */}
              <label
                className={`w-7 h-7 rounded border-2 border-dashed border-gray-400 cursor-pointer flex items-center justify-center transition-all hover:border-blue-500 overflow-hidden relative`}
                title="Couleur personnalis\u00e9e"
              >
                <span className="text-[10px] font-bold text-gray-400 z-10 pointer-events-none">+</span>
                <input
                  type="color"
                  value={bgColor}
                  onChange={(e) => setBgColor(e.target.value)}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </label>
            </div>

            <img
              ref={leftImgRef}
              src={file.correctedSrc || `/uploads/${file.id}/converted.png`}
              alt="Original"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                imageRendering: 'pixelated',
                position: 'absolute',
                inset: 0,
                zIndex: 1,
              }}
            />
            {showOverlay && file.defectsSrc && (
              <img
                ref={leftOverlayRef}
                src={file.defectsSrc}
                alt="Finesses overlay"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  imageRendering: 'pixelated',
                  position: 'absolute',
                  inset: 0,
                  zIndex: 2,
                }}
              />
            )}
          </div>

          {/* Panneau droit : d\u00e9fauts purs */}
          <div
            ref={rightPanelRef}
            className="w-1/2 h-full rounded flex items-center justify-center overflow-hidden relative cursor-crosshair"
            style={{ backgroundColor: '#6b7280' }}
            onMouseMove={(e) => handleMouseMove('right', e)}
            onMouseLeave={handleMouseLeave}
          >
            {file.pureDefectsSrc ? (
              <img
                ref={rightImgRef}
                src={file.pureDefectsSrc}
                alt="D\u00e9fauts"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  imageRendering: 'pixelated',
                  position: 'absolute',
                  inset: 0,
                }}
              />
            ) : (
              <span className="text-white text-sm font-bold">Aucun d&eacute;faut d&eacute;tect&eacute;</span>
            )}
          </div>
        </div>

        {/* Loupe canvas — toujours monté, positionné en fixed */}
        <div
          ref={lensRef}
          style={{
            display: 'none',
            position: 'fixed',
            width: LENS_RADIUS * 2,
            height: LENS_RADIUS * 2,
            borderRadius: '50%',
            pointerEvents: 'none',
            zIndex: 100,
            boxShadow: '0 0 12px rgba(0,0,0,0.6)',
            overflow: 'hidden',
          }}
        >
          <canvas
            ref={lensCanvasRef}
            style={{ width: '100%', height: '100%' }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-2 pt-2 border-t border-gray-200 mt-2 flex-shrink-0">
          <span className="text-xs text-gray-500">
            <strong>Mode Loupe :</strong> Survolez l'image pour agrandir les d&eacute;tails (x10).
          </span>
        </div>
      </div>
    </div>
  );
}
