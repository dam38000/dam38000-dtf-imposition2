import { parseInput } from '../lib/bitmapUtils';

export default function CutLinesOverlay({ items, width, height }) {
  const EPSILON = 0.5;
  const w = parseInput(width);
  const h = parseInput(height);
  const vCandidates = new Set();
  const hCandidates = new Set();

  items.forEach(item => {
    vCandidates.add(item.x);
    vCandidates.add(item.x + item.w);
    hCandidates.add(item.y);
    hCandidates.add(item.y + item.h);
  });

  const vCuts = Array.from(vCandidates).filter(x => {
    if (x <= EPSILON || x >= w - EPSILON) return false;
    return !items.some(item => x > item.x + EPSILON && x < item.x + item.w - EPSILON);
  });

  const hCuts = Array.from(hCandidates).filter(y => {
    if (y <= EPSILON || y >= h - EPSILON) return false;
    return !items.some(item => y > item.y + EPSILON && y < item.y + item.h - EPSILON);
  });

  return (
    <div className="absolute inset-0 pointer-events-none z-0">
      {vCuts.map(x => (
        <div key={`v-${x}`} className="absolute top-0 bottom-0 border-l border-red-600" style={{ left: `${x}px`, width: 0 }} />
      ))}
      {hCuts.map(y => (
        <div key={`h-${y}`} className="absolute left-0 right-0 border-t border-red-600" style={{ top: `${y}px`, height: 0 }} />
      ))}
    </div>
  );
}
