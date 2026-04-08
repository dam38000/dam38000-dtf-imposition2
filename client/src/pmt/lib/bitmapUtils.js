export const parseInput = (val) => {
  const cleanVal = String(val).replace(',', '.');
  return parseFloat(cleanVal) || 0;
};

export const createBitmapMask = async (imgSrc, widthMM, heightMM, marginMM, scale = 1) => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      const w = Math.ceil(widthMM * scale);
      const h = Math.ceil(heightMM * scale);
      const margin = Math.ceil(marginMM * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const data = imgData.data;
      const maskW = w + (margin * 2);
      const maskH = h + (margin * 2);
      const grid = new Uint8Array(maskW * maskH);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (data[(y * w + x) * 4 + 3] > 10) {
            const cx = x + margin;
            const cy = y + margin;
            for (let dy = -margin; dy <= margin; dy++) {
              for (let dx = -margin; dx <= margin; dx++) {
                if (dx * dx + dy * dy <= margin * margin) {
                  const nx = cx + dx;
                  const ny = cy + dy;
                  if (nx >= 0 && nx < maskW && ny >= 0 && ny < maskH) {
                    grid[ny * maskW + nx] = 1;
                  }
                }
              }
            }
          }
        }
      }
      resolve({ w: maskW, h: maskH, grid, margin, scale });
    };
    img.src = imgSrc;
  });
};
