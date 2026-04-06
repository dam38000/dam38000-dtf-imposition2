// ============================================================
//  useFiles.js — Gestion fichiers : upload, drag&drop, crop, quantités
// ============================================================

import { useState, useRef, useCallback, useEffect } from 'react';

export function useFiles({ autoCrop, setErrorAlert, resetPlanche }) {
  const [files, setFiles] = useState([]);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // ── Upload d'un fichier vers /api/upload ──
  const uploadFile = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!response.ok) throw new Error(`Erreur serveur ${response.status}`);
    return await response.json();
  };

  // ── Gestion des fichiers selectionnes ──
  const handleFiles = useCallback(async (fileList) => {
    const validFiles = Array.from(fileList).filter(f =>
      /\.(pdf|tiff?|png)$/i.test(f.name) || f.type === 'application/pdf' || f.type === 'image/tiff' || f.type === 'image/png'
    );
    if (validFiles.length === 0) return;

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      try {
        setUploadStatus({ step: 'Chargement...', fileName: file.name, current: i + 1, total: validFiles.length });
        setUploadStatus({ step: 'Conversion ICC en cours...', fileName: file.name, current: i + 1, total: validFiles.length });

        const result = await uploadFile(file);

        if (result.error) {
          console.error(`Erreur upload ${file.name}:`, result.error);
          setErrorAlert({ title: 'Erreur d\'envoi', message: `Le fichier "${file.name}" n'a pas pu etre traite : ${result.error}`, solution: 'Verifiez le format du fichier (PDF, TIFF, PNG). Si le probleme persiste, contactez Printmytransfer au 04 76 36 61 15.' });
          continue;
        }

        setUploadStatus({ step: 'Finalisation...', fileName: file.name, current: i + 1, total: validFiles.length });

        setFiles(prev => [...prev, {
          id: result.id,
          name: result.name,
          type: result.type,
          width: result.width_mm,
          height: result.height_mm,
          widthPx: result.width_px,
          heightPx: result.height_px,
          hasAlpha: result.has_alpha,
          iccProfile: result.icc_profile,
          iccSource: result.icc_source,
          thumbnailUrl: result.thumbnail_url,
          quantity: 1,
        }]);
      } catch (err) {
        console.error(`Erreur upload ${file.name}:`, err);
        if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
          setErrorAlert({ title: 'Connexion perdue', message: `Impossible d'envoyer "${file.name}".`, solution: 'Verifiez votre connexion internet et reessayez.' });
        } else {
          setErrorAlert({ title: 'Erreur serveur', message: `Erreur lors de l'envoi de "${file.name}" : ${err.message}`, solution: 'Reessayez dans quelques instants. Si le probleme persiste, contactez Printmytransfer au 04 76 36 61 15.' });
        }
      }
    }
    setUploadStatus(null);
  }, [setErrorAlert]);

  // ── Drag & Drop ──
  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback(() => setIsDragging(false), []);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  // ── Input file change ──
  const handleFileInput = useCallback((e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  }, [handleFiles]);

  // ── Modifier quantite ──
  const updateQuantity = (id, delta) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, quantity: Math.max(1, f.quantity + delta) } : f));
    resetPlanche();
  };

  // ── Modifier dimension (largeur ou hauteur) ──
  const updateDimension = (id, field, value) => {
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0) {
      setFiles(prev => prev.map(f => f.id === id ? { ...f, [field]: num } : f));
      resetPlanche();
    }
  };

  // ── Supprimer un fichier ──
  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    resetPlanche();
  };

  // ── Rogner un fichier (auto-crop via serveur ImageMagick) ──
  const cropFile = useCallback(async (id, force = false) => {
    const f = files.find(x => x.id === id);
    if (!f || (!force && f.cropped)) return;
    try {
      console.log('[crop] Rognage de', f.name, '(id:', id, ')');
      const resp = await fetch(`/api/upload/trim/${id}`);
      if (!resp.ok) throw new Error(`Trim error ${resp.status}`);
      const data = await resp.json();
      console.log('[crop] Resultat:', data);
      setFiles(p => p.map(ff => ff.id !== id ? ff : {
        ...ff,
        width: data.trimmed.width_mm,
        height: data.trimmed.height_mm,
        widthPx: data.pixels.cropW,
        heightPx: data.pixels.cropH,
        thumbnailUrl: data.thumbnail_url,
        cropped: true,
      }));
      resetPlanche();
    } catch (err) {
      console.error('Erreur rognage:', err);
      setFiles(p => p.map(ff => ff.id !== id ? ff : { ...ff, cropped: true }));
    }
  }, [files, resetPlanche]);

  // ── Rogner tous les fichiers ──
  const cropAll = useCallback(() => {
    files.forEach(f => cropFile(f.id, true));
  }, [files, cropFile]);

  // ── Rognage automatique des nouveaux fichiers à l'ouverture ──
  useEffect(() => {
    if (!autoCrop) return;
    const uncropped = files.filter(f => !f.cropped);
    if (uncropped.length === 0) return;
    uncropped.forEach(f => cropFile(f.id));
  }, [files, autoCrop, cropFile]);

  // ── Tout effacer ──
  const clearAll = () => { setFiles([]); resetPlanche(); };

  return {
    files, setFiles,
    uploadStatus,
    isDragging,
    fileInputRef,
    handleDragOver, handleDragLeave, handleDrop,
    handleFileInput,
    updateQuantity, updateDimension,
    removeFile,
    cropFile, cropAll,
    clearAll,
  };
}
