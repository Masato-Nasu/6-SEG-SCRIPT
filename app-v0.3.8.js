'use strict';

// 6SEG SCRIPT v0.3.8
// SCRIPT MODE: visible glyph system. No hidden metadata is stored in the PNG.
// LOCK MODE  : AES-GCM encrypted payload is drawn as visible 6SEG glyphs.
// Segment order: T UL UR LL LR B

const APP_VERSION = 'v0.3.8';

const PROFILES = {
  normal: {
    name: 'normal',
    cellW: 72,
    cellH: 96,
    gapX: 8,
    gapY: 18,
    margin: 24,
    stroke: 8,
    wrapCols: 28
  },
  legacyPost: {
    // v0.2.x single long-image export profile kept for backward-compatible decoding.
    name: 'legacyPost',
    cellW: 36,
    cellH: 48,
    gapX: 4,
    gapY: 8,
    margin: 12,
    stroke: 4,
    wrapCols: 40
  },
  xpost: {
    // X-readable SCRIPT export profile: about two pages for long text.
    name: 'xpost',
    cellW: 19,
    cellH: 28,
    gapX: 2,
    gapY: 4,
    margin: 18,
    stroke: 4,
    wrapCols: 44,
    maxRowsPerPage: 55
  },
  xlockSafe: {
    // X-safe LOCK export profile. Bigger glyphs + repeated data for social-media downloads.
    name: 'xlockSafe',
    cellW: 28,
    cellH: 40,
    gapX: 4,
    gapY: 7,
    margin: 24,
    stroke: 7,
    wrapCols: 28,
    maxRowsPerPage: 30
  }
};

const NORMAL_PROFILE = PROFILES.normal;
const POST_PROFILE = PROFILES.legacyPost;
const X_PROFILE = PROFILES.xpost;
const LOCK_X_PROFILE = PROFILES.xlockSafe;
const LOCK_X_REPEAT = 3;
const DECODE_PROFILES = [NORMAL_PROFILE, POST_PROFILE, X_PROFILE, LOCK_X_PROFILE];

// Normal profile aliases. Kept for table rendering and compatibility.
const CELL_W = NORMAL_PROFILE.cellW;
const CELL_H = NORMAL_PROFILE.cellH;
const LOCK_WRAP_COLS = NORMAL_PROFILE.wrapCols;
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
let pendingLockFiles = [];

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

function getWrappedRows(text, wrapCols) {
  const baseRows = getRows(text);
  if (!wrapCols) return baseRows;
  const out = [];
  baseRows.forEach(row => {
    if (!row.length) {
      out.push('');
      return;
    }
    for (let i = 0; i < row.length; i += wrapCols) {
      out.push(row.slice(i, i + wrapCols));
    }
  });
  return out.length ? out : [''];
}

function getCanvasSize(rows, profile = NORMAL_PROFILE) {
  const cols = Math.max(1, ...rows.map(row => row.length));
  const width = profile.margin * 2 + cols * profile.cellW + Math.max(0, cols - 1) * profile.gapX;
  const height = profile.margin * 2 + rows.length * profile.cellH + Math.max(0, rows.length - 1) * profile.gapY;
  return { width, height, cols, rowsCount: rows.length };
}

function getExpectedGridSize(cols, rowsCount, profile = NORMAL_PROFILE) {
  const width = profile.margin * 2 + cols * profile.cellW + Math.max(0, cols - 1) * profile.gapX;
  const height = profile.margin * 2 + rowsCount * profile.cellH + Math.max(0, rowsCount - 1) * profile.gapY;
  return { width, height, cols, rowsCount };
}

function getGridSizeForValues(values, wrapCols = LOCK_WRAP_COLS, profile = NORMAL_PROFILE) {
  const cols = Math.max(1, Math.min(wrapCols, Math.max(1, values.length)));
  const rowsCount = Math.max(1, Math.ceil(values.length / cols));
  return getExpectedGridSize(cols, rowsCount, profile);
}

function segmentLine(x, y, seg, profile = NORMAL_PROFILE) {
  const w = profile.cellW;
  const h = profile.cellH;
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

function drawGlyph(ctx, x, y, pattern, color = '#111', profile = NORMAL_PROFILE) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = profile.stroke;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.imageSmoothingEnabled = false;

  SEGMENTS.forEach((seg, idx) => {
    if (pattern[idx] !== '1') return;
    const [x0, y0, x1, y1] = segmentLine(x, y, seg, profile);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  });
  ctx.restore();
}

function renderRowsToCanvas(rows, canvas, profile = NORMAL_PROFILE) {
  const { width, height, cols } = getCanvasSize(rows, profile);
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
      const x = profile.margin + col * (profile.cellW + profile.gapX);
      const y = profile.margin + rowIndex * (profile.cellH + profile.gapY);
      drawGlyph(ctx, x, y, pattern, '#111', profile);
    }
  });

  return { rows, cols, width, height, profile };
}

function renderTextToCanvas(text, canvas, profile = NORMAL_PROFILE, wrapCols = null) {
  const rows = getWrappedRows(text, wrapCols);
  return renderRowsToCanvas(rows, canvas, profile);
}

function renderValuesToCanvas(values, canvas, wrapCols = LOCK_WRAP_COLS, profile = NORMAL_PROFILE) {
  const { width, height, cols, rowsCount } = getGridSizeForValues(values, wrapCols, profile);
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
      const x = profile.margin + col * (profile.cellW + profile.gapX);
      const y = profile.margin + row * (profile.cellH + profile.gapY);
      drawGlyph(ctx, x, y, pattern, '#111', profile);
    }
  }

  return { cols, rowsCount, width, height, profile };
}

function paginateRows(rows, maxRowsPerPage) {
  if (!maxRowsPerPage || maxRowsPerPage < 1) return [rows];
  const pages = [];
  for (let i = 0; i < rows.length; i += maxRowsPerPage) {
    pages.push(rows.slice(i, i + maxRowsPerPage));
  }
  return pages.length ? pages : [['']];
}

function renderTextPagesToCanvases(text, profile = X_PROFILE) {
  const rows = getWrappedRows(text, profile.wrapCols);
  const pages = paginateRows(rows, profile.maxRowsPerPage);
  return pages.map(pageRows => {
    const canvas = document.createElement('canvas');
    renderRowsToCanvas(pageRows, canvas, profile);
    return canvas;
  });
}

function repeatSixValues(values, repeatCount = LOCK_X_REPEAT) {
  const out = [];
  values.forEach(value => {
    for (let i = 0; i < repeatCount; i++) out.push(value);
  });
  return out;
}

function renderValuePagesToCanvases(values, profile = X_PROFILE, repeatCount = 1) {
  const renderValues = repeatCount > 1 ? repeatSixValues(values, repeatCount) : values;
  const cols = profile.wrapCols || LOCK_WRAP_COLS;
  const valuesPerPage = cols * (profile.maxRowsPerPage || 18);
  const pages = [];
  for (let i = 0; i < renderValues.length; i += valuesPerPage) {
    const canvas = document.createElement('canvas');
    renderValuesToCanvas(renderValues.slice(i, i + valuesPerPage), canvas, cols, profile);
    pages.push(canvas);
  }
  if (!pages.length) {
    const canvas = document.createElement('canvas');
    renderValuesToCanvas(['000000'], canvas, cols, profile);
    pages.push(canvas);
  }
  return pages;
}

function majorityBits(values) {
  if (values.length === 0) return '000000';
  let out = '';
  for (let bit = 0; bit < 6; bit++) {
    let ones = 0;
    values.forEach(value => { if (value && value[bit] === '1') ones++; });
    out += ones >= Math.ceil(values.length / 2) ? '1' : '0';
  }
  return out;
}

function collapseRepeatedValues(values, repeatCount = LOCK_X_REPEAT) {
  if (!values || values.length < repeatCount) return [];
  const out = [];
  for (let i = 0; i + repeatCount - 1 < values.length; i += repeatCount) {
    out.push(majorityBits(values.slice(i, i + repeatCount)));
  }
  return out;
}

function sampleSegment(imageData, imgW, x, y, seg, profile = NORMAL_PROFILE) {
  const [x0, y0, x1, y1] = segmentLine(x, y, seg, profile);
  const steps = Math.max(10, Math.round(24 * Math.min(1.4, Math.max(0.5, profile.cellW / NORMAL_PROFILE.cellW))));
  let dark = 0;
  let total = 0;
  const radius = Math.max(1, Math.round(profile.stroke * 0.6));

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sx = x0 + (x1 - x0) * t;
    const sy = y0 + (y1 - y0) * t;

    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        const px = Math.round(sx + dx);
        const py = Math.round(sy + dy);
        if (px < 0 || py < 0 || px >= imgW || py >= imageData.height) continue;
        const off = (py * imgW + px) * 4;
        const r = imageData.data[off];
        const g = imageData.data[off + 1];
        const b = imageData.data[off + 2];
        const brightness = (r + g + b) / 3;
        if (brightness < 190) dark++;
        total++;
      }
    }
  }

  return total > 0 && dark / total > 0.22;
}

function getGridFit(canvas, profile) {
  const cols = Math.max(1, Math.round((canvas.width - profile.margin * 2 + profile.gapX) / (profile.cellW + profile.gapX)));
  const rowsCount = Math.max(1, Math.round((canvas.height - profile.margin * 2 + profile.gapY) / (profile.cellH + profile.gapY)));
  const expected = getExpectedGridSize(cols, rowsCount, profile);
  const error = Math.abs(canvas.width - expected.width) + Math.abs(canvas.height - expected.height);
  return { profile, cols, rowsCount, expectedW: expected.width, expectedH: expected.height, error };
}



function getForcedXPostCandidate(canvas) {
  // X-readable SCRIPT PNG uses a fixed 44-column grid. Do this before the
  // general candidate scorer so it can never be mistaken for encrypted/random data.
  const p = X_PROFILE;
  const cols = p.wrapCols;
  const base = getExpectedGridSize(cols, 1, p);
  const fullW = getExpectedGridSize(cols, p.maxRowsPerPage || 55, p).width;

  // Exact modern X-readable export: width is 958px, height is 32 * rows + 32.
  const exactRows = Math.round((canvas.height - p.margin * 2 + p.gapY) / (p.cellH + p.gapY));
  const exactExpected = getExpectedGridSize(cols, Math.max(1, exactRows), p);
  const exactError = Math.abs(canvas.width - exactExpected.width) + Math.abs(canvas.height - exactExpected.height);
  if (exactRows >= 1 && exactRows <= (p.maxRowsPerPage || 80) && exactError <= 3) {
    return { profile: p, cols, rowsCount: exactRows, scaleX: 1, scaleY: 1, label: 'xpostForcedExact' };
  }

  // Social sites may resize the image. Keep 44 columns and infer rows from scale.
  const scaleX = canvas.width / fullW;
  if (!(scaleX > 0.25 && scaleX < 4)) return null;
  const scaledRows = Math.round((canvas.height / scaleX - p.margin * 2 + p.gapY) / (p.cellH + p.gapY));
  if (scaledRows < 1 || scaledRows > (p.maxRowsPerPage || 80)) return null;
  const expectedH = getExpectedGridSize(cols, scaledRows, p).height;
  const scaleY = canvas.height / expectedH;
  const mismatch = Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY);
  if (mismatch <= 0.08) {
    return { profile: p, cols, rowsCount: scaledRows, scaleX, scaleY, label: 'xpostForcedScaled' };
  }
  return null;
}

function getPixelExactDecodeCandidate(canvas, profiles = DECODE_PROFILES) {
  const fits = [];
  profiles.forEach(profile => {
    const exact = getGridFit(canvas, profile);
    if (exact.error <= 1) {
      fits.push({ profile: exact.profile, cols: exact.cols, rowsCount: exact.rowsCount, scaleX: 1, scaleY: 1, label: 'pixelExact' });
    }
  });

  if (!fits.length) return null;

  const priority = { xpost: 0, xlockSafe: 1, normal: 2, legacyPost: 3 };
  fits.sort((a, b) => (priority[a.profile.name] ?? 99) - (priority[b.profile.name] ?? 99));
  return fits[0];
}

function decodeCanvasToBitsStrict(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const forcedX = getForcedXPostCandidate(canvas);
  if (forcedX) {
    return decodeWithCandidate(canvas, imageData, forcedX);
  }
  const exact = getPixelExactDecodeCandidate(canvas);
  if (exact) {
    return decodeWithCandidate(canvas, imageData, exact);
  }
  return decodeCanvasToBits(canvas);
}

function describeDecoded(decoded, filename = '') {
  const name = filename ? `${filename}: ` : '';
  return `${name}${decoded.profile}/${decoded.label} ${decoded.cols} cols × ${decoded.rowsCount} rows`;
}

function buildDecodeCandidates(canvas) {
  const seen = new Set();
  const candidates = [];

  function add(profile, cols, rowsCount, scaleX, scaleY, label) {
    cols = Math.max(1, Math.round(cols));
    rowsCount = Math.max(1, Math.round(rowsCount));
    const key = [profile.name, cols, rowsCount, scaleX.toFixed(4), scaleY.toFixed(4), label].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ profile, cols, rowsCount, scaleX, scaleY, label });
  }

  // If the PNG size exactly matches one of our export profiles, do not let
  // scaled false-positive candidates win. This fixes X-readable SCRIPT PNGs
  // being decoded with the wrong grid and turning into random text.
  const pixelExactFits = [];
  DECODE_PROFILES.forEach(profile => {
    const exact = getGridFit(canvas, profile);
    if (exact.error <= 1) pixelExactFits.push(exact);
  });

  if (pixelExactFits.length > 0) {
    pixelExactFits.forEach(exact => {
      add(exact.profile, exact.cols, exact.rowsCount, 1, 1, 'pixelExact');
    });
    return candidates;
  }

  DECODE_PROFILES.forEach(profile => {
    const exact = getGridFit(canvas, profile);
    add(profile, exact.cols, exact.rowsCount, 1, 1, 'exact');

    const colSet = new Set([
      exact.cols,
      profile.wrapCols || exact.cols,
      Math.max(1, Math.round((canvas.width / Math.max(1, profile.cellW)) * 0.7)),
      Math.max(1, Math.round((canvas.width / Math.max(1, profile.cellW)) * 1.2))
    ]);

    if (profile.wrapCols) {
      colSet.add(profile.wrapCols);
      colSet.add(Math.max(1, profile.wrapCols - 1));
      colSet.add(profile.wrapCols + 1);
      colSet.add(Math.max(1, Math.round(profile.wrapCols * 0.75)));
      colSet.add(Math.max(1, Math.round(profile.wrapCols * 0.5)));
    }

    [...colSet]
      .filter(cols => cols >= 1 && cols <= 80)
      .forEach(cols => {
        const expectedW = getExpectedGridSize(cols, 1, profile).width;
        const scaleX = canvas.width / expectedW;
        if (!(scaleX > 0.08 && scaleX < 6)) return;

        const rowEstimate = Math.max(
          1,
          Math.round((canvas.height / scaleX - profile.margin * 2 + profile.gapY) / (profile.cellH + profile.gapY))
        );

        for (let delta = -3; delta <= 3; delta++) {
          const rowsCount = rowEstimate + delta;
          if (rowsCount < 1 || rowsCount > 2000) continue;
          const expectedH = getExpectedGridSize(cols, rowsCount, profile).height;
          const scaleY = canvas.height / expectedH;
          if (!(scaleY > 0.08 && scaleY < 6)) continue;
          const mismatch = Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY);
          if (mismatch > 0.22) continue;
          add(profile, cols, rowsCount, scaleX, scaleY, 'scaled');
        }
      });
  });

  return candidates;
}

function decodeWithCandidate(canvas, imageData, candidate) {
  const scaledProfile = {
    name: candidate.profile.name,
    cellW: candidate.profile.cellW * candidate.scaleX,
    cellH: candidate.profile.cellH * candidate.scaleY,
    gapX: candidate.profile.gapX * candidate.scaleX,
    gapY: candidate.profile.gapY * candidate.scaleY,
    marginX: candidate.profile.margin * candidate.scaleX,
    marginY: candidate.profile.margin * candidate.scaleY,
    stroke: Math.max(1, candidate.profile.stroke * ((candidate.scaleX + candidate.scaleY) / 2))
  };

  const rows = [];
  let validCount = 0;
  let nonSpaceCount = 0;
  let alphaNumCount = 0;
  const uniqueChars = new Set();
  const total = candidate.cols * candidate.rowsCount;

  for (let row = 0; row < candidate.rowsCount; row++) {
    const bitsRow = [];
    const charsRow = [];
    for (let col = 0; col < candidate.cols; col++) {
      const x = scaledProfile.marginX + col * (scaledProfile.cellW + scaledProfile.gapX);
      const y = scaledProfile.marginY + row * (scaledProfile.cellH + scaledProfile.gapY);
      const bits = SEGMENTS.map(seg => sampleSegment(imageData, canvas.width, x, y, seg, scaledProfile) ? '1' : '0').join('');
      const ch = REVERSE[bits] ?? '�';
      bitsRow.push(bits);
      charsRow.push(ch);
      if (bits in REVERSE) validCount++;
      if (ch !== ' ' && ch !== '�') nonSpaceCount++;
      if (/^[A-Z0-9]$/.test(ch)) alphaNumCount++;
      if (ch !== ' ' && ch !== '�') uniqueChars.add(ch);
    }
    rows.push({ bits: bitsRow, chars: charsRow });
  }

  const validRatio = total ? validCount / total : 0;
  const nonSpaceRatio = total ? nonSpaceCount / total : 0;
  const alphaNumRatio = total ? alphaNumCount / total : 0;
  const uniqueRatio = Math.min(1, uniqueChars.size / 16);
  const scaleMismatch = Math.abs(candidate.scaleX - candidate.scaleY) / Math.max(candidate.scaleX, candidate.scaleY);
  const score = validRatio + nonSpaceRatio * 0.6 + alphaNumRatio * 0.2 + uniqueRatio * 0.15 - scaleMismatch * 0.35;

  return {
    rows,
    values: rows.flatMap(row => row.bits),
    cols: candidate.cols,
    rowsCount: candidate.rowsCount,
    profile: candidate.profile.name,
    label: candidate.label,
    scaleX: candidate.scaleX,
    scaleY: candidate.scaleY,
    score,
    validRatio,
    nonSpaceRatio,
    alphaNumRatio
  };
}

function decodeCanvasToBitOptions(canvas, limit = 8) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const candidates = buildDecodeCandidates(canvas);
  const decoded = candidates.map(candidate => decodeWithCandidate(canvas, imageData, candidate));
  decoded.sort((a, b) => b.score - a.score);

  const seen = new Set();
  const out = [];
  for (const item of decoded) {
    const key = `${item.profile}|${item.cols}|${item.rowsCount}|${item.values.slice(0, 12).join('')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

function decodeCanvasToBits(canvas) {
  return decodeCanvasToBitOptions(canvas, 1)[0];
}

function decodeCanvas(canvas) {
  const decoded = decodeCanvasToBitsStrict(canvas);
  const lines = decoded.rows.map(row => row.chars.join('').replace(/\s+$/g, ''));
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


const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function canvasToPngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async blob => {
      if (!blob) {
        reject(new Error('PNG生成に失敗しました。'));
        return;
      }
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

function makeZip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  function pushU16(view, pos, value) { view.setUint16(pos, value, true); }
  function pushU32(view, pos, value) { view.setUint32(pos, value >>> 0, true); }

  files.forEach(file => {
    const nameBytes = enc.encode(file.name);
    const data = file.bytes;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    pushU32(lv, 0, 0x04034b50);
    pushU16(lv, 4, 20);
    pushU16(lv, 6, 0);
    pushU16(lv, 8, 0);
    pushU16(lv, 10, dosTime);
    pushU16(lv, 12, dosDate);
    pushU32(lv, 14, crc);
    pushU32(lv, 18, data.length);
    pushU32(lv, 22, data.length);
    pushU16(lv, 26, nameBytes.length);
    pushU16(lv, 28, 0);
    local.set(nameBytes, 30);
    localParts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    pushU32(cv, 0, 0x02014b50);
    pushU16(cv, 4, 20);
    pushU16(cv, 6, 20);
    pushU16(cv, 8, 0);
    pushU16(cv, 10, 0);
    pushU16(cv, 12, dosTime);
    pushU16(cv, 14, dosDate);
    pushU32(cv, 16, crc);
    pushU32(cv, 20, data.length);
    pushU32(cv, 24, data.length);
    pushU16(cv, 28, nameBytes.length);
    pushU16(cv, 30, 0);
    pushU16(cv, 32, 0);
    pushU16(cv, 34, 0);
    pushU16(cv, 36, 0);
    pushU32(cv, 38, 0);
    pushU32(cv, 42, offset);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + data.length;
  });

  const centralSize = centralParts.reduce((sum, p) => sum + p.length, 0);
  const centralOffset = offset;
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  pushU32(ev, 0, 0x06054b50);
  pushU16(ev, 4, 0);
  pushU16(ev, 6, 0);
  pushU16(ev, 8, files.length);
  pushU16(ev, 10, files.length);
  pushU32(ev, 12, centralSize);
  pushU32(ev, 16, centralOffset);
  pushU16(ev, 20, 0);

  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  a.remove();
}

async function downloadCanvasListAsZip(canvases, baseName) {
  const files = [];
  for (let idx = 0; idx < canvases.length; idx++) {
    files.push({
      name: `${baseName}-${String(idx + 1).padStart(2, '0')}.png`,
      bytes: await canvasToPngBytes(canvases[idx])
    });
  }
  const zip = makeZip(files);
  downloadBlob(zip, `${baseName}.zip`);
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


function isZipFile(file) {
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  return name.endsWith('.zip') || type === 'application/zip' || type === 'application/x-zip-compressed';
}

function readU16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32LE(bytes, offset) {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function namedBlob(bytes, name, type = 'image/png') {
  try {
    return new File([bytes], name, { type });
  } catch (_) {
    const blob = new Blob([bytes], { type });
    blob.name = name;
    return blob;
  }
}

async function extractStoredZipPngFiles(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const files = [];
  let pos = 0;

  while (pos + 30 <= bytes.length) {
    const sig = readU32LE(bytes, pos);

    if (sig === 0x02014b50 || sig === 0x06054b50) break; // central directory / end
    if (sig !== 0x04034b50) {
      pos += 1;
      continue;
    }

    const flags = readU16LE(bytes, pos + 6);
    const method = readU16LE(bytes, pos + 8);
    const compressedSize = readU32LE(bytes, pos + 18);
    const uncompressedSize = readU32LE(bytes, pos + 22);
    const nameLen = readU16LE(bytes, pos + 26);
    const extraLen = readU16LE(bytes, pos + 28);
    const nameStart = pos + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compressedSize;

    if (dataStart > bytes.length || dataEnd > bytes.length) break;

    const nameBytes = bytes.slice(nameStart, nameStart + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    const lower = name.toLowerCase();

    // This app creates ZIP files using method 0 (stored/no compression).
    // If the ZIP came from another app and is compressed, skip it safely.
    if ((flags & 0x08) === 0 && method === 0 && lower.endsWith('.png') && compressedSize === uncompressedSize) {
      const data = bytes.slice(dataStart, dataEnd);
      files.push(namedBlob(data, name, 'image/png'));
    }

    pos = dataEnd;
  }

  files.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
  return files;
}

async function expandSelectedImageOrZipFiles(fileList) {
  const inputFiles = Array.from(fileList || []);
  let out = [];

  for (const file of inputFiles) {
    if (isZipFile(file)) {
      const extracted = await extractStoredZipPngFiles(file);
      out = out.concat(extracted);
    } else {
      out.push(file);
    }
  }

  out.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
  return out;
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

async function readPngFiles(files) {
  const out = document.getElementById('decodedText');
  const status = document.getElementById('readStatus');
  out.value = '';
  if (status) status.textContent = '';
  try {
    const expandedFiles = await expandSelectedImageOrZipFiles(files);
    const decodedParts = [];
    const reports = [];
    for (const file of expandedFiles) {
      const canvas = await loadImageFileToCanvas(file);
      const decoded = decodeCanvasToBitsStrict(canvas);
      const lines = decoded.rows.map(row => row.chars.join('').replace(/\s+$/g, ''));
      decodedParts.push(lines.join('\n').replace(/\n+$/g, ''));
      reports.push(describeDecoded(decoded, file.name || 'image'));
    }
    out.value = decodedParts.join('\n');
    if (status) status.textContent = `${APP_VERSION} / ${reports.join(' / ')}`;
  } catch (err) {
    if (status) status.textContent = err && err.message ? err.message : '';
    alert('PNGまたはZIPを読み込めませんでした。');
  }
}

async function readLockPngFile(files) {
  const status = document.getElementById('unlockStatus');
  try {
    pendingLockFiles = await expandSelectedImageOrZipFiles(files || []);
  } catch (_) {
    pendingLockFiles = [];
    status.textContent = 'PNGまたはZIPを読み込めませんでした。';
    return;
  }

  if (pendingLockFiles.length === 0) {
    status.textContent = '';
    return;
  }
  status.textContent = pendingLockFiles.length === 1
    ? 'LOCK PNGを読み込みました。パスワードを入力して「復号する」を押してください。'
    : `${pendingLockFiles.length}枚のLOCK PNGを読み込みました。パスワードを入力して「復号する」を押してください。`;
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

function buildOptionCombinations(optionLists, maxPerFile = 4, maxTotal = 48) {
  const combos = [[]];
  for (const list of optionLists) {
    const top = list.slice(0, maxPerFile);
    const next = [];
    for (const combo of combos) {
      for (const item of top) {
        next.push(combo.concat(item));
        if (next.length >= maxTotal) break;
      }
      if (next.length >= maxTotal) break;
    }
    combos.splice(0, combos.length, ...next);
  }
  return combos;
}

async function tryDecryptValueCandidates(optionLists, password) {
  const combos = buildOptionCombinations(optionLists);
  let lastError = null;

  for (const combo of combos) {
    const values = combo.flatMap(item => item.values);
    const candidates = [values, collapseRepeatedValues(values, LOCK_X_REPEAT)].filter(v => v.length > 0);
    for (const candidateValues of candidates) {
      try {
        return await decryptPayloadFromValues(candidateValues, password);
      } catch (err) {
        lastError = err;
      }
    }
  }

  throw lastError || new Error('復号に失敗しました。');
}

async function decryptSelectedLockPng() {
  const status = document.getElementById('unlockStatus');
  const out = document.getElementById('unlockedText');
  out.value = '';
  if (!pendingLockFiles.length) {
    status.textContent = '先にLOCK PNGを選択してください。';
    return;
  }
  const password = document.getElementById('unlockPassword').value;
  status.textContent = 'PNGを読み取って復号しています...';
  try {
    const optionLists = [];
    for (const file of pendingLockFiles) {
      const canvas = await loadImageFileToCanvas(file);
      optionLists.push(decodeCanvasToBitOptions(canvas, 8));
    }
    const text = await tryDecryptValueCandidates(optionLists, password);
    out.value = text;
    status.textContent = '復号しました。';
  } catch (err) {
    status.textContent = '復号に失敗しました。Twitter/Xで再圧縮された画像は、通常のLOCK PNGより壊れやすいです。v0.3.6以降の「X用LOCK PNG ZIP保存」は三重化しているため、そちらで再生成してください。';
  }
}

function init() {
  const versionEl = document.getElementById('appVersion');
  if (versionEl) versionEl.textContent = APP_VERSION;
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
  document.getElementById('downloadPostBtn').addEventListener('click', async () => {
    input.value = normalizeText(input.value);
    const pages = renderTextPagesToCanvases(input.value, X_PROFILE);
    await downloadCanvasListAsZip(pages, '6seg-script-x-readable');
  });
  document.getElementById('downloadTableBtn').addEventListener('click', () => {
    const tableCanvas = renderLegendCanvas();
    downloadCanvas(tableCanvas, '6seg-script-table.png');
  });
  document.getElementById('imageFile').addEventListener('change', ev => {
    const files = Array.from(ev.target.files || []);
    if (files.length) readPngFiles(files);
    ev.target.value = '';
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
  document.getElementById('downloadLockPostBtn').addEventListener('click', async () => {
    if (!lastLockCanvasReady) await encryptAndRender();
    if (lastLockCanvasReady && lastLockValues) {
      const pages = renderValuePagesToCanvases(lastLockValues, LOCK_X_PROFILE, LOCK_X_REPEAT);
      await downloadCanvasListAsZip(pages, '6seg-lock-x-safe');
    }
  });
  document.getElementById('lockImageFile').addEventListener('change', ev => {
    readLockPngFile(ev.target.files || []);
    ev.target.value = '';
  });
  document.getElementById('decryptBtn').addEventListener('click', decryptSelectedLockPng);

  buildLegend();
  render();

  // Draw a small empty lock preview.
  renderValuesToCanvas(['000000', '000000', '000000', '000000'], document.getElementById('lockCanvas'), 4);

  // v0.3.8: stop using Service Worker. Old cache-first SW versions caused stale decoders.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then(regs => Promise.all(regs.map(reg => reg.unregister())))
      .catch(() => {});
  }
  if (window.caches && caches.keys) {
    caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key)))).catch(() => {});
  }
}

window.addEventListener('DOMContentLoaded', init);
