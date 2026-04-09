// ============================================================
//  Modals.jsx — Upload overlay, warning quantité, alerte erreur
// ============================================================

import { useState, useEffect, useRef } from 'react';
import { MAX_QUANTITY } from '../lib/constants';

export function UploadOverlay({ uploadStatus }) {
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (uploadStatus) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } else {
      setElapsed(0);
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [uploadStatus]);

  if (!uploadStatus) return null;
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999]">
      <div className="bg-gray-900 rounded-2xl px-16 py-10 text-center text-white shadow-2xl">
        <div className="text-6xl mb-4 animate-spin-slow">&#9203;</div>
        <div className="text-xl font-bold mb-2">{uploadStatus.step}</div>
        <div className="text-base text-gray-300 mb-1">{uploadStatus.fileName}</div>
        <div className="text-sm text-gray-500">{uploadStatus.current > 0 ? `Fichier ${uploadStatus.current} / ${uploadStatus.total}` : ''}</div>
        <div className="text-white/70 text-lg font-mono mt-2">
          {Math.floor(elapsed / 60).toString().padStart(2, '0')}:{(elapsed % 60).toString().padStart(2, '0')}
        </div>
      </div>
    </div>
  );
}

export function QuantityWarning({ quantityWarning, setQuantityWarning, handleMonter, launchOptimal }) {
  if (!quantityWarning) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md mx-4 border-2 border-orange-400">
        <div className="flex items-center gap-2 mb-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <h3 className="text-lg font-bold text-orange-700">Nombre &eacute;lev&eacute; de transferts command&eacute;s : {quantityWarning.totalQty}</h3>
        </div>
        <p className="text-sm text-gray-700 mb-3">Nous vous recommandons de ne pas d&eacute;passer {MAX_QUANTITY} pi&egrave;ces au total.</p>
        <p className="text-sm text-gray-700 mb-4 font-medium">Voulez-vous lancer n&eacute;anmoins le calcul ?</p>
        <div className="flex justify-center gap-3">
          <button onClick={() => {
            setQuantityWarning(null);
            if (quantityWarning.action === 'monter') {
              handleMonter(true);
            } else {
              launchOptimal(true);
            }
          }}
            className="px-5 py-2 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 transition-colors">
            Oui
          </button>
          <button onClick={() => setQuantityWarning(null)}
            className="px-5 py-2 bg-gray-200 text-gray-700 font-bold rounded-lg hover:bg-gray-300 transition-colors">
            Je modifie ma demande
          </button>
        </div>
      </div>
    </div>
  );
}

export function ErrorAlert({ errorAlert, setErrorAlert }) {
  if (!errorAlert) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-xl shadow-2xl p-6 max-w-md mx-4 border-2 border-red-500">
        <div className="flex items-center gap-2 mb-3">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <h3 className="text-lg font-bold text-red-700">{errorAlert.title}</h3>
        </div>
        <p className="text-sm text-gray-700 mb-3">{errorAlert.message}</p>
        <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
          <p className="text-sm text-blue-800"><b>Suggestion :</b> {errorAlert.solution}</p>
        </div>
        <div className="flex justify-end">
          <button onClick={() => setErrorAlert(null)}
            className="px-6 py-2 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
