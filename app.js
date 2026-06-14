'use strict';

// 6SEG SCRIPT v0.2.0
// SCRIPT MODE: visible glyph system. No hidden metadata is stored in the PNG.
// LOCK MODE  : AES-GCM encrypted payload is drawn as visible 6SEG glyphs.
// Segment order: T UL UR LL LR B

const CELL_W = 72;
const CELL_H = 96;
const GAP_X = 8;
const GAP_Y = 18;
const MARGIN = 24;
const STROKE = 8;
const LOCK_WRAP_COLS = 28;
const PBKDF2_ITERATIONS = 310000;

const SEGMENTS = ['T', 'UL', 'UR', 'LL', 'LR', 'B'];

const MAP = {
  // Alphabet
  'A': '111010', 'B': '010111', 'C': '110101', 'D': '101010', 'E': '110001', 'F': '110000',
  'G': '110111', 'H': '010110', 'I': '100001', 'J': '001001', 'K': '011100', 'L': '000101',
  'M': '011010', 'N': '010010', 'O': '111001', 'P': '111101', 'Q': '111011', 'R': '011101',
  'S': '100011', 'T': '100100', 'U': '000111', 'V': '000110', 'W': '011111', 'X': '011110',
  'Y': '011011', 'Z': '101001',

  // Numbers based on 6 SEG CLOCK
  '0': '111000', '1': '001100', '2': '101101', '3': '101011', '4': '111110',
  '5': '110011', '6': '001111', '7': '101100', '8': '111111', '9': '111100',

  // Symbols
  ' ': '000000', '.': '000001', ',': '000010', '!': '000011', '?': '000100', ':': '001000',
  ';': '001010', "'": '001011', '"': '001101', '-': '001110', '_': '010000', '/': '010001',
  '\\': '010011', '|': '010100', '@': '010101', '#': '011000', '&': '011001', '+': '100000',
  '=': '100010', '*': '100101', '%': '100110', '$': '100111', '(': '101000', ')': '101110',
  '[': '101111', ']': '110010', '<': '110100', '>': '110110'
};

const REVERSE = Object.fromEntries(Object.entries(MAP).map(([k, v]) => [v, k]));
const ORDER = [
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  ...'0123456789',
  ' ', '.', ',', '!', '?', ':', ';', '\'', '"', '-', '_', '/', '\\', '|', '@', '#', '&', '+', '=', '*', '%', '$', '(', ')', '[', ']', '<', '>'
];

let lastLockValues = null;
let lastLockCanvasReady = false;
let pendingLockFile = null;

function normalizeText(text) {
  return text
    .replace(/\t/g, ' ')
    .split('\n')
    .map(line => Array.from(line.toUpperCase()).map(ch => MAP[ch] ? ch : '?').join(''))
    .join('\n');
}

function getRows(text) {
  const normalized = normalizeText(text);
  const rows = normalized.split('\n');
  return rows.length ? rows : [''];
}

function getCanvasSize(rows) {
  const cols = Math.max(1, ...rows.map(row => row.length));
  const width = MARGIN * 2 + cols * CELL_W + Math.max(0, cols - 1) * GAP_X;
  const height = MARGIN * 2 + rows.length * CELL_H + Math.max(0, rows.length - 1) * GAP_Y;
  return { width, height, cols, rowsCount: rows.length };
}

function getGridSizeForValues(values, wrapCols = LOCK_WRAP_COLS) {
  const cols = Math.max(1, Math.min(wrapCols, Math.max(1, values.length)));
  const rowsCount = Math.max(1, Math.ceil(values.length / cols));
  const width = MARGIN * 2 + cols * CELL_W + Math.max(0, cols - 1) * GAP_X;
  const height = MARGIN * 2 + rowsCount * CELL_H + Math.max(0, rowsCount - 1) * GAP_Y;
  return { width, height, cols, rowsCount };
}

function segmentLine(x, y, seg) {
  const w = CELL_W;
  const h = CELL_H;
  switch (seg) {
    case 'T':
      return [x + w * 0.30, y + h * 0.15, x + w * 0.70, y + h * 0.15];
    case 'B':
      return [x + w * 0.30, y + h * 0.85, x + w * 0.70, y + h * 0.85];
    case 'UL':
      return [x + w * 0.14, y + h * 0.20, x + w * 0.41, y + h * 0.42];
    case 'UR':
      return [x + w * 0.86, y + h * 0.20, x + w * 0.59, y + h * 0.42];
    case 'LL':
      return [x + w * 0.14, y + h * 0.80, x + w * 0.41, y + h * 0.58];
    case 'LR':
      return [x + w * 0.86, y + h * 0.80, x + w * 0.59, y + h * 0.58];
    default:
      return [x, y, x, y];
  }
}

function drawGlyph(ctx, x, y, pattern, color = '#111') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = STROKE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.imageSmoothingEnabled = false;

  SEGMENTS.forEach((seg, idx) => {
    if (pattern[idx] !== '1') return;
    const [x0, y0, x1, y1] = segmentLine(x, y, seg);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  });
  ctx.restore();
}

function renderTextToCanvas(text, canvas) {
  const rows = getRows(text);
  const { width, height, cols } = getCanvasSize(rows);
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  rows.forEach((row, rowIndex) => {
    for (let col = 0; col < cols; col++) {
      const ch = row[col] || ' ';
      const pattern = MAP[ch] || MAP['?'];
      const x = MARGIN + col * (CELL_W + GAP_X);
      const y = MARGIN + rowIndex * (CELL_H + GAP_Y);
      drawGlyph(ctx, x, y, pattern);
    }
  });

  return { rows, cols, width, height };
}

function renderValuesToCanvas(values, canvas, wrapCols = LOCK_WRAP_COLS) {
  const { width, height, cols, rowsCount } = getGridSizeForValues(values, wrapCols);
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  for (let row = 0; row < rowsCount; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const pattern = values[i] || '000000';
      const x = MARGIN + col * (CELL_W + GAP_X);
      const y = MARGIN + row * (CELL_H + GAP_Y);
      drawGlyph(ctx, x, y, pattern);
    }
  }

  return { cols, rowsCount, width, height };
}

function sampleSegment(imageData, imgW, x, y, seg) {
  const [x0, y0, x1, y1] = segmentLine(x, y, seg);
  const steps = 24;
  let dark = 0;
  let total = 0;
  const radius = 5;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sx = x0 + (x1 - x0) * t;
    const sy = y0 + (y1 - y0) * t;

    for (let dx = -radius; dx <= radius; dx += 2) {
      for (let dy = -radius; dy <= radius; dy += 2) {
        const px = Math.round(sx + dx);
        const py = Math.round(sy + dy);
        if (px < 0 || py < 0 || px >= imgW || py >= imageData.height) continue;
        const off = (py * imgW + px) * 4;
        const r = imageData.data[off];
        const g = imageData.data[off + 1];
        const b = imageData.data[off + 2];
        const brightness = (r + g + b) / 3;
        if (brightness < 128) dark++;
        total++;
      }
    }
  }

  return total > 0 && dark / total > 0.18;
}

function decodeCanvasToBits(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const cols = Math.max(1, Math.round((canvas.width - MARGIN * 2 + GAP_X) / (CELL_W + GAP_X)));
  const rowsCount = Math.max(1, Math.round((canvas.height - MARGIN * 2 + GAP_Y) / (CELL_H + GAP_Y)));

  const rows = [];
  for (let row = 0; row < rowsCount; row++) {
    const bitsRow = [];
    for (let col = 0; col < cols; col++) {
      const x = MARGIN + col * (CELL_W + GAP_X);
      const y = MARGIN + row * (CELL_H + GAP_Y);
      const bits = SEGMENTS.map(seg => sampleSegment(imageData, canvas.width, x, y, seg) ? '1' : '0').join('');
      bitsRow.push(bits);
    }
    rows.push(bitsRow);
  }
  return { rows, values: rows.flat(), cols, rowsCount };
}

function decodeCanvas(canvas) {
  const { rows } = decodeCanvasToBits(canvas);
  const lines = rows.map(bitsRow => bitsRow.map(bits => REVERSE[bits] ?? '�').join('').replace(/\s+$/g, ''));
  return lines.join('\n').replace(/\n+$/g, '');
}

function downloadCanvas(canvas, filename) {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function buildLegend() {
  const holder = document.getElementById('legend');
  holder.innerHTML = '';
  ORDER.forEach(ch => {
    if (!MAP[ch]) return;
    const item = document.createElement('div');
    item.className = 'legend-item';

    const canvas = document.createElement('canvas');
    canvas.width = 52;
    canvas.height = 68;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    const scaleX = 52 / CELL_W;
    const scaleY = 68 / CELL_H;
    ctx.scale(scaleX, scaleY);
    drawGlyph(ctx, 0, 0, MAP[ch]);
    ctx.restore();

    const label = document.createElement('div');
    label.className = 'legend-char';
    label.textContent = ch === ' ' ? 'space' : ch;

    item.appendChild(canvas);
    item.appendChild(label);
    holder.appendChild(item);
  });
}

function renderLegendCanvas() {
  const chars = ORDER.filter(ch => MAP[ch]);
  const cols = 8;
  const rows = Math.ceil(chars.length / cols);
  const cellW = 128;
  const cellH = 132;
  const canvas = document.createElement('canvas');
  canvas.width = cols * cellW;
  canvas.height = rows * cellH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#111';
  ctx.font = 'bold 18px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';

  chars.forEach((ch, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    const x = c * cellW + 28;
    const y = r * cellH + 14;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(0.85, 0.85);
    drawGlyph(ctx, 0, 0, MAP[ch]);
    ctx.restore();
    ctx.fillText(ch === ' ' ? 'space' : ch, c * cellW + cellW / 2, r * cellH + 118);
  });
  return canvas;
}

function readPngFile(file) {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const decoded = decodeCanvas(canvas);
    document.getElementById('decodedText').value = decoded;
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => alert('PNGを読み込めませんでした。');
  img.src = URL.createObjectURL(file);
}

function readLockPngFile(file) {
  pendingLockFile = file;
  const status = document.getElementById('unlockStatus');
  status.textContent = 'LOCK PNGを読み込みました。パスワードを入力して「復号する」を押してください。';
}

function loadImageFileToCanvas(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(img.src);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('PNGを読み込めませんでした。'));
    img.src = URL.createObjectURL(file);
  });
}

function bytesToSixValues(bytes) {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  const values = [];
  for (let i = 0; i < bits.length; i += 6) {
    values.push(bits.slice(i, i + 6).padEnd(6, '0'));
  }
  return values;
}

function sixValuesToBytes(values) {
  const bits = values.join('');
  const byteLen = Math.floor(bits.length / 8);
  const out = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return out;
}

function u32ToBytes(n) {
  return new Uint8Array([
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255
  ]);
}

function bytesToU32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function concatBytes(parts) {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach(part => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

async function deriveAesKey(password, salt, iterations) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function buildEncryptedPayload(text, password) {
  if (!window.crypto || !crypto.subtle) {
    throw new Error('このブラウザではWeb Crypto APIが使えません。HTTPS環境で開いてください。');
  }
  if (!password || password.length < 8) {
    throw new Error('パスワードは8文字以上を推奨します。');
  }

  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt, PBKDF2_ITERATIONS);
  const plaintext = enc.encode(text);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));

  return concatBytes([
    enc.encode('6SL1'),
    new Uint8Array([1]),
    u32ToBytes(PBKDF2_ITERATIONS),
    salt,
    iv,
    u32ToBytes(ciphertext.length),
    ciphertext
  ]);
}

async function decryptPayloadFromValues(values, password) {
  if (!window.crypto || !crypto.subtle) {
    throw new Error('このブラウザではWeb Crypto APIが使えません。HTTPS環境で開いてください。');
  }
  if (!password) throw new Error('パスワードを入力してください。');

  const bytes = sixValuesToBytes(values);
  const dec = new TextDecoder();
  const magic = dec.decode(bytes.slice(0, 4));
  if (magic !== '6SL1') throw new Error('LOCK PNG形式ではありません。通常PNGを選んでいる可能性があります。');
  const version = bytes[4];
  if (version !== 1) throw new Error('対応していないLOCK形式です。');

  const iterations = bytesToU32(bytes, 5);
  const salt = bytes.slice(9, 25);
  const iv = bytes.slice(25, 37);
  const cipherLen = bytesToU32(bytes, 37);
  const cipherStart = 41;
  const cipherEnd = cipherStart + cipherLen;
  if (cipherEnd > bytes.length) throw new Error('LOCK PNGのデータが途中で切れています。');
  const ciphertext = bytes.slice(cipherStart, cipherEnd);
  const key = await deriveAesKey(password, salt, iterations);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return dec.decode(plaintext);
}

async function encryptAndRender() {
  const text = document.getElementById('lockInputText').value;
  const password = document.getElementById('lockPassword').value;
  const canvas = document.getElementById('lockCanvas');
  const status = document.getElementById('lockStatus');
  const stat = document.getElementById('lockStat');

  status.textContent = '暗号化しています...';
  try {
    const payload = await buildEncryptedPayload(text, password);
    lastLockValues = bytesToSixValues(payload);
    const result = renderValuesToCanvas(lastLockValues, canvas, LOCK_WRAP_COLS);
    lastLockCanvasReady = true;
    stat.textContent = `${lastLockValues.length} glyphs / ${result.cols} cols / ${result.rowsCount} rows / ${result.width}×${result.height}px`;
    status.textContent = 'LOCK PNGを生成しました。復号には同じパスワードが必要です。';
  } catch (err) {
    lastLockCanvasReady = false;
    status.textContent = err.message || '暗号化に失敗しました。';
  }
}

async function decryptSelectedLockPng() {
  const status = document.getElementById('unlockStatus');
  const out = document.getElementById('unlockedText');
  out.value = '';
  if (!pendingLockFile) {
    status.textContent = '先にLOCK PNGを選択してください。';
    return;
  }
  const password = document.getElementById('unlockPassword').value;
  status.textContent = 'PNGを読み取って復号しています...';
  try {
    const canvas = await loadImageFileToCanvas(pendingLockFile);
    const { values } = decodeCanvasToBits(canvas);
    const text = await decryptPayloadFromValues(values, password);
    out.value = text;
    status.textContent = '復号しました。';
  } catch (err) {
    status.textContent = err.message || '復号に失敗しました。パスワード、またはPNGを確認してください。';
  }
}

function init() {
  const input = document.getElementById('inputText');
  const canvas = document.getElementById('previewCanvas');
  const stat = document.getElementById('stat');

  function render() {
    input.value = normalizeText(input.value);
    const result = renderTextToCanvas(input.value, canvas);
    stat.textContent = `${result.cols} cols / ${result.rows.length} rows / ${result.width}×${result.height}px`;
  }

  document.getElementById('renderBtn').addEventListener('click', render);
  document.getElementById('clearBtn').addEventListener('click', () => {
    input.value = '';
    render();
  });
  document.getElementById('downloadBtn').addEventListener('click', () => {
    render();
    downloadCanvas(canvas, '6seg-script.png');
  });
  document.getElementById('downloadTableBtn').addEventListener('click', () => {
    const tableCanvas = renderLegendCanvas();
    downloadCanvas(tableCanvas, '6seg-script-table.png');
  });
  document.getElementById('imageFile').addEventListener('change', ev => {
    const file = ev.target.files && ev.target.files[0];
    if (file) readPngFile(file);
  });
  document.getElementById('copyDecodedBtn').addEventListener('click', async () => {
    const text = document.getElementById('decodedText').value;
    try {
      await navigator.clipboard.writeText(text);
      alert('コピーしました。');
    } catch (_) {
      alert('コピーできませんでした。');
    }
  });

  document.getElementById('encryptBtn').addEventListener('click', encryptAndRender);
  document.getElementById('downloadLockBtn').addEventListener('click', async () => {
    if (!lastLockCanvasReady) await encryptAndRender();
    if (lastLockCanvasReady) downloadCanvas(document.getElementById('lockCanvas'), '6seg-lock.png');
  });
  document.getElementById('lockImageFile').addEventListener('change', ev => {
    const file = ev.target.files && ev.target.files[0];
    if (file) readLockPngFile(file);
  });
  document.getElementById('decryptBtn').addEventListener('click', decryptSelectedLockPng);

  buildLegend();
  render();

  // Draw a small empty lock preview.
  renderValuesToCanvas(['000000', '000000', '000000', '000000'], document.getElementById('lockCanvas'), 4);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

window.addEventListener('DOMContentLoaded', init);
