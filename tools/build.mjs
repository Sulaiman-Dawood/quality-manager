// Builds the release zips into dist/:
//   quality-manager-<version>.zip          Chrome, Edge (and other Chromium browsers)
//   quality-manager-<version>-firefox.zip  Firefox (manifest from tools/firefox-manifest.js)
// Usage: node tools/build.mjs
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { firefoxManifest } = createRequire(import.meta.url)('./firefox-manifest.js');
const INCLUDE = ['icons', 'popup', 'src']; // plus manifest.json

function files(dir) {
  const out = [];
  for (const name of readdirSync(path.join(ROOT, dir)).sort()) {
    const rel = dir + '/' + name;
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...files(rel));
    else out.push(rel);
  }
  return out;
}

// ---- Minimal zip writer (deflate, forward-slash paths) ----------------------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const DOS_TIME = 0, DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1; // fixed: reproducible zips
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

// ---- Build ------------------------------------------------------------------
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const content = INCLUDE.flatMap(files).map((name) => ({ name, data: readFileSync(path.join(ROOT, name)) }));
const json = (m) => Buffer.from(JSON.stringify(m, null, 2) + '\n');
mkdirSync(path.join(ROOT, 'dist'), { recursive: true });

function firefoxContent(entries) {
  return entries.map((entry) => {
    if (entry.name !== 'src/content/bridge.js') return entry;
    const source = entry.data.toString('utf8').replace(
      /  function shadowOf\(el\) \{\s*try \{\s*if \(typeof chrome !== 'undefined' && chrome\.dom && chrome\.dom\.openOrClosedShadowRoot\) return chrome\.dom\.openOrClosedShadowRoot\(el\);\s*\} catch \(_\) \{\}\s*return el\.shadowRoot \|\| null;\s*\}/,
      "  function shadowOf(el) {\n    return el.shadowRoot || null;\n  }",
    );
    return { name: entry.name, data: Buffer.from(source) };
  });
}

const out = [
  [`quality-manager-${manifest.version}.zip`, manifest],
  [`quality-manager-${manifest.version}-firefox.zip`, firefoxManifest(manifest)],
];
for (const [file, m] of out) {
  const entries = file.endsWith('-firefox.zip') ? firefoxContent(content) : content;
  const buf = zip([{ name: 'manifest.json', data: json(m) }, ...entries]);
  writeFileSync(path.join(ROOT, 'dist', file), buf);
  console.log(`dist/${file}  ${content.length + 1} files, ${Math.round(buf.length / 1024)} KB`);
}
