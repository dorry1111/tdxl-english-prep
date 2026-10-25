/**
 * 由 public/icons/icon-512.png 生成 build/icon.ico（PNG 内嵌式 ICO，Vista+ 支持）。
 *
 * electron-builder 的 NSIS 目标要求 .ico；手写头部比引入 png-to-ico 依赖更轻：
 * ICONDIR(6B) + ICONDIRENTRY(16B) + 原始 PNG 数据。
 */
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('public/icons/icon-512.png');
const outDir = path.resolve('build');
const out = path.join(outDir, 'icon.ico');

const png = fs.readFileSync(src);
if (png.subarray(1, 4).toString('latin1') !== 'PNG') {
  throw new Error('源文件不是 PNG：' + src);
}

const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // count
// ICONDIRENTRY
header.writeUInt8(0, 6); // width: 0 表示 256
header.writeUInt8(0, 7); // height
header.writeUInt8(0, 8); // palette
header.writeUInt8(0, 9); // reserved
header.writeUInt16LE(1, 10); // planes
header.writeUInt16LE(32, 12); // bpp
header.writeUInt32LE(png.length, 14); // bytesInRes
header.writeUInt32LE(22, 18); // imageOffset

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(out, Buffer.concat([header, png]));
console.log('[ico] 已生成', out, `(${png.length + 22} bytes)`);
