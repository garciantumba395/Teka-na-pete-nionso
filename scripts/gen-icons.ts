/* Génère les icônes de l'application installable (PWA), ORIGINALES : un sac de courses dessiné ici, en formes géométriques.
 *   npm run gen:icons
 * Les couleurs viennent des jetons (src/styles/tokens.json) : changer la marque change les icônes en relançant ce script.
 * Sorties (dans public/icons) : icon.svg, icon-192.png, icon-512.png (usage « any », coins arrondis),
 * icon-maskable-192.png, icon-maskable-512.png (pleine page, glyphe dans la zone sûre de 80 %), apple-touch-icon.png (180 px, sans transparence).
 * Aucune dépendance : le PNG est encodé ici (zlib de Node). Le résultat est déterministe : relancer ne change rien.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "public", "icons");
const tokens = JSON.parse(readFileSync(join(ROOT, "src", "styles", "tokens.json"), "utf8")) as { color: Record<string, string> };

type RGB = [number, number, number];
const hex = (h: string): RGB => {
  const m = /^#([0-9a-f]{6})$/i.exec(h);
  if (!m) throw new Error(`Couleur de jeton illisible : ${h}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const BG = hex(tokens.color.accent);
const FG = hex(tokens.color["on-accent"]);

// ---- géométrie, en coordonnées unitaires (0..1)
const CORNER = 0.22; // arrondi du carré « any »
const BODY = { cx: 0.5, cy: 0.58, hx: 0.25, hy: 0.2, r: 0.06 };
const HANDLE = { cx: 0.5, cy: 0.4, r: 0.12, w: 0.045 };
const SMILE = { cx: 0.5, cy: 0.54, r: 0.1, w: 0.04 }; // sourire découpé dans le sac

const roundBox = (x: number, y: number, c: { cx: number; cy: number; hx: number; hy: number; r: number }) => {
  const qx = Math.abs(x - c.cx) - (c.hx - c.r);
  const qy = Math.abs(y - c.cy) - (c.hy - c.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - c.r;
};
const inGlyph = (x: number, y: number): boolean => {
  if (y >= SMILE.cy && Math.abs(Math.hypot(x - SMILE.cx, y - SMILE.cy) - SMILE.r) <= SMILE.w / 2) return false;
  if (roundBox(x, y, BODY) <= 0) return true;
  const d = Math.hypot(x - HANDLE.cx, y - HANDLE.cy);
  return y <= HANDLE.cy && Math.abs(d - HANDLE.r) <= HANDLE.w / 2;
};
const inSquare = (x: number, y: number, rounded: boolean) => !rounded || roundBox(x, y, { cx: 0.5, cy: 0.5, hx: 0.5, hy: 0.5, r: CORNER }) <= 0;

function render(size: number, rounded: boolean, opaque: boolean): Buffer {
  const SS = 4;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filtre « aucun »
    for (let px = 0; px < size; px++) {
      let a = 0, r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (!inSquare(x, y, rounded)) continue;
          const c = inGlyph(x, y) ? FG : BG;
          a += 1; r += c[0]; g += c[1]; b += c[2];
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const n = SS * SS;
      if (a === 0) { raw[o + 3] = opaque ? 255 : 0; if (opaque) { raw[o] = BG[0]; raw[o + 1] = BG[1]; raw[o + 2] = BG[2]; } continue; }
      raw[o] = Math.round(r / a); raw[o + 1] = Math.round(g / a); raw[o + 2] = Math.round(b / a); raw[o + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, raw);
}

// ---- encodeur PNG minimal (RGBA 8 bits)
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size: number, raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---- SVG vectoriel équivalent
const px = (v: number) => +(v * 512).toFixed(2);
function svg(): string {
  const col = (c: RGB) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const bx = BODY.cx - BODY.hx, by = BODY.cy - BODY.hy;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Icône de l'application">
  <rect width="512" height="512" rx="${px(CORNER)}" fill="${col(BG)}"/>
  <path d="M${px(HANDLE.cx - HANDLE.r)} ${px(HANDLE.cy)}a${px(HANDLE.r)} ${px(HANDLE.r)} 0 0 1 ${px(HANDLE.r * 2)} 0" fill="none" stroke="${col(FG)}" stroke-width="${px(HANDLE.w)}"/>
  <rect x="${px(bx)}" y="${px(by)}" width="${px(BODY.hx * 2)}" height="${px(BODY.hy * 2)}" rx="${px(BODY.r)}" fill="${col(FG)}"/>
  <path d="M${px(SMILE.cx - SMILE.r)} ${px(SMILE.cy)}a${px(SMILE.r)} ${px(SMILE.r)} 0 0 0 ${px(SMILE.r * 2)} 0" fill="none" stroke="${col(BG)}" stroke-width="${px(SMILE.w)}"/>
</svg>
`;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "icon.svg"), svg());
for (const s of [192, 512]) {
  writeFileSync(join(OUT, `icon-${s}.png`), render(s, true, false));
  writeFileSync(join(OUT, `icon-maskable-${s}.png`), render(s, false, true));
}
writeFileSync(join(OUT, "apple-touch-icon.png"), render(180, false, true)); // iOS arrondit lui-même : pleine page, sans transparence
console.log("Icônes générées dans public/icons");
