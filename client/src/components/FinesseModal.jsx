import { useState, useRef, useCallback, useEffect } from 'react';
import { Icons } from './Icons';

const ZOOM = 5;
const LENS_RADIUS = 120;

export default function FinesseModal({ file, finesse, onClose, onCorrectFinesse, onExpandBordure, onSave }) {
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
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

  const handleCorrect = async () => {
    if (!onCorrectFinesse) return;
    setIsCorrecting(true);
    await onCorrectFinesse(file.id);
    setIsCorrecting(false);
  };

  const handleExpand = async () => {
    if (!onExpandBordure) return;
    setIsExpanding(true);
    await onExpandBordure(file.id);
    setIsExpanding(false);
  };

  const handleSave = async () => {
    if (!onSave || !file.correctedSrc) return;
    setIsSaving(true);
    await onSave(file.id);
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
            <span className="text-[10px] text-white bg-orange-500 px-2 py-1 rounded font-bold uppercase">
              Seuil : {finesse} mm
            </span>
            <button
              onClick={handleCorrect}
              disabled={isCorrecting || !file.hasIssues}
              className={`px-4 py-1.5 rounded font-bold text-xs flex items-center gap-2 transition-all ${file.hasIssues && !isCorrecting ? 'bg-fuchsia-600 text-white hover:bg-fuchsia-700 shadow' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
            >
              <Icons.Maximize size={14} /> {isCorrecting ? 'Correction en cours...' : 'Corriger Finesses'}
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
            {file.correctedSrc && (
              <span className="text-[10px] text-white bg-green-600 px-2 py-1 rounded font-bold">
                Corrigé
              </span>
            )}
          </div>
          <button
            onClick={handleRequestClose}
            className="bg-red-600 text-white rounded-full p-1 shadow hover:bg-red-700 transition-colors"
          >
            <Icons.X size={16} />
          </button>
        </div>

        {/* Panneaux */}
        <div className="flex flex-1 gap-3 min-h-0">
          {/* Panneau gauche : original + overlay */}
          <div
            ref={leftPanelRef}
            className="w-1/2 h-full rounded border border-gray-300 overflow-hidden relative bg-gray-100 cursor-crosshair"
            onMouseMove={(e) => handleMouseMove('left', e)}
            onMouseLeave={handleMouseLeave}
          >
            <img
              src={file.correctedSrc || `/uploads/${file.id}/converted.png`}
              alt="Original"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
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
                  objectFit: 'contain',
                  imageRendering: 'crisp-edges',
                  position: 'absolute',
                  inset: 0,
                  zIndex: 2,
                }}
              />
            )}
            <span className="absolute top-2 left-2 z-10 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded">
              Original + Détection
            </span>
          </div>

          {/* Panneau droit : overlay seul */}
          <div
            ref={rightPanelRef}
            className="w-1/2 h-full rounded border border-gray-300 overflow-hidden relative cursor-crosshair"
            style={{ backgroundColor: '#6b7280' }}
            onMouseMove={(e) => handleMouseMove('right', e)}
            onMouseLeave={handleMouseLeave}
          >
            {file.overlaySrc ? (
              <img
                src={file.overlaySrc}
                alt="Défauts"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  imageRendering: 'crisp-edges',
                  position: 'absolute',
                  inset: 0,
                }}
              />
            ) : (
              <span className="text-white text-sm font-bold absolute inset-0 flex items-center justify-center">Aucun défaut détecté</span>
            )}
            <span className="absolute top-2 left-2 z-10 bg-black/60 text-white text-[10px] font-bold px-2 py-1 rounded">
              Finesses détectées (vert)
            </span>
          </div>
        </div>

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
