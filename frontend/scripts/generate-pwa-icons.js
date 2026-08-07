import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(scriptDir, "../public");

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
};

const insidePolygon = (x, y, points) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i][0];
    const yi = points[i][1];
    const xj = points[j][0];
    const yj = points[j][1];
    const crosses = yi > y !== yj > y;
    if (crosses && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

const drawIcon = (size) => {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const bolt = [
    [0.58, 0.1],
    [0.27, 0.48],
    [0.46, 0.48],
    [0.36, 0.9],
    [0.73, 0.39],
    [0.53, 0.39],
  ].map(([x, y]) => [x * size, y * size]);

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;

    for (let x = 0; x < size; x += 1) {
      const offset = rowStart + 1 + x * 4;
      const radius = Math.hypot(x - size * 0.32, y - size * 0.25) / size;
      const glow = Math.max(0, 1 - radius * 2.6);
      const inBolt = insidePolygon(x + 0.5, y + 0.5, bolt);

      let r = 31 + Math.round(glow * 26);
      let g = 41 + Math.round(glow * 15);
      let b = 55 + Math.round(glow * 36);

      if (inBolt) {
        const t = y / size;
        r = Math.round(119 + t * 56);
        g = Math.round(76 + t * 110);
        b = Math.round(255 - t * 22);
      }

      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = 255;
    }
  }

  return raw;
};

const png = (size) => {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(drawIcon(size), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

for (const size of [192, 512]) {
  writeFileSync(resolve(publicDir, `pwa-icon-${size}.png`), png(size));
}
