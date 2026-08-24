import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Minimal PNG encoder in pure Node.js
function createPNG(width, height, getPixelRGBA) {
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixelRGBA(x, y);
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const idatData = zlib.deflateSync(rawData);

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) {
        c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
      }
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', idatData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Supersampling rasterizer: 32x32 output with 4x supersampling (128x128 grid)
function rasterize32(sampleFunc) {
  const SIZE = 32;
  const SCALE = 4;
  return createPNG(SIZE, SIZE, (x, y) => {
    let totalR = 0, totalG = 0, totalB = 0, totalA = 0;
    for (let sy = 0; sy < SCALE; sy++) {
      for (let sx = 0; sx < SCALE; sx++) {
        const px = x + (sx + 0.5) / SCALE;
        const py = y + (sy + 0.5) / SCALE;
        const [r, g, b, a] = sampleFunc(px, py);
        totalR += r * (a / 255);
        totalG += g * (a / 255);
        totalB += b * (a / 255);
        totalA += a;
      }
    }
    const count = SCALE * SCALE;
    const avgA = totalA / count;
    if (avgA <= 0) return [0, 0, 0, 0];
    const avgR = Math.round((totalR / count) / (avgA / 255));
    const avgG = Math.round((totalG / count) / (avgA / 255));
    const avgB = Math.round((totalB / count) / (avgA / 255));
    return [Math.min(255, avgR), Math.min(255, avgG), Math.min(255, avgB), Math.round(avgA)];
  });
}

// Distance to capsule: p from (x, y1) to (x, y2) with radius r
function distToVerticalCapsule(px, py, cx, y1, y2, r) {
  const cy = Math.max(y1, Math.min(y2, py));
  const dx = px - cx;
  const dy = py - cy;
  return Math.hypot(dx, dy) - r;
}

// Distance to line segment
function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

// Distance to arc (U-bracket for mic)
function distToUArc(px, py, cx, cy, radius, strokeWidth) {
  const dRadius = Math.abs(Math.hypot(px - cx, py - cy) - radius);
  if (py >= cy - 2) {
    return dRadius - strokeWidth / 2;
  }
  // end caps
  const dCapLeft = Math.hypot(px - (cx - radius), py - (cy - 2));
  const dCapRight = Math.hypot(px - (cx + radius), py - (cy - 2));
  return Math.min(dCapLeft, dCapRight) - strokeWidth / 2;
}

// 1. Mic Idle (White / Silver)
function micIdleSampler(x, y) {
  const dCap = distToVerticalCapsule(x, y, 16, 7, 13, 4.5);
  const dArc = distToUArc(x, y, 16, 11, 7.5, 2.2);
  const dStem = distToSegment(x, y, 16, 18.5, 16, 24) - 1.2;
  const dBase = distToSegment(x, y, 10, 24, 22, 24) - 1.2;

  const minDist = Math.min(dCap, dArc, dStem, dBase);
  if (minDist <= 0) {
    return [240, 240, 245, 255];
  }
  return [0, 0, 0, 0];
}

// 2. Mic Speaking (Discord Green #23A55A)
function micSpeakingSampler(x, y) {
  const dCap = distToVerticalCapsule(x, y, 16, 7, 13, 4.5);
  const dArc = distToUArc(x, y, 16, 11, 7.5, 2.4);
  const dStem = distToSegment(x, y, 16, 18.5, 16, 24) - 1.3;
  const dBase = distToSegment(x, y, 10, 24, 22, 24) - 1.3;

  // Outer sound wave arches
  const dLeftWave = Math.abs(Math.hypot(x - 16, y - 10) - 12.5) - 1.2;
  const inLeftAngle = (x < 16) && (Math.abs(y - 10) <= 6.5);
  const dRightWave = Math.abs(Math.hypot(x - 16, y - 10) - 12.5) - 1.2;
  const inRightAngle = (x > 16) && (Math.abs(y - 10) <= 6.5);

  const isWave = (inLeftAngle && dLeftWave <= 0) || (inRightAngle && dRightWave <= 0);

  const minDist = Math.min(dCap, dArc, dStem, dBase);
  if (minDist <= 0 || isWave) {
    return [35, 165, 90, 255]; // #23A55A
  }
  return [0, 0, 0, 0];
}

// 3. Mic Muted (Red #ED4245 with diagonal slash)
function micMutedSampler(x, y) {
  const dCap = distToVerticalCapsule(x, y, 16, 7, 13, 4.5);
  const dArc = distToUArc(x, y, 16, 11, 7.5, 2.2);
  const dStem = distToSegment(x, y, 16, 18.5, 16, 24) - 1.2;
  const dBase = distToSegment(x, y, 10, 24, 22, 24) - 1.2;
  const dSlash = distToSegment(x, y, 6, 5, 26, 25) - 1.3;

  const minDist = Math.min(dCap, dArc, dStem, dBase, dSlash);
  if (minDist <= 0) {
    return [237, 66, 69, 255]; // #ED4245
  }
  return [0, 0, 0, 0];
}

// 4. Deafened (Red #ED4245 Headphones Off with diagonal slash)
function deafenedSampler(x, y) {
  const dBand = Math.abs(Math.hypot(x - 16, y - 15) - 10.5) - 1.4;
  const isBand = (y <= 15) && dBand <= 0;
  const dLeftPad = distToVerticalCapsule(x, y, 5.5, 14, 20, 2.5);
  const dRightPad = distToVerticalCapsule(x, y, 26.5, 14, 20, 2.5);
  const dSlash = distToSegment(x, y, 6, 5, 26, 25) - 1.3;

  const minDist = Math.min(dLeftPad, dRightPad, dSlash);
  if (isBand || minDist <= 0) {
    return [237, 66, 69, 255]; // #ED4245
  }
  return [0, 0, 0, 0];
}

const outDir = path.join(__dirname, '../apps/client/src/renderer/assets/tray');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, 'tray-mic-idle.png'), rasterize32(micIdleSampler));
fs.writeFileSync(path.join(outDir, 'tray-mic-speaking.png'), rasterize32(micSpeakingSampler));
fs.writeFileSync(path.join(outDir, 'tray-mic-muted.png'), rasterize32(micMutedSampler));
fs.writeFileSync(path.join(outDir, 'tray-deafened.png'), rasterize32(deafenedSampler));

console.log('Tray icons generated successfully in', outDir);
