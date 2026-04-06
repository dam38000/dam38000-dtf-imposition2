import { useState, useRef, useCallback, useEffect } from 'react';
import { Icons } from './Icons';

// ── Conversion HSL ──
function hexToHsl(hex) {
  let r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h = 0, s = 0, l = (max+min)/2;
  if (max !== min) {
    const d = max-min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    if (max===r) h = ((g-b)/d + (g<b?6:0))/6;
    else if (max===g) h = ((b-r)/d+2)/6;
    else h = ((r-g)/d+4)/6;
  }
  return { h: h*360, s: s*100, l: l*100 };
}
function hslToHex(h, s, l) {
  h = ((h%360)+360)%360; s = Math.max(0,Math.min(100,s))/100; l = Math.max(0,Math.min(100,l))/100;
  const c=(1-Math.abs(2*l-1))*s, x=c*(1-Math.abs((h/60)%2-1)), m=l-c/2;
  let r,g,b;
  if(h<60){r=c;g=x;b=0;}else if(h<120){r=x;g=c;b=0;}else if(h<180){r=0;g=c;b=x;}
  else if(h<240){r=0;g=x;b=c;}else if(h<300){r=x;g=0;b=c;}else{r=c;g=0;b=x;}
  const hex2=v=>Math.round((v+m)*255).toString(16).padStart(2,'0');
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}
function adjustColor(hex, dh, ds, dl) {
  const {h,s,l} = hexToHsl(hex);
  return hslToHex(h+dh, s+ds, l+dl);
}

const ZOOM = 5;
const LENS_RADIUS = 120;

// Écran 20" Full HD ≈ 96 DPI écran, image à 300 DPI → ratio = 96/300 ≈ 0.32
// Pour taille réelle : 1mm image = 1mm écran
const SCREEN_DPI = 96;
const IMAGE_DPI = 300;
const SCALE_REAL = SCREEN_DPI / IMAGE_DPI; // ~0.32 = taille réelle

export default function FinesseModal({ file, finesse, onClose, onCorrectFinesse, onExpandBordure, onSave }) {
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1); // 1 = taille réelle, 2 = x2
  const correctionIntensity = 1.3; // intensité fixe
  const [showConfirm, setShowConfirm] = useState(false);
  const [bgColor, setBgColor] = useState('#9ca3af'); // fond du panneau gauche (gris moyen)
  const [bgTexture, setBgTexture] = useState(false); // texture tissu
  const [hslAdjust, setHslAdjust] = useState({ h: 0, s: 0, l: 0 }); // ajustement HSL des patches

  const PATCH_DEFAULTS = ['#2563eb', '#dc2626', '#16a34a', '#1a1a1a', '#ff9800', '#9c27b0'];
  const [patchColors, setPatchColors] = useState(() =>
    PATCH_DEFAULTS.map((def, i) => localStorage.getItem(`finesse_color_${i}`) || def)
  );
  const patchInputRefs = useRef([]);

  const savePatchColor = (idx, color) => {
    setPatchColors(prev => { const next = [...prev]; next[idx] = color; return next; });
    localStorage.setItem(`finesse_color_${idx}`, color);
  };

  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);
  const lensCanvasRef = useRef(null);
  const lensRef = useRef(null);

  // Images HD off-screen pour la loupe
  const hdImgRef = useRef(null);
  const hdOverlayRef = useRef(null);
  const dpiRef = useRef(300);

  // Charger les images HD off-screen
  useEffect(() => {
    if (!file) return;
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = file.correctedSrc || `/uploads/${file.id}/converted.png`;
    hdImgRef.current = img;

    dpiRef.current = file.dpiSource || 300;

    img.onload = () => {
      console.log('[Loupe HD] Image chargée:', img.naturalWidth, 'x', img.naturalHeight, 'src:', img.src.substring(0, 80));
    };

    if (file.overlaySrc) {
      const overlay = new Image();
      overlay.crossOrigin = 'Anonymous';
      overlay.src = file.overlaySrc;
      hdOverlayRef.current = overlay;
    }
  }, [file?.id, file?.overlaySrc, file?.correctedSrc]);

  const handleMouseMove = useCallback((panelKey, e) => {
    const panelRef = panelKey === 'left' ? leftPanelRef : rightPanelRef;
    const panel = panelRef.current;
    const canvas = lensCanvasRef.current;
    const lensEl = lensRef.current;
    if (!panel || !canvas || !lensEl) return;

    // Choisir l'image HD source selon le panneau
    const hdImg = panelKey === 'left' ? hdImgRef.current : hdOverlayRef.current;
    if (!hdImg || !hdImg.complete || !hdImg.naturalWidth) return;

    const panelRect = panel.getBoundingClientRect();
    const x = e.clientX - panelRect.left;
    const y = e.clientY - panelRect.top;

    // Positionner la loupe
    lensEl.style.display = 'block';
    lensEl.style.left = (e.clientX - LENS_RADIUS) + 'px';
    lensEl.style.top = (e.clientY - LENS_RADIUS) + 'px';

    // Calculer la position dans l'image (object-fit: contain)
    const panelW = panelRect.width;
    const panelH = panelRect.height;
    const imgNatW = hdImg.naturalWidth;
    const imgNatH = hdImg.naturalHeight;
    const scale = Math.min(panelW / imgNatW, panelH / imgNatH);
    const offsetX = (panelW - (imgNatW * scale)) / 2;
    const offsetY = (panelH - (imgNatH * scale)) / 2;

    // Position en coordonnées image naturelles
    const natX = (x - offsetX) / scale;
    const natY = (y - offsetY) / scale;

    // Dessiner sur le canvas (résolution x devicePixelRatio pour netteté)
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = LENS_RADIUS * 2;
    const canvasSize = size * dpr;
    if (canvas.width !== canvasSize) {
      canvas.width = canvasSize;
      canvas.height = canvasSize;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(LENS_RADIUS, LENS_RADIUS, LENS_RADIUS, 0, Math.PI * 2);
    ctx.clip();

    // Fond
    ctx.fillStyle = panelKey === 'left' ? '#f3f4f6' : '#6b7280';
    ctx.fillRect(0, 0, size, size);

    // Dessiner l'image HD zoomée
    const srcRadius = LENS_RADIUS / ZOOM;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    if (panelKey === 'left') {
      // Panneau gauche : image originale + overlay
      ctx.drawImage(
        hdImg,
        natX - srcRadius, natY - srcRadius, srcRadius * 2, srcRadius * 2,
        0, 0, size, size
      );
      // Overlay par-dessus
      if (hdOverlayRef.current && hdOverlayRef.current.complete) {
        ctx.drawImage(
          hdOverlayRef.current,
          natX - srcRadius, natY - srcRadius, srcRadius * 2, srcRadius * 2,
          0, 0, size, size
        );
      }
    } else {
      // Panneau droit : overlay seul
      ctx.drawImage(
        hdImg,
        natX - srcRadius, natY - srcRadius, srcRadius * 2, srcRadius * 2,
        0, 0, size, size
      );
    }

    ctx.restore();

    // Réticule avec graduation 0.25mm
    ctx.save();
    ctx.beginPath();
    ctx.arc(LENS_RADIUS, LENS_RADIUS, LENS_RADIUS, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = 1;
    // Ligne horizontale
    ctx.beginPath();
    ctx.moveTo(0, LENS_RADIUS);
    ctx.lineTo(LENS_RADIUS * 2, LENS_RADIUS);
    ctx.stroke();
    // Ligne verticale
    ctx.beginPath();
    ctx.moveTo(LENS_RADIUS, 0);
    ctx.lineTo(LENS_RADIUS, LENS_RADIUS * 2);
    ctx.stroke();
    // 5 cercles noirs à équidistance + label 0.25mm
    const step = LENS_RADIUS / 5;
    for (let i = 1; i <= 5; i++) {
      ctx.beginPath();
      ctx.arc(LENS_RADIUS, LENS_RADIUS, step * i, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Label 0.25mm sur le premier cercle
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('0.25mm', LENS_RADIUS + step + 2, LENS_RADIUS - 2);
    ctx.restore();

    // Bordure extérieure
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

  // ── Minuteur pour les opérations longues ──
  const [workingMessage, setWorkingMessage] = useState(null); // ex: "Je corrige les finesses"
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef(null);

  const startTimer = (message) => {
    setWorkingMessage(message);
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
  };
  const stopTimer = () => {
    setWorkingMessage(null);
    setElapsedSeconds(0);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const handleCorrect = async () => {
    if (!onCorrectFinesse) return;
    setIsCorrecting(true);
    startTimer('Je corrige les finesses');
    await onCorrectFinesse(file.id, correctionIntensity);
    stopTimer();
    setIsCorrecting(false);
  };

  const handleExpand = async () => {
    if (!onExpandBordure) return;
    setIsExpanding(true);
    startTimer('Épaississement des bordures');
    await onExpandBordure(file.id);
    stopTimer();
    setIsExpanding(false);
  };

  const handleSave = async () => {
    if (!onSave || !file.correctedSrc) return;
    setIsSaving(true);
    startTimer('Enregistrement en cours');
    await onSave(file.id);
    stopTimer();
    setIsSaving(false);
  };

  // Fermeture : si modifié, afficher le dialogue de confirmation
  const handleRequestClose = () => {
    if (file.correctedSrc) {
      setShowConfirm(true);
    } else {
      onClose(false); // pas modifié, fermer directement
    }
  };

  const handleConfirmSave = async () => {
    setShowConfirm(false);
    setIsSaving(true);
    await onSave(file.id);
    setIsSaving(false);
    onClose(false); // déjà sauvegardé
  };

  const handleConfirmNoSave = () => {
    setShowConfirm(false);
    onClose(false); // fermer sans sauvegarder
  };

  const handleConfirmCancel = () => {
    setShowConfirm(false); // rester dans la modale
  };

  if (!file) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      onClick={handleRequestClose}
    >
      <div
        className="bg-white rounded-lg p-3 flex flex-col w-full h-full max-w-[95vw] max-h-[95vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-4">
            <h3 className="font-bold text-lg text-gray-800 truncate max-w-[400px]">
              Inspection : {file.name}
            </h3>
            {/* Slider zoom */}
            <div className="flex items-center gap-1 border-l border-gray-300 pl-3">
              <span className="text-[9px] text-gray-500">Zoom</span>
              <input type="range" min="0.5" max="2" step="0.1" value={zoomLevel}
                onChange={e => setZoomLevel(parseFloat(e.target.value))}
                className="w-20 accent-gray-600" />
              <span className="text-[10px] font-bold text-gray-700 w-6">x{zoomLevel}</span>
            </div>
            <button
              onClick={handleCorrect}
              disabled={isCorrecting || !file.hasIssues || file.correctedSrc}
              className={`px-4 py-1.5 rounded font-bold text-xs flex items-center gap-2 transition-all ${file.hasIssues && !isCorrecting && !file.correctedSrc ? 'bg-fuchsia-600 text-white hover:bg-fuchsia-700 shadow' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
            >
              <Icons.Maximize size={14} /> {isCorrecting ? 'Correction en cours...' : file.correctedSrc ? 'Déjà corrigé' : 'Corriger Finesses'}
            </button>
            <button
              onClick={handleExpand}
              disabled={isExpanding}
              className={`px-4 py-1.5 rounded font-bold text-xs flex items-center gap-2 transition-all ${!isExpanding ? 'bg-blue-600 text-white hover:bg-blue-700 shadow' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
            >
              <Icons.Maximize size={14} /> {isExpanding ? 'Épaississement...' : 'Bordure'}
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !file.correctedSrc}
              className={`px-4 py-1.5 rounded font-bold text-xs flex items-center gap-2 transition-all ${file.correctedSrc && !isSaving ? 'bg-green-600 text-white hover:bg-green-700 shadow' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
            >
              <Icons.Save size={14} /> {isSaving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
          <button
            onClick={handleRequestClose}
            className="bg-red-600 text-white rounded-full p-1 shadow hover:bg-red-700 transition-colors"
          >
            <Icons.X size={16} />
          </button>
        </div>

        {/* Panneaux — taille réelle avec scroll */}
        <div className="flex flex-1 gap-3 min-h-0">

          {/* Barre de couleurs de fond (côté gauche) */}
          <div className="flex flex-col gap-1.5 py-2 flex-shrink-0">
            {/* 6 patches tous personnalisables */}
            {patchColors.map((color, idx) => {
              const adjColor = adjustColor(color, hslAdjust.h, hslAdjust.s, hslAdjust.l);
              return (
                <div key={idx} className="relative w-7 h-7">
                  <button
                    onClick={() => setBgColor(adjColor)}
                    onDoubleClick={() => patchInputRefs.current[idx]?.click()}
                    title={`Patch ${idx + 1} — double-clic pour changer`}
                    className={`w-7 h-7 rounded border-2 transition-all ${bgColor === adjColor ? 'border-white ring-2 ring-blue-500 scale-110' : 'border-gray-400 hover:scale-105'}`}
                    style={{
                      backgroundColor: adjColor,
                      backgroundImage: bgTexture ? 'url(/image4.png)' : undefined,
                      backgroundSize: bgTexture ? 'cover' : undefined,
                      backgroundBlendMode: bgTexture ? 'multiply' : undefined,
                    }}
                  />
                  <input
                    type="color"
                    key={color}
                    defaultValue={color}
                    ref={el => patchInputRefs.current[idx] = el}
                    onChange={e => { savePatchColor(idx, e.target.value); setBgColor(adjustColor(e.target.value, hslAdjust.h, hslAdjust.s, hslAdjust.l)); }}
                    className="absolute opacity-0 pointer-events-none w-0 h-0"
                  />
                </div>
              );
            })}
            {/* Panneau HSL */}
            <div className="flex flex-col gap-1 mt-1 mb-0.5" style={{ width: 80 }}>
              {[
                { label: 'T', key: 'h', min: -180, max: 180, color: '#e879f9' },
                { label: 'S', key: 's', min: -100, max: 100, color: '#f97316' },
                { label: 'L', key: 'l', min: -100, max: 100, color: '#facc15' },
              ].map(({ label, key, min, max, color }) => (
                <div key={key} className="flex items-center gap-1">
                  <span className="text-[9px] font-bold w-3 text-gray-500">{label}</span>
                  <input
                    type="range" min={min} max={max} step="1"
                    value={hslAdjust[key]}
                    onChange={e => setHslAdjust(prev => ({ ...prev, [key]: parseInt(e.target.value) }))}
                    title={`${label} : ${hslAdjust[key] > 0 ? '+' : ''}${hslAdjust[key]}`}
                    style={{ width: 52, accentColor: color, cursor: 'pointer' }}
                  />
                  <span className="text-[8px] text-gray-400 w-5 text-right">{hslAdjust[key] > 0 ? '+' : ''}{hslAdjust[key]}</span>
                </div>
              ))}
              <button
                onClick={() => setHslAdjust({ h: 0, s: 0, l: 0 })}
                title="Réinitialiser"
                className="text-[9px] text-gray-400 hover:text-gray-700 text-center leading-none mt-0.5"
              >⟳ reset</button>
            </div>
            {/* Texture coton bio */}
            <button onClick={() => setBgTexture(!bgTexture)}
              title={bgTexture ? 'Retirer texture coton' : 'Texture coton bio'}
              className={`w-7 h-7 rounded border-2 text-[7px] font-bold leading-tight transition-all ${bgTexture ? 'border-green-600 ring-2 ring-green-400 scale-110' : 'border-gray-400 hover:scale-105'}`}
              style={{
                backgroundColor: '#f5f0e8',
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h12v1H0zm0 3h12v1H0zm0 3h12v1H0zm0 3h12v1H0z' fill='rgba(139,119,90,0.2)'/%3E%3Cpath d='M0 0v12h1V0zm3 0v12h1V0zm3 0v12h1V0zm3 0v12h1V0z' fill='rgba(139,119,90,0.15)'/%3E%3C/svg%3E")`,
              }}>
              <span style={{ color: '#6b8a3e' }}>&#127793;</span>
            </button>
            {/* Fond par défaut (gris moyen) */}
            <button onClick={() => { setBgColor('#9ca3af'); setBgTexture(false); }}
              title="Fond par défaut"
              className={`w-7 h-7 rounded border-2 transition-all ${bgColor === '#9ca3af' && !bgTexture ? 'border-white ring-2 ring-blue-500 scale-110' : 'border-gray-400 hover:scale-105'}`}
              style={{ backgroundColor: '#9ca3af' }} />
          </div>

          {/* Panneau gauche : original + overlay */}
          <div
            ref={leftPanelRef}
            className="w-1/2 h-full rounded border border-gray-300 overflow-auto cursor-crosshair flex items-center justify-center"
            style={{
              backgroundColor: bgColor,
              backgroundImage: bgTexture ? 'url(/texture-coton.png)' : undefined,
              backgroundSize: bgTexture ? '300px 300px' : undefined,
            }}
            onMouseMove={(e) => handleMouseMove('left', e)}
            onMouseLeave={handleMouseLeave}
          >
            <div style={{ position: 'relative', width: `${(file.widthPx || 1000) * SCALE_REAL * zoomLevel}px`, height: `${(file.heightPx || 1000) * SCALE_REAL * zoomLevel}px`, flexShrink: 0 }}>
              <img
                src={file.correctedSrc || `/uploads/${file.id}/converted.png`}
                alt="Original"
                style={{
                  width: '100%',
                  height: '100%',
                  imageRendering: 'crisp-edges',
                  position: 'absolute',
                  inset: 0,
                  zIndex: 1,
                }}
              />
              {file.overlaySrc && (
                <img
                  src={file.overlaySrc}
                  alt="Overlay finesses"
                  style={{
                    width: '100%',
                    height: '100%',
                    imageRendering: 'crisp-edges',
                    position: 'absolute',
                    inset: 0,
                    zIndex: 2,
                  }}
                />
              )}
            </div>
          </div>

          {/* Panneau droit : overlay seul */}
          <div
            ref={rightPanelRef}
            className="w-1/2 h-full rounded border border-gray-300 overflow-auto cursor-crosshair flex items-center justify-center"
            style={{ backgroundColor: '#6b7280' }}
            onMouseMove={(e) => handleMouseMove('right', e)}
            onMouseLeave={handleMouseLeave}
          >
            {file.overlaySrc ? (
              <div style={{ position: 'relative', width: `${(file.widthPx || 1000) * SCALE_REAL * zoomLevel}px`, height: `${(file.heightPx || 1000) * SCALE_REAL * zoomLevel}px`, flexShrink: 0 }}>
                <img
                  src={file.overlaySrc}
                  alt="Défauts"
                  style={{
                    width: '100%',
                    height: '100%',
                    imageRendering: 'crisp-edges',
                  }}
                />
              </div>
            ) : (
              <span className="text-white text-sm font-bold absolute inset-0 flex items-center justify-center">Aucun défaut détecté</span>
            )}
          </div>
        </div>

        {/* Overlay minuteur pendant correction/épaississement/sauvegarde */}
        {workingMessage && (
          <div className="absolute inset-0 z-50 bg-black/70 flex flex-col items-center justify-center rounded-lg">
            <div className="animate-spin-slow text-white mb-4">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
                <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
              </svg>
            </div>
            <div className="text-white text-xl font-bold mb-2">{workingMessage}</div>
            <div className="text-white/70 text-lg font-mono">
              {Math.floor(elapsedSeconds / 60).toString().padStart(2, '0')}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
            </div>
          </div>
        )}

        {/* Loupe — toujours montée, positionnée en fixed */}
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
        <div className="flex items-center justify-between pt-2 border-t border-gray-200 mt-2 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-xs">
              <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: '#00ff00' }}></span>
              <span className="text-gray-600 font-medium">= Finesse détectée</span>
            </span>
          </div>
          <span className="text-xs text-gray-400">
            Mode Loupe : survolez l'image (x{ZOOM}) — graduation : 0.25mm
          </span>
        </div>
      </div>

      {/* Dialogue de confirmation à la fermeture */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white rounded-lg shadow-2xl p-6 max-w-sm w-full mx-4">
            <h4 className="font-bold text-lg text-gray-800 mb-2">Image modifiée</h4>
            <p className="text-sm text-gray-600 mb-6">
              L'image a été corrigée. Voulez-vous enregistrer les modifications ?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleConfirmCancel}
                className="px-4 py-2 rounded text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleConfirmNoSave}
                className="px-4 py-2 rounded text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
              >
                Ne pas enregistrer
              </button>
              <button
                onClick={handleConfirmSave}
                className="px-4 py-2 rounded text-sm font-medium text-white bg-green-600 hover:bg-green-700 transition-colors"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
