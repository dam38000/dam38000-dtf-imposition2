import { useState, useRef, useCallback, useEffect } from 'react';
import { Icons } from './Icons';

// ── Conversion HSV ↔ Hex (color picker style Photoshop) ──
function hexToHsv(hex) {
  const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max===r) h = ((g-b)/d + (g<b?6:0))/6;
    else if (max===g) h = ((b-r)/d+2)/6;
    else h = ((r-g)/d+4)/6;
  }
  const s = max === 0 ? 0 : d/max;
  return { h: Math.round(h*360), s: Math.round(s*100), v: Math.round(max*100) };
}
function hsvToHex(h, s, v) {
  h = ((h%360)+360)%360; s = Math.max(0,Math.min(100,s))/100; v = Math.max(0,Math.min(100,v))/100;
  const c = v*s, x = c*(1-Math.abs((h/60)%2-1)), m = v-c;
  let r,g,b;
  if(h<60){r=c;g=x;b=0;}else if(h<120){r=x;g=c;b=0;}else if(h<180){r=0;g=c;b=x;}
  else if(h<240){r=0;g=x;b=c;}else if(h<300){r=x;g=0;b=c;}else{r=c;g=0;b=x;}
  const hex2=v=>Math.round((v+m)*255).toString(16).padStart(2,'0');
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

const ZOOM = 5;
const LENS_RADIUS = 120;

// Écran 20" Full HD ≈ 96 DPI écran, image à 300 DPI → ratio = 96/300 ≈ 0.32
// Pour taille réelle : 1mm image = 1mm écran
const SCREEN_DPI = 96;
const IMAGE_DPI = 300;
const SCALE_REAL = SCREEN_DPI / IMAGE_DPI; // ~0.32 = taille réelle

export default function FinesseModal_SeriLight({ file, finesse, onClose, onCorrectFinesse, onExpandBordure, onSave }) {
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1); // 1 = taille réelle, 2 = x2
  const correctionIntensity = 1.3; // intensité fixe
  const [showConfirm, setShowConfirm] = useState(false);
  const [bgColor, setBgColor] = useState('#9ca3af'); // fond du panneau gauche (gris moyen)
  const [borderOverlaySrc, setBorderOverlaySrc] = useState(null);
  const [borderOpacity, setBorderOpacity] = useState(0);
  const [dilatedOpacity, setDilatedOpacity] = useState(0);
  const [tissuMode, setTissuMode] = useState('clair'); // 'clair' | 'fonce' | null (manuel)
  const [showFoncePopup, setShowFoncePopup] = useState(false);
  const [showContour, setShowContour] = useState(false);
  const [contourColor, setContourColor] = useState(null); // couleur figée du contour
  const BORDER_WIDTH = 5; // px
  const [bgMode, setBgMode] = useState('plain'); // 'texture' | 'custom' | 'plain'
  const [customBgData, setCustomBgData] = useState(() => localStorage.getItem('serilight_finesse_custom_bg') || null);
  const [customBgScale, setCustomBgScale] = useState(() => parseFloat(localStorage.getItem('serilight_finesse_custom_bg_scale')) || 1);
  const customBgInputRef = useRef(null);
  const texBlend = 'luminosity';
  // Compat avec ancien code
  const bgTexture = bgMode === 'texture';
  const customBgImage = bgMode === 'custom' ? customBgData : null;
  const [showOverlay, setShowOverlay] = useState(true); // afficher overlay finesses
  // Couleurs personnalisables (sauvegardées en localStorage)

  const [patchColors, setPatchColors] = useState(() => [
    localStorage.getItem('serilight_finesse_patch0') || '#2563eb',
    localStorage.getItem('serilight_finesse_patch1') || '#dc2626',
    localStorage.getItem('serilight_finesse_patch2') || '#16a34a',
    localStorage.getItem('serilight_finesse_patch3') || '#1a1a1a',
    localStorage.getItem('serilight_finesse_patch4') || '#ff9800',
    localStorage.getItem('serilight_finesse_patch5') || '#9c27b0',
  ]);

  const savePatchColor = (idx, color) => {
    setPatchColors(prev => { const next = [...prev]; next[idx] = color; return next; });
    localStorage.setItem(`serilight_finesse_patch${idx}`, color);
    setBgColor(color);
  };
  const patchInputRefs = useRef([]);

  // Éditeur couleur (HSV) — style Photoshop
  const [hslEditor, setHslEditor] = useState(null); // { idx, h, s, v, original }
  const areaRef = useRef(null);
  const areaDragging = useRef(false);
  const openHslEditor = (idx) => {
    const { h, s, v } = hexToHsv(patchColors[idx]);
    setHslEditor({ idx, h, s, v, original: patchColors[idx] });
  };
  const confirmHslEditor = () => {
    if (!hslEditor) return;
    savePatchColor(hslEditor.idx, hsvToHex(hslEditor.h, hslEditor.s, hslEditor.v));
    setHslEditor(null);
  };
  const cancelHslEditor = () => {
    if (!hslEditor) return;
    savePatchColor(hslEditor.idx, hslEditor.original);
    setHslEditor(null);
  };
  const handleAreaPointer = useCallback((e) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = Math.round(Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100)));
    const v = Math.round(Math.max(0, Math.min(100, 100 - ((e.clientY - rect.top) / rect.height) * 100)));
    setHslEditor(prev => {
      const updated = { ...prev, s, v };
      setBgColor(hsvToHex(updated.h, updated.s, updated.v));
      return updated;
    });
  }, []);

  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);
  const lensCanvasRef = useRef(null);
  const lensRef = useRef(null);

  // Drag-to-pan
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0, panel: null });

  const handleMouseDown = useCallback((panelKey, e) => {
    const panel = (panelKey === 'left' ? leftPanelRef : rightPanelRef).current;
    if (!panel) return;
    isDragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, scrollLeft: panel.scrollLeft, scrollTop: panel.scrollTop, panel };
    panel.style.cursor = 'grabbing';
    e.preventDefault();
  }, []);

  const handleMouseUp = useCallback(() => {
    if (isDragging.current && dragStart.current.panel) {
      dragStart.current.panel.style.cursor = '';
    }
    isDragging.current = false;
  }, []);

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

  // Mise à jour automatique bordure/dilaté selon le mode tissu et la luminance
  useEffect(() => {
    if (!tissuMode) return;
    const r = parseInt(bgColor.slice(1,3),16), g = parseInt(bgColor.slice(3,5),16), b = parseInt(bgColor.slice(5,7),16);
    const L = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    if (tissuMode === 'clair') {
      setBorderOpacity(L < 200 ? 1 : 0);
      setDilatedOpacity(0);
    } else if (tissuMode === 'fonce') {
      setBorderOpacity(0);
      setDilatedOpacity(1);
    }
  }, [bgColor, tissuMode]);

  // Générer l'overlay de bordure intérieure (5px le long du contour alpha)
  useEffect(() => {
    if (!file) return;
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.src = file.correctedSrc || `/uploads/${file.id}/converted.png`;
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, w, h);
      const alpha = imgData.data;

      // Créer un masque : pixel opaque (alpha > 10) = 1, sinon 0
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        mask[i] = alpha[i * 4 + 3] > 10 ? 1 : 0;
      }

      // Éroder le masque de BORDER_WIDTH pixels (trouver les pixels intérieurs proches du bord)
      const eroded = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (mask[y * w + x] === 0) continue;
          let isInner = true;
          for (let dy = -BORDER_WIDTH; dy <= BORDER_WIDTH && isInner; dy++) {
            for (let dx = -BORDER_WIDTH; dx <= BORDER_WIDTH && isInner; dx++) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || nx >= w || ny < 0 || ny >= h || mask[ny * w + nx] === 0) {
                isInner = false;
              }
            }
          }
          eroded[y * w + x] = isInner ? 1 : 0;
        }
      }

      // Bordure = masque original - érodé (pixels opaques mais pas intérieurs)
      // On crée un masque blanc opaque sur la zone de bordure
      const borderCanvas = document.createElement('canvas');
      borderCanvas.width = w;
      borderCanvas.height = h;
      const bCtx = borderCanvas.getContext('2d');
      const borderData = bCtx.createImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        if (mask[i] === 1 && eroded[i] === 0) {
          borderData.data[i * 4] = 255;     // R (blanc)
          borderData.data[i * 4 + 1] = 255; // G
          borderData.data[i * 4 + 2] = 255; // B
          borderData.data[i * 4 + 3] = 255; // A
        }
      }
      bCtx.putImageData(borderData, 0, 0);
      setBorderOverlaySrc(borderCanvas.toDataURL('image/png'));

      console.log('[Bordure] Overlay bordure généré:', w, 'x', h);
    };
  }, [file?.id, file?.correctedSrc, BORDER_WIDTH]);

  const LOUPE_ACTIVE = false; // passer à true pour réactiver la loupe

  const handleMouseMove = useCallback((panelKey, e) => {
    // Drag-to-pan en priorité
    if (isDragging.current && dragStart.current.panel) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      dragStart.current.panel.scrollLeft = dragStart.current.scrollLeft - dx;
      dragStart.current.panel.scrollTop = dragStart.current.scrollTop - dy;
      const lensEl = lensRef.current;
      if (lensEl) lensEl.style.display = 'none';
      return;
    }

    if (!LOUPE_ACTIVE) return; // loupe suspendue

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
    console.log('[FinesseModal] handleSave déclenché, lancement timer');
    setIsSaving(true);
    startTimer('Enregistrement en cours');
    await onSave(file.id);
    console.log('[FinesseModal] handleSave terminé');
    stopTimer();
    setIsSaving(false);
  };

  // Fermeture : si modifié (correction ou bordure/dilatation), afficher le dialogue
  const hasBorderChanges = (borderOpacity > 0 || dilatedOpacity > 0) && file.dilated4Src;
  const handleRequestClose = () => {
    if (file.correctedSrc || hasBorderChanges) {
      setShowConfirm(true);
    } else {
      onClose(false);
    }
  };

  const handleConfirmSave = async () => {
    setShowConfirm(false);
    setIsSaving(true);
    startTimer('Enregistrement en cours');
    try {
      // 1) Si correction finesses, sauvegarder d'abord
      if (file.correctedSrc) {
        await onSave(file.id);
      }
      // 2) Si bordure/dilatation modifiées, composer puis sauvegarder
      if (hasBorderChanges) {
        const resp = await fetch('/api/analyze/compose-border', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ file_id: file.id, border_opacity: borderOpacity, dilated_opacity: dilatedOpacity }),
        });
        if (resp.ok) {
          // Sauvegarder le composé
          await fetch('/api/analyze/save-correction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: file.id, source: 'composed' }),
          });
        }
      }
    } catch (err) {
      console.error('[FinesseModal] Erreur sauvegarde:', err);
    }
    stopTimer();
    setIsSaving(false);
    onClose(false);
  };

  const handleConfirmNoSave = () => {
    setShowConfirm(false);
    onClose(false);
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
        className={`bg-white rounded-lg p-3 flex flex-col w-full h-full max-w-[95vw] max-h-[95vh] transition-all duration-300 ${isSaving ? 'blur-[2px]' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">

            {/* Groupe Zoom */}
            <div title="Agrandir ou réduire l'affichage de l'image (ne modifie pas la résolution)" className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Zoom</span>
              <input type="range" min="0.5" max="2" step="0.1" value={zoomLevel}
                onChange={e => setZoomLevel(parseFloat(e.target.value))}
                className="w-24 accent-gray-600" />
              <span className="text-[11px] font-bold text-gray-700 w-7 text-right">×{zoomLevel}</span>
            </div>

            <div className="w-px h-7 bg-gray-200 mx-1" />

            {/* Groupe Actions finesses */}
            <div className="w-px h-7 bg-gray-200 mx-1" />

            {/* Slider bordure intérieure */}
            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Bordure</span>
              <input type="range" min="0" max="1" step="0.05" value={borderOpacity}
                onChange={e => { setBorderOpacity(parseFloat(e.target.value)); setTissuMode(null); }}
                title={`Opacité bordure : ${Math.round(borderOpacity * 100)}%`}
                className="w-16 accent-red-500" />
              <span className="text-[10px] font-bold text-gray-600 w-7">{Math.round(borderOpacity * 100)}%</span>
            </div>

            {/* Slider dilaté */}
            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Dilaté</span>
              <input type="range" min="0" max="1" step="0.05" value={dilatedOpacity}
                onChange={e => { setDilatedOpacity(parseFloat(e.target.value)); setTissuMode(null); }}
                title={`Opacité dilaté : ${Math.round(dilatedOpacity * 100)}%`}
                className="w-16 accent-blue-500" />
              <span className="text-[10px] font-bold text-gray-600 w-7">{Math.round(dilatedOpacity * 100)}%</span>
            </div>

            {/* Presets tissu */}
            {(() => {
              const r = parseInt(bgColor.slice(1,3),16), g = parseInt(bgColor.slice(3,5),16), b = parseInt(bgColor.slice(5,7),16);
              const L = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
              return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${L > 128 ? 'bg-yellow-100 text-yellow-800' : 'bg-gray-700 text-white'}`}>L={L}</span>;
            })()}
            <button onClick={() => {
              if (showFoncePopup) { alert('Fermez la fenêtre tissu foncé'); return; }
              setTissuMode(tissuMode === 'clair' ? null : 'clair');
            }}
              className={`px-2 py-1 rounded-md text-[10px] font-bold border transition-all ${showFoncePopup ? 'bg-gray-200 text-gray-400 border-gray-300 cursor-not-allowed' : tissuMode === 'clair' ? 'bg-yellow-300 text-yellow-900 border-yellow-500 ring-2 ring-yellow-400' : 'bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-200'}`}>
              Version tissu clair
            </button>
            <button onClick={() => {
              if (tissuMode === 'fonce') { setTissuMode(null); setShowFoncePopup(false); setShowContour(false); setContourColor(null); }
              else { setTissuMode('fonce'); setShowFoncePopup(true); setDilatedOpacity(1); }
            }}
              className={`px-2 py-1 rounded-md text-[10px] font-bold border transition-all ${tissuMode === 'fonce' ? 'bg-gray-900 text-white border-blue-500 ring-2 ring-blue-400' : 'bg-gray-700 text-white border-gray-600 hover:bg-gray-800'}`}>
              Version tissu foncé
            </button>

            <div className="w-px h-7 bg-gray-200 mx-1" />

            {/* Enregistrer */}
            <button
              onClick={handleSave}
              disabled={isSaving || !file.correctedSrc}
              title={!file.correctedSrc ? "Aucune correction à enregistrer" : "Sauvegarder l'image corrigée — remplace l'original pour l'imposition"}
              className={`px-4 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all ${file.correctedSrc && !isSaving ? 'bg-green-600 text-white hover:bg-green-700 shadow-sm' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
            >
              <Icons.Save size={13} />
              {isSaving ? 'Enregistrement…' : 'Enregistrer'}
            </button>

          </div>

          <button
            onClick={handleRequestClose}
            title="Fermer la fenêtre de correction des finesses"
            className="bg-red-500 text-white rounded-full p-1.5 shadow hover:bg-red-600 transition-colors ml-3"
          >
            <Icons.X size={14} />
          </button>
        </div>

        {/* Panneaux — taille réelle avec scroll */}
        <div className="flex flex-1 gap-3 min-h-0 relative">

          {/* Texte mode tissu — superposé en haut des panneaux */}
          {tissuMode && (
            <div className="absolute top-4 left-0 right-0 z-40 flex justify-center pointer-events-none">
              <span className={`text-[22px] font-bold italic px-6 py-1 rounded-lg shadow-lg ${tissuMode === 'clair' ? 'text-yellow-800 bg-yellow-100/90' : 'text-blue-200 bg-gray-800/90'}`}>
                {tissuMode === 'clair' ? 'dessin modifié pour tissus clairs' : 'dessin modifié pour tissus foncés'}
              </span>
            </div>
          )}

          {/* Barre de couleurs de fond (côté gauche) */}
          <div className="flex flex-col gap-1.5 py-2 flex-shrink-0">
            {patchColors.map((color, idx) => {
              const isCustom = true;
              return (
                <div key={idx} className="relative">
                  <button
                    onClick={() => { setBgColor(color); if (bgMode === 'custom') setBgMode('plain'); }}
                    onDoubleClick={() => isCustom ? openHslEditor(idx) : patchInputRefs.current[idx]?.click()}
                    title="Clic: appliquer — double-clic: changer couleur"
                    className={`w-7 h-7 rounded border-2 transition-all ${bgColor === color ? 'border-white ring-2 ring-blue-500 scale-110' : 'border-gray-400 hover:scale-105'}`}
                    style={{
                      backgroundColor: color,
                      ...(bgTexture ? {
                        backgroundImage: 'url(/image4.png)',
                        backgroundSize: '200% 200%',
                        backgroundPosition: 'center',
                        backgroundBlendMode: 'luminosity',
                      } : {}),
                    }} />
                  {!isCustom && (
                    <input type="color" value={color}
                      ref={el => patchInputRefs.current[idx] = el}
                      onChange={e => savePatchColor(idx, e.target.value)}
                      className="absolute inset-0 opacity-0 pointer-events-none w-7 h-7" />
                  )}
                </div>
              );
            })}
            {/* Texture coton bio */}
            <div className="flex flex-col items-center">
              <button onClick={() => setBgMode(bgMode === 'texture' ? 'plain' : 'texture')}
                title={bgTexture ? 'Retirer texture coton' : 'Texture coton bio'}
                className={`w-7 h-7 rounded border-2 text-[7px] font-bold leading-tight transition-all ${bgMode === 'texture' ? 'border-green-600 ring-2 ring-green-400 scale-110' : 'border-gray-400 hover:scale-105'}`}
                style={{
                  backgroundColor: '#f5f0e8',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='12' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h12v1H0zm0 3h12v1H0zm0 3h12v1H0zm0 3h12v1H0z' fill='rgba(139,119,90,0.2)'/%3E%3Cpath d='M0 0v12h1V0zm3 0v12h1V0zm3 0v12h1V0zm3 0v12h1V0z' fill='rgba(139,119,90,0.15)'/%3E%3C/svg%3E")`,
                }}>
                <span style={{ color: '#6b8a3e' }}>&#127793;</span>
              </button>
              <span className="text-[14px] text-gray-500 leading-tight text-center">fond<br/>tissu</span>
            </div>
            {/* Fond par défaut (gris moyen) */}
            <button onClick={() => { setBgColor('#9ca3af'); setBgMode('plain'); }}
              title="Fond par défaut"
              className={`w-7 h-7 rounded border-2 transition-all ${bgMode === 'plain' && bgColor === '#9ca3af' ? 'border-white ring-2 ring-blue-500 scale-110' : 'border-gray-400 hover:scale-105'}`}
              style={{ backgroundColor: '#9ca3af' }} />
            {/* Importer image tissu client + slider */}
            <div className="flex flex-col items-center gap-1">
              <button onClick={() => { customBgData ? setBgMode('custom') : customBgInputRef.current?.click(); }}
                onDoubleClick={() => customBgInputRef.current?.click()}
                title="Charger le scan de votre tissu (PNG ou JPG)"
                className={`w-7 h-7 rounded border-2 transition-all flex items-center justify-center text-[9px] font-bold ${bgMode === 'custom' ? 'border-blue-500 ring-2 ring-blue-400 scale-110' : 'border-gray-400 hover:scale-105'}`}
                style={{
                  backgroundColor: '#e5e7eb',
                  backgroundImage: customBgData ? `url(${customBgData})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}>
                {!customBgData && <span style={{ fontSize: '14px' }}>&#128247;</span>}
              </button>
              <span className="text-[14px] text-gray-500 leading-tight text-center">votre tissu<br/><span className="text-[9px] text-gray-400">(PNG, JPG)</span></span>
              {customBgData && (
                <>
                  <input type="range" min="0.5" max="2" step="0.1" value={customBgScale}
                    onChange={e => { const v = parseFloat(e.target.value); setCustomBgScale(v); localStorage.setItem('serilight_finesse_custom_bg_scale', String(v)); }}
                    title={`Taille : x${customBgScale}`}
                    className="accent-blue-500"
                    style={{ width: 50, height: 8 }} />
                  <span className="text-[7px] text-gray-400">x{customBgScale}</span>
                </>
              )}
            </div>
            <input
              ref={customBgInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  // Réduire l'image à max 400px pour tenir dans localStorage
                  const tmpImg = new Image();
                  tmpImg.onload = () => {
                    const maxSize = 400;
                    let w = tmpImg.naturalWidth, h = tmpImg.naturalHeight;
                    if (w > maxSize || h > maxSize) {
                      const ratio = Math.min(maxSize / w, maxSize / h);
                      w = Math.round(w * ratio);
                      h = Math.round(h * ratio);
                    }
                    const c = document.createElement('canvas');
                    c.width = w; c.height = h;
                    c.getContext('2d').drawImage(tmpImg, 0, 0, w, h);
                    const dataUrl = c.toDataURL('image/jpeg', 0.8);
                    console.log('[Tissu client] Taille réduite:', Math.round(dataUrl.length / 1024), 'Ko', `(${w}x${h})`);
                    setCustomBgData(dataUrl);
                    setCustomBgScale(1);
                    setBgMode('custom');
                    try {
                      localStorage.setItem('serilight_finesse_custom_bg', dataUrl);
                      localStorage.setItem('serilight_finesse_custom_bg_scale', '1');
                      console.log('[Tissu client] Sauvegardé dans localStorage');
                    } catch (err) {
                      console.error('[Tissu client] Erreur localStorage:', err.message);
                    }
                  };
                  tmpImg.src = reader.result;
                };
                reader.readAsDataURL(file);
                e.target.value = '';
              }}
            />
          </div>

          {/* Panneau gauche : original + overlay */}
          <div
            ref={leftPanelRef}
            className="w-1/2 h-full rounded border border-gray-300 overflow-auto cursor-grab"
            style={{
              backgroundColor: customBgImage ? undefined : bgColor,
              backgroundImage: customBgImage ? `url(${customBgImage})` : (bgTexture ? 'url(/image4.png)' : undefined),
              backgroundSize: customBgImage ? `${customBgScale * 100}%` : (bgTexture ? '200% 200%' : undefined),
              backgroundPosition: 'center',
              backgroundRepeat: customBgImage ? 'repeat' : undefined,
              backgroundBlendMode: customBgImage ? undefined : (bgTexture ? texBlend : undefined),
            }}
            onMouseDown={(e) => handleMouseDown('left', e)}
            onMouseUp={handleMouseUp}
            onMouseMove={(e) => handleMouseMove('left', e)}
            onMouseLeave={() => { handleMouseLeave(); handleMouseUp(); }}
          >
            <div style={{
              width: `max(100%, ${(file.widthPx || 1000) * SCALE_REAL * zoomLevel + 80}px)`,
              height: `max(100%, ${(file.heightPx || 1000) * SCALE_REAL * zoomLevel + 80}px)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ position: 'relative', width: `${(file.widthPx || 1000) * SCALE_REAL * zoomLevel}px`, height: `${(file.heightPx || 1000) * SCALE_REAL * zoomLevel}px`, flexShrink: 0 }}>
                {/* Image dilatée (sous l'originale) */}
                {/* Contour 7px couleur figée en arrière-plan */}
                {showContour && contourColor && file.contour7Src && (
                  <div style={{
                    width: '100%', height: '100%',
                    position: 'absolute', inset: 0, zIndex: 0,
                    backgroundColor: contourColor,
                    WebkitMaskImage: `url(${file.contour7Src})`,
                    WebkitMaskSize: '100% 100%',
                    maskImage: `url(${file.contour7Src})`,
                    maskSize: '100% 100%',
                  }} />
                )}
                {/* Image dilatée 4px */}
                {file.dilated4Src && dilatedOpacity > 0 && (
                  <img
                    src={file.dilated4Src}
                    alt="Dilaté"
                    style={{
                      width: '100%', height: '100%',
                      imageRendering: 'crisp-edges',
                      position: 'absolute', inset: 0, zIndex: 1,
                      opacity: dilatedOpacity,
                    }}
                  />
                )}
                <img
                  src={file.correctedSrc || `/uploads/${file.id}/converted.png`}
                  alt="Original"
                  style={{
                    width: '100%', height: '100%',
                    imageRendering: 'crisp-edges',
                    position: 'absolute', inset: 0, zIndex: 2,
                  }}
                />
                {/* Overlay finesses masqué pour SeriLight */}
                {borderOverlaySrc && borderOpacity > 0 && (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      position: 'absolute',
                      inset: 0,
                      zIndex: 3,
                      opacity: borderOpacity,
                      backgroundColor: bgColor,
                      backgroundImage: customBgImage ? `url(${customBgImage})` : (bgTexture ? 'url(/image4.png)' : undefined),
                      backgroundSize: customBgImage ? `${customBgScale * 100}%` : (bgTexture ? '200% 200%' : undefined),
                      backgroundPosition: 'center',
                      WebkitMaskImage: `url(${borderOverlaySrc})`,
                      WebkitMaskSize: '100% 100%',
                      maskImage: `url(${borderOverlaySrc})`,
                      maskSize: '100% 100%',
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Panneau droit : overlay seul */}
          <div
            ref={rightPanelRef}
            className="w-1/2 h-full rounded border border-gray-300 overflow-auto cursor-grab"
            style={{
              backgroundColor: customBgImage ? undefined : bgColor,
              backgroundImage: customBgImage ? `url(${customBgImage})` : (bgTexture ? 'url(/image4.png)' : undefined),
              backgroundSize: customBgImage ? `${customBgScale * 100}%` : (bgTexture ? '200% 200%' : undefined),
              backgroundPosition: 'center',
              backgroundRepeat: customBgImage ? 'repeat' : undefined,
              backgroundBlendMode: customBgImage ? undefined : (bgTexture ? texBlend : undefined),
            }}
            onMouseDown={(e) => handleMouseDown('right', e)}
            onMouseUp={handleMouseUp}
            onMouseMove={(e) => handleMouseMove('right', e)}
            onMouseLeave={() => { handleMouseLeave(); handleMouseUp(); }}
          >
            <div style={{
              width: `max(100%, ${(file.widthPx || 1000) * SCALE_REAL * zoomLevel + 80}px)`,
              height: `max(100%, ${(file.heightPx || 1000) * SCALE_REAL * zoomLevel + 80}px)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {/* Panneau droit vide pour SeriLight */}
              <span className="text-gray-400 text-sm font-bold text-center leading-relaxed">Panneau de visualisation</span>
            </div>
          </div>
        </div>

        {/* Overlay minuteur pendant correction/épaississement/sauvegarde */}
        {workingMessage && (
          <div className="fixed inset-0 z-[9999] bg-black/70 flex flex-col items-center justify-center">
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

      {/* Modale color picker — style Photoshop */}
      {hslEditor && (() => {
        const currentHex = hsvToHex(hslEditor.h, hslEditor.s, hslEditor.v);
        return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center"
          onClick={e => e.stopPropagation()}>
          <div className="bg-white rounded-xl shadow-2xl p-4 w-72"
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded border border-gray-300 shadow-sm flex-shrink-0"
                  style={{ backgroundColor: currentHex }} />
                <div>
                  <span className="text-sm font-bold text-gray-700">Patch {hslEditor.idx + 1}</span>
                  <div className="flex gap-2 text-[10px] font-mono text-gray-500">
                    <span>R{parseInt(currentHex.slice(1,3),16)}</span>
                    <span>G{parseInt(currentHex.slice(3,5),16)}</span>
                    <span>B{parseInt(currentHex.slice(5,7),16)}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={confirmHslEditor}
                  className="px-3 py-1 rounded text-xs font-bold text-white bg-green-500 hover:bg-green-600">✓ OK</button>
                <button onClick={cancelHslEditor}
                  className="px-3 py-1 rounded text-xs font-bold text-white bg-red-400 hover:bg-red-500">✕</button>
              </div>
            </div>
            {/* Rectangle 2D : X=saturation, Y=luminosité (value) */}
            <div
              ref={areaRef}
              className="relative w-full rounded cursor-crosshair select-none"
              style={{
                height: 180,
                backgroundColor: `hsl(${hslEditor.h}, 100%, 50%)`,
                backgroundImage: 'linear-gradient(to right, #fff, transparent), linear-gradient(to top, #000, transparent)',
              }}
              onPointerDown={e => { areaDragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); handleAreaPointer(e); }}
              onPointerMove={e => { if (areaDragging.current) handleAreaPointer(e); }}
              onPointerUp={() => { areaDragging.current = false; }}
            >
              {/* Curseur rond */}
              <div className="absolute w-4 h-4 rounded-full border-2 border-white shadow-lg pointer-events-none"
                style={{
                  left: `calc(${hslEditor.s}% - 8px)`,
                  top: `calc(${100 - hslEditor.v}% - 8px)`,
                  backgroundColor: currentHex,
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.3)',
                }} />
            </div>
            {/* Slider teinte horizontal */}
            <div className="relative h-4 rounded-full mt-3"
              style={{ background: 'linear-gradient(to right,hsl(0,100%,50%),hsl(60,100%,50%),hsl(120,100%,50%),hsl(180,100%,50%),hsl(240,100%,50%),hsl(300,100%,50%),hsl(360,100%,50%))' }}>
              <input type="range" min="0" max="360" step="1"
                value={hslEditor.h}
                onChange={e => {
                  const updated = { ...hslEditor, h: parseInt(e.target.value) };
                  setHslEditor(updated);
                  setBgColor(hsvToHex(updated.h, updated.s, updated.v));
                }}
                className="absolute inset-0 w-full opacity-0 cursor-pointer h-full" />
              <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white shadow-lg pointer-events-none"
                style={{
                  left: `calc(${(hslEditor.h/360)*100}% - 8px)`,
                  backgroundColor: `hsl(${hslEditor.h}, 100%, 50%)`,
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.2), 0 2px 4px rgba(0,0,0,0.3)',
                }} />
            </div>
          </div>
        </div>
        );
      })()}

      {/* Popup choix couleur tissu foncé */}
      {showFoncePopup && (
        <div className="fixed top-1/2 right-10 -translate-y-1/2 z-[60]">
          <div className="bg-white rounded-xl shadow-2xl p-5 w-80 border-2 border-gray-300"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-800 mb-2">Vous avez choisi de mettre votre transfert sur un tissu foncé</h3>
            <p className="text-sm text-gray-600 mb-2">Choisissez la couleur de votre tissu parmi les patchs.</p>
            <p className="text-xs text-gray-400 italic mb-3">(en double cliquant sur le patch vous pouvez choisir une couleur)</p>
            <div className="w-12 h-12 rounded-lg border-2 border-gray-300 mx-auto mb-4 shadow-inner"
              style={{ backgroundColor: contourColor || bgColor }} />
            <div className="flex justify-center gap-3">
              <button onClick={(e) => {
                e.stopPropagation();
                setShowContour(true);
                setContourColor(bgColor);
              }}
                disabled={showContour}
                className={`px-5 py-2 font-bold rounded-lg transition-colors ${showContour ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-green-500 text-white hover:bg-green-600'}`}>
                OK
              </button>
              <button onClick={(e) => {
                e.stopPropagation();
                setShowFoncePopup(false);
                setShowContour(false);
                setContourColor(null);
                setTissuMode(null);
              }}
                className={`px-5 py-2 font-bold rounded-lg transition-colors ${showContour ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}>
                Annuler
              </button>
            </div>
            {showContour && (
              <p className="text-sm font-bold text-green-600 text-center mt-3">Vous avez choisi la couleur ci-dessus</p>
            )}
          </div>
        </div>
      )}

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
