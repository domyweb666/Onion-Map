// 圖片的小工具：看是不是 PNG／JPEG、量寬高、假畫圖用的調色。不用外面的套件。
import zlib from 'node:zlib';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// 認得就回 {mime, ext, w, h}，不認得回 null
export function sniff(buf) {
  if (buf.length >= 33 && buf.subarray(0, 8).equals(PNG_MAGIC)) {
    if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { mime: 'image/png', ext: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const size = jpegSize(buf);
    return size && { mime: 'image/jpeg', ext: 'jpg', ...size };
  }
  return null;
}

// 一段一段跳過去，找到記寬高的那一段（SOF）
function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m === 0xff) {
      i += 1;
      continue;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    if (m === 0xd9 || m === 0xda) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    const sof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (sof) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    i += 2 + len;
  }
  return null;
}

// ---------- 假畫圖：把 PNG 調成暖一點的顏色 ----------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}

// 沒壓縮的像素包成 PNG，rgb 長度要是 w*h*3
export function encodePng(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = w * 3 + 1;
  const raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y += 1) rgb.copy(raw, y * row + 1, y * w * 3, (y + 1) * w * 3);
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([PNG_MAGIC, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// 只認 8 位元、RGB 或 RGBA、沒有交錯的 PNG，其他回 null
function decodePng(buf) {
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const type = buf[25];
  if (buf[24] !== 8 || (type !== 2 && type !== 6) || buf[28] !== 0) return null;
  const parts = [];
  for (let i = 8; i + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(i);
    if (buf.toString('latin1', i + 4, i + 8) === 'IDAT') parts.push(buf.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const n = type === 6 ? 4 : 3;
  const stride = w * n;
  const raw = zlib.inflateSync(Buffer.concat(parts), { maxOutputLength: (stride + 1) * h });
  if (raw.length !== (stride + 1) * h) return null;
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y += 1) {
    const f = raw[y * (stride + 1)];
    const at = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const v = raw[at + y + 1 + x];
      const a = x >= n ? px[at + x - n] : 0;
      const b = y ? px[at - stride + x] : 0;
      const c = x >= n && y ? px[at - stride + x - n] : 0;
      let p = 0;
      if (f === 1) p = a;
      else if (f === 2) p = b;
      else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        if (pa <= pb && pa <= pc) p = a;
        else p = pb <= pc ? b : c;
      }
      px[at + x] = (v + p) & 0xff;
    }
  }
  return { w, h, n, px };
}

// 讓人一眼看得出「這張換過了」。JPEG 或看不懂的 PNG 就原樣還回去
export function fakePaint(buf) {
  const info = sniff(buf);
  if (!info || info.mime !== 'image/png') return buf;
  try {
    const d = decodePng(buf);
    if (!d) return buf;
    const out = Buffer.alloc(d.w * d.h * 3);
    for (let i = 0, j = 0; j < out.length; i += d.n, j += 3) {
      const r = d.px[i];
      const g = d.px[i + 1];
      const b = d.px[i + 2];
      const grey = (r * 3 + g * 6 + b) / 10;
      out[j] = Math.min(255, r * 0.6 + grey * 0.4 + 10);
      out[j + 1] = Math.min(255, g * 0.6 + grey * 0.37);
      out[j + 2] = Math.min(255, b * 0.6 + grey * 0.28);
    }
    return encodePng(d.w, d.h, out);
  } catch {
    return buf;
  }
}
