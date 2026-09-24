// Generates the raster brand icons from app/icon.svg. Run once after the
// logo changes and commit the output (sharp is NOT a build dependency; this
// uses the copy already in node_modules via next).
//
//   node scripts/gen-brand-icons.mjs
//
// Writes public/icon-192.png, public/icon-512.png, app/apple-icon.png (180)
// and app/favicon.ico (16 + 32 PNGs in an ICO container).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = await readFile(join(ROOT, 'app', 'icon.svg'));

async function png(size) {
  // The SVG is 64x64; scale the rasterization density so edges stay crisp.
  return sharp(svg, { density: Math.ceil((72 * size) / 64) }).resize(size, size).png().toBuffer();
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); // colors
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bpp
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...images.map((img) => img.data)]);
}

const [p16, p32, p180, p192, p512] = await Promise.all([16, 32, 180, 192, 512].map(png));
await writeFile(join(ROOT, 'public', 'icon-192.png'), p192);
await writeFile(join(ROOT, 'public', 'icon-512.png'), p512);
await writeFile(join(ROOT, 'app', 'apple-icon.png'), p180);
await writeFile(join(ROOT, 'app', 'favicon.ico'), ico([{ size: 16, data: p16 }, { size: 32, data: p32 }]));
console.log('Wrote public/icon-192.png, public/icon-512.png, app/apple-icon.png, app/favicon.ico');
