import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to decode raw uncompressed RGBA or read PNG
// Since we have Logo.png, let's create a tool to generate square 512x512, 256x256, etc.
// Let's decode PNG using basic chunks or simple node script.

function parsePNG(buffer) {
  let offset = 8; // skip signature
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const compressed = Buffer.concat(idatChunks);
  const decompressed = zlib.inflateSync(compressed);

  // Unfilter PNG (supports filter 0, 1, 2, 3, 4 for RGBA)
  const bytesPerPixel = colorType === 6 ? 4 : (colorType === 2 ? 3 : (colorType === 4 ? 2 : 1));
  const rowSize = 1 + width * bytesPerPixel;
  const uncompressed = Buffer.alloc(width * height * 4);

  let prevRow = Buffer.alloc(width * bytesPerPixel);

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  }

  for (let y = 0; y < height; y++) {
    const filter = decompressed[y * rowSize];
    const row = decompressed.subarray(y * rowSize + 1, (y + 1) * rowSize);
    const curRow = Buffer.alloc(width * bytesPerPixel);

    for (let x = 0; x < width * bytesPerPixel; x++) {
      const left = x >= bytesPerPixel ? curRow[x - bytesPerPixel] : 0;
      const up = prevRow[x];
      const upLeft = x >= bytesPerPixel ? prevRow[x - bytesPerPixel] : 0;

      let val = row[x];
      if (filter === 1) val = (val + left) & 0xff;
      else if (filter === 2) val = (val + up) & 0xff;
      else if (filter === 3) val = (val + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) val = (val + paeth(left, up, upLeft)) & 0xff;

      curRow[x] = val;
    }

    for (let x = 0; x < width; x++) {
      const srcIdx = x * bytesPerPixel;
      const dstIdx = (y * width + x) * 4;
      if (colorType === 6) { // RGBA
        uncompressed[dstIdx] = curRow[srcIdx];
        uncompressed[dstIdx + 1] = curRow[srcIdx + 1];
        uncompressed[dstIdx + 2] = curRow[srcIdx + 2];
        uncompressed[dstIdx + 3] = curRow[srcIdx + 3];
      } else if (colorType === 2) { // RGB
        uncompressed[dstIdx] = curRow[srcIdx];
        uncompressed[dstIdx + 1] = curRow[srcIdx + 1];
        uncompressed[dstIdx + 2] = curRow[srcIdx + 2];
        uncompressed[dstIdx + 3] = 255;
      }
    }
    prevRow = curRow;
  }

  return { width, height, data: uncompressed };
}

function encodePNG(width, height, rgbaBuffer) {
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter None
    rgbaBuffer.copy(rawData, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const idatData = zlib.deflateSync(rawData);

  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
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
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', idatData),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// Resize image with high quality bilinear interpolation and aspect fit into target square size
function resizeAndCenter(srcImg, targetSize) {
  const targetBuf = Buffer.alloc(targetSize * targetSize * 4, 0); // transparent background

  // Calculate aspect-fit box with a small margin (e.g. 90% of targetSize)
  const maxDim = targetSize * 0.92;
  const scale = Math.min(maxDim / srcImg.width, maxDim / srcImg.height);
  const scaledW = Math.round(srcImg.width * scale);
  const scaledH = Math.round(srcImg.height * scale);
  const offsetX = Math.round((targetSize - scaledW) / 2);
  const offsetY = Math.round((targetSize - scaledH) / 2);

  for (let dy = 0; dy < scaledH; dy++) {
    const sy = (dy / scaledH) * srcImg.height;
    const sy0 = Math.floor(sy);
    const sy1 = Math.min(srcImg.height - 1, sy0 + 1);
    const yFrac = sy - sy0;

    for (let dx = 0; dx < scaledW; dx++) {
      const sx = (dx / scaledW) * srcImg.width;
      const sx0 = Math.floor(sx);
      const sx1 = Math.min(srcImg.width - 1, sx0 + 1);
      const xFrac = sx - sx0;

      const idx00 = (sy0 * srcImg.width + sx0) * 4;
      const idx10 = (sy0 * srcImg.width + sx1) * 4;
      const idx01 = (sy1 * srcImg.width + sx0) * 4;
      const idx11 = (sy1 * srcImg.width + sx1) * 4;

      const dstIdx = ((offsetY + dy) * targetSize + (offsetX + dx)) * 4;

      for (let c = 0; c < 4; c++) {
        const top = srcImg.data[idx00 + c] * (1 - xFrac) + srcImg.data[idx10 + c] * xFrac;
        const bot = srcImg.data[idx01 + c] * (1 - xFrac) + srcImg.data[idx11 + c] * xFrac;
        targetBuf[dstIdx + c] = Math.round(top * (1 - yFrac) + bot * yFrac);
      }
    }
  }

  return targetBuf;
}

// Build multi-image Windows ICO containing PNGs
function buildICO(pngBuffers) {
  // pngBuffers: array of { size, buffer }
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(count, 4); // count

  const directorySize = 16 * count;
  let currentOffset = 6 + directorySize;

  const dirEntries = [];
  const imageBodies = [];

  for (const item of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry[0] = item.size >= 256 ? 0 : item.size; // width (0 = 256)
    entry[1] = item.size >= 256 ? 0 : item.size; // height
    entry[2] = 0; // color count
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(item.buffer.length, 8); // size in bytes
    entry.writeUInt32LE(currentOffset, 12); // file offset

    dirEntries.push(entry);
    imageBodies.push(item.buffer);
    currentOffset += item.buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...imageBodies]);
}

/**
 * macOS icons follow Apple's icon grid: the artwork must sit inside an 824x824
 * "safe area" on a 1024x1024 canvas. Our source logo is nearly full-bleed, so
 * on macOS the dock icon renders visibly larger than every other app (#307).
 * This crops the logo to its opaque bounds and re-centers it with that margin.
 */
function buildMacIcon(srcImg, canvasSize = 1024, safeSize = 824) {
  let minX = srcImg.width, maxX = 0, minY = srcImg.height, maxY = 0;
  for (let y = 0; y < srcImg.height; y++) {
    for (let x = 0; x < srcImg.width; x++) {
      if (srcImg.data[(y * srcImg.width + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const boxW = maxX - minX + 1;
  const boxH = maxY - minY + 1;
  const scale = Math.min(safeSize / boxW, safeSize / boxH);
  const scaledW = Math.round(boxW * scale);
  const scaledH = Math.round(boxH * scale);
  const offsetX = Math.round((canvasSize - scaledW) / 2);
  const offsetY = Math.round((canvasSize - scaledH) / 2);

  const out = Buffer.alloc(canvasSize * canvasSize * 4, 0);

  for (let dy = 0; dy < scaledH; dy++) {
    const sy = minY + (dy / scaledH) * boxH;
    const sy0 = Math.floor(sy);
    const sy1 = Math.min(srcImg.height - 1, sy0 + 1);
    const yFrac = sy - sy0;

    for (let dx = 0; dx < scaledW; dx++) {
      const sx = minX + (dx / scaledW) * boxW;
      const sx0 = Math.floor(sx);
      const sx1 = Math.min(srcImg.width - 1, sx0 + 1);
      const xFrac = sx - sx0;

      const idx00 = (sy0 * srcImg.width + sx0) * 4;
      const idx10 = (sy0 * srcImg.width + sx1) * 4;
      const idx01 = (sy1 * srcImg.width + sx0) * 4;
      const idx11 = (sy1 * srcImg.width + sx1) * 4;
      const dstIdx = ((offsetY + dy) * canvasSize + (offsetX + dx)) * 4;

      for (let c = 0; c < 4; c++) {
        const top = srcImg.data[idx00 + c] * (1 - xFrac) + srcImg.data[idx10 + c] * xFrac;
        const bot = srcImg.data[idx01 + c] * (1 - xFrac) + srcImg.data[idx11 + c] * xFrac;
        out[dstIdx + c] = Math.round(top * (1 - yFrac) + bot * yFrac);
      }
    }
  }

  return { rgba: out, scaledW, scaledH };
}

const logoPath = path.join(__dirname, '../images/Logo.png');
const srcLogo = parsePNG(fs.readFileSync(logoPath));
console.log('Parsed source Logo:', srcLogo.width, 'x', srcLogo.height);

const buildDir = path.join(__dirname, '../apps/client/build');
const iconsDir = path.join(buildDir, 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
const pngsForIco = [];

for (const size of sizes) {
  const rgba = resizeAndCenter(srcLogo, size);
  const pngBuf = encodePNG(size, size, rgba);
  fs.writeFileSync(path.join(iconsDir, `${size}x${size}.png`), pngBuf);
  if (size <= 256) {
    pngsForIco.push({ size, buffer: pngBuf });
  }
  if (size === 512) {
    fs.writeFileSync(path.join(buildDir, 'icon.png'), pngBuf);
  }
}

const icoBuf = buildICO(pngsForIco);
fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuf);

const mac = buildMacIcon(srcLogo);
const macPng = encodePNG(1024, 1024, mac.rgba);
for (const target of ['../apps/client/build']) {
  const dir = path.join(__dirname, target);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'icon-mac.png'), macPng);
}
console.log(`macOS icon: artwork ${mac.scaledW}x${mac.scaledH} centered on 1024x1024 (824px safe area)`);

console.log('Build resources generated successfully in', buildDir);
