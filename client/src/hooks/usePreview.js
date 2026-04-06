// ============================================================
//  usePreview.js — Scale homothétique de la planche
// ============================================================

import { useState, useRef, useEffect } from 'react';

export function usePreview(sheetSize) {
  const previewRef = useRef(null);
  const [previewScale, setPreviewScale] = useState(1);

  useEffect(() => {
    const container = previewRef.current;
    if (!container) return;
    const computeScale = () => {
      const padding = 16;
      const availW = container.clientWidth - padding * 2;
      const availH = container.clientHeight - padding * 2;
      if (availW <= 0 || availH <= 0) return;
      const scale = Math.min(availW / sheetSize.w, availH / sheetSize.h);
      setPreviewScale(scale);
    };
    computeScale();
    const ro = new ResizeObserver(computeScale);
    ro.observe(container);
    return () => ro.disconnect();
  }, [sheetSize.w, sheetSize.h]);

  return { previewRef, previewScale };
}
