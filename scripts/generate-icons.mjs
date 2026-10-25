/**
 * 生成 PWA 图标与 iOS 启动图（一次性构建期脚本，不进入运行时）。
 *
 * 为什么自己生成：iOS 的 apple-touch-icon 必须是真实存在的 PNG（不接受 SVG/WebP），
 * 仓库里不能引用不存在的文件。这里用零依赖的方式手写最小 PNG 编码器
 * （IHDR + IDAT + IEND，RGBA 8bit，zlib deflate），产出纯色底 + 白色对勾的占位图标。
 *
 * 用法：node scripts/generate-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 与 styles/tokens.css 的 --c-primary / --c-bg 保持一致（浅色）
const BRAND = [15, 139, 141]; // #0f8b8d
const WHITE = [255, 255, 255];
const SPLASH_BG = [246, 248, 249]; // #f6f8f9

// ---------------------------------------------------------------------------
// PNG 编码
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // 每行前加一个 filter 字节（0 = None）
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// 绘制工具
// ---------------------------------------------------------------------------

function createCanvas(width, height, background) {
  const buffer = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    buffer[offset] = background[0];
    buffer[offset + 1] = background[1];
    buffer[offset + 2] = background[2];
    buffer[offset + 3] = 255;
  }
  return buffer;
}

/** 点到线段距离 */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(px - ax, py - ay);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 圆角矩形有符号距离 */
function distanceToRoundedBox(px, py, cx, cy, halfWidth, halfHeight, radius) {
  const qx = Math.abs(px - cx) - (halfWidth - radius);
  const qy = Math.abs(py - cy) - (halfHeight - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - radius;
}

/**
 * 在画布上叠加一层颜色（带 1px 抗锯齿）。
 * @param coverage 距离 → 0~1 的覆盖度函数
 */
function paintRegion(canvas, width, height, bounds, color, coverage) {
  const { x0, y0, x1, y1 } = bounds;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(height, Math.ceil(y1)); y += 1) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x += 1) {
      const alpha = coverage(x + 0.5, y + 0.5);
      if (alpha <= 0) {
        continue;
      }
      const offset = (y * width + x) * 4;
      canvas[offset] = Math.round(canvas[offset] * (1 - alpha) + color[0] * alpha);
      canvas[offset + 1] = Math.round(canvas[offset + 1] * (1 - alpha) + color[1] * alpha);
      canvas[offset + 2] = Math.round(canvas[offset + 2] * (1 - alpha) + color[2] * alpha);
      canvas[offset + 3] = 255;
    }
  }
}

/** 画一个白色对勾（两段线段），尺寸按画布边长等比缩放 */
function drawCheck(canvas, width, height, scale = 1, center = { x: width / 2, y: height / 2 }) {
  const size = Math.min(width, height) * scale;
  const strokeWidth = size * 0.13;
  const half = strokeWidth / 2;
  const points = [
    { x: center.x - size * 0.26, y: center.y + size * 0.01 },
    { x: center.x - size * 0.08, y: center.y + size * 0.19 },
    { x: center.x + size * 0.27, y: center.y - size * 0.18 },
  ];
  const segments = [
    [points[0], points[1]],
    [points[1], points[2]],
  ];

  paintRegion(
    canvas,
    width,
    height,
    {
      x0: center.x - size * 0.5,
      y0: center.y - size * 0.5,
      x1: center.x + size * 0.5,
      y1: center.y + size * 0.5,
    },
    WHITE,
    (px, py) => {
      let distance = Infinity;
      for (const [a, b] of segments) {
        distance = Math.min(distance, distanceToSegment(px, py, a.x, a.y, b.x, b.y));
      }
      // 距离小于半宽即为完全覆盖，边缘 1px 做线性过渡
      return Math.max(0, Math.min(1, half + 0.5 - distance));
    },
  );
}

/** 画圆角方块（用于启动图中间的图标） */
function drawRoundedSquare(canvas, width, height, size, center, color, radiusRatio = 0.22) {
  const half = size / 2;
  const radius = size * radiusRatio;
  paintRegion(
    canvas,
    width,
    height,
    { x0: center.x - size, y0: center.y - size, x1: center.x + size, y1: center.y + size },
    color,
    (px, py) =>
      Math.max(
        0,
        Math.min(1, 0.5 - distanceToRoundedBox(px, py, center.x, center.y, half, half, radius)),
      ),
  );
}

// ---------------------------------------------------------------------------
// 产出
// ---------------------------------------------------------------------------

function writePng(relativePath, width, height, canvas) {
  const target = join(ROOT, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, encodePng(width, height, canvas));
  console.log(`  ✓ ${relativePath} (${width}×${height})`);
}

console.log('生成 PWA 图标…');

// any 用途图标：满幅品牌底色 + 白色对勾
for (const [size, file] of [
  [192, 'public/icons/icon-192.png'],
  [512, 'public/icons/icon-512.png'],
  [180, 'public/icons/apple-touch-icon-180.png'],
]) {
  const canvas = createCanvas(size, size, BRAND);
  drawCheck(canvas, size, size, 1);
  writePng(file, size, size, canvas);
}

// maskable 图标：内容缩到 60%，四周留 20% 安全边，避免被 Android 蒙版裁掉
{
  const size = 512;
  const canvas = createCanvas(size, size, BRAND);
  drawCheck(canvas, size, size, 0.6);
  writePng('public/icons/icon-maskable-512.png', size, size, canvas);
}

console.log('生成 iOS 启动图…');

const SPLASH_SIZES = [
  [1170, 2532],
  [1179, 2556],
  [1206, 2622],
  [1290, 2796],
  [1320, 2868],
  [1640, 2360],
  [2048, 2732],
  [2732, 2048],
];

for (const [width, height] of SPLASH_SIZES) {
  const canvas = createCanvas(width, height, SPLASH_BG);
  const iconSize = Math.min(width, height) * 0.22;
  const center = { x: width / 2, y: height / 2 };
  drawRoundedSquare(canvas, width, height, iconSize, center, BRAND, 0.24);
  drawCheck(canvas, width, height, 0.22 * 0.72, center);
  writePng(`public/splash/apple-splash-${width}x${height}.png`, width, height, canvas);
}

console.log('完成。');
