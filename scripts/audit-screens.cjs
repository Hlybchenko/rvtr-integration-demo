const fs = require('fs');
const { PNG } = require('pngjs');

const files = [
  { name: 'phone',   path: 'src/assets/devices/phone.png',   cfgW: 500,  cfgH: 787  },
  { name: 'laptop',  path: 'src/assets/devices/laptop.png',  cfgW: 1920, cfgH: 1080 },
  { name: 'kiosk',   path: 'src/assets/devices/kiosk.png',   cfgW: 561,  cfgH: 1267 },
  { name: 'holobox', path: 'src/assets/devices/holobox.png', cfgW: 1600, cfgH: 1600 },
];

for (const f of files) {
  const buf = fs.readFileSync(f.path);
  const png = PNG.sync.read(buf);
  const { width: w, height: h, data } = png;

  const alphaAt = (x, y) => data[(y * w + x) * 4 + 3];
  const threshold = 16;
  const isTrans = (x, y) => alphaAt(x, y) < threshold;

  // Flood-fill exterior transparent
  const visited = new Uint8Array(w * h);
  const queue = [];
  const seed = (x, y) => {
    const i = y * w + x;
    if (visited[i] || !isTrans(x, y)) return;
    visited[i] = 1;
    queue.push(i);
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { seed(0, y); seed(w - 1, y); }
  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head];
    const x = idx % w, y = Math.floor(idx / w);
    if (x > 0) seed(x - 1, y);
    if (x + 1 < w) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y + 1 < h) seed(x, y + 1);
  }

  // Find largest interior transparent hole
  let bestArea = 0, bestRect = null;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (visited[i] || !isTrans(x, y)) continue;
      let minX = x, minY = y, maxX = x, maxY = y, area = 0;
      const hq = [i];
      visited[i] = 2;
      for (let hh = 0; hh < hq.length; hh++) {
        const hi = hq[hh];
        const px = hi % w, py = Math.floor(hi / w);
        area++;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        const neighbors = [[px-1,py],[px+1,py],[px,py-1],[px,py+1]];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const ni = ny * w + nx;
            if (!visited[ni] && isTrans(nx, ny)) { visited[ni] = 2; hq.push(ni); }
          }
        }
      }
      if (area > bestArea) {
        bestArea = area;
        bestRect = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
      }
    }
  }

  const dimOk = w === f.cfgW && h === f.cfgH;
  console.log('');
  console.log('=== ' + f.name.toUpperCase() + ' ===');
  console.log('PNG size:    ' + w + 'x' + h + '  config: ' + f.cfgW + 'x' + f.cfgH + '  ' + (dimOk ? 'OK' : 'MISMATCH'));
  if (bestRect) {
    console.log('Screen hole: x=' + bestRect.x + ' y=' + bestRect.y + ' w=' + bestRect.w + ' h=' + bestRect.h);
    const pct = (bestArea / (w * h) * 100).toFixed(1);
    console.log('Hole area:   ' + bestArea + ' px (' + pct + '% of image)');
    console.log('Reasonable:  ' + (parseFloat(pct) > 3 ? 'YES' : 'WARNING - very small'));
  } else {
    console.log('Screen hole: NOT FOUND');
  }
}
