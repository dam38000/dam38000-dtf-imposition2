// ============================================================
//  constants.js — Formats produits et limites
// ============================================================

export const PRODUCT_FORMATS = {
  'DTF': {
    'M1': { w: 1000, h: 575 }, 'A2': { w: 575, h: 420 }, 'A3': { w: 420, h: 280 },
    'A4': { w: 280, h: 202 }, 'A5': { w: 202, h: 132 }, 'A6': { w: 132, h: 93 },
  },
  'UV DTF': {
    'A2+': { w: 670, h: 480 }, 'A3+': { w: 480, h: 305 }, 'A4+': { w: 305, h: 232 },
    'A5+': { w: 232, h: 144.5 }, 'A6+': { w: 144.5, h: 104 }, 'A7+': { w: 104, h: 60 },
    'A8+': { w: 60, h: 44 },
  },
  'SeriQuadri': {
    'A3': { w: 404, h: 281 }, 'A4': { w: 281, h: 194 }, 'A5': { w: 194, h: 132 },
    'A6': { w: 132, h: 89 }, 'A7': { w: 89, h: 58 }, 'A8': { w: 58, h: 36 },
  },
  'SeriLight': {
    'A3': { w: 404, h: 281 }, 'A4': { w: 281, h: 194 }, 'A5': { w: 194, h: 132 },
    'A6': { w: 132, h: 89 }, 'A7': { w: 89, h: 58 }, 'A8': { w: 58, h: 36 },
  },
};

// ── Limite dynamique selon la RAM du client ──
function getMaxQuantity() {
  const ram = navigator.deviceMemory || 4; // en Go (fallback 4 Go si non supporté)
  if (ram <= 4) return 500;
  if (ram <= 8) return 1500;
  return 5000;
}
export const MAX_QUANTITY = getMaxQuantity();
