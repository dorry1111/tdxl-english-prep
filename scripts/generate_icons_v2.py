# -*- coding: utf-8 -*-
"""现代化应用图标 v2：靛蓝→紫罗兰对角渐变 + 白色学士帽
产物: icon-192/512(圆角) icon-maskable-512(全出血) apple-touch-icon-180(全出血) favicon.svg"""
from PIL import Image, ImageDraw
import math, os

C1, C2 = (99, 102, 241), (139, 92, 246)  # indigo-500 -> violet-500

def gradient_bg(size, rounded=None):
    """对角渐变底；rounded=半径时四角透明"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    grad = Image.new('RGBA', (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size - 2)
            px[x, y] = (round(C1[0] + (C2[0]-C1[0])*t),
                        round(C1[1] + (C2[1]-C1[1])*t),
                        round(C1[2] + (C2[2]-C1[2])*t), 255)
    if rounded:
        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size-1, size-1], radius=rounded, fill=255)
        img.paste(grad, (0, 0), mask)
    else:
        img = grad
    return img

def draw_cap(img, scale=1.0, cx=None, cy=None):
    """白色学士帽（含帽穗），以 (cx,cy) 为中心按 scale 缩放"""
    d = ImageDraw.Draw(img)
    W = img.size[0]
    cx = W/2 if cx is None else cx
    cy = W*0.46 if cy is None else cy
    s = W/1024 * scale
    def P(x, y): return (cx + x*s, cy + y*s)
    # 帽身（帽檐下）圆角矩形
    d.rounded_rectangle([P(-150, 60), P(150, 210)], radius=int(40*s), fill=(255, 255, 255, 255))
    # 帽檐（菱形板）
    d.polygon([P(0, -165), P(300, 0), P(0, 165), P(-300, 0)], fill=(255, 255, 255, 255))
    # 板顶高光（半透明淡紫描层）
    d.polygon([P(0, -130), P(238, 0), P(0, 130), P(-238, 0)], fill=(255, 255, 255, 40))
    # 顶部纽扣
    d.ellipse([P(-20, -20), P(20, 20)], fill=(255, 255, 255, 255))
    # 帽穗：从纽扣垂到右侧
    d.line([P(0, 0), P(215, 0)], fill=(255, 255, 255, 255), width=max(2, int(14*s)))
    d.line([P(215, 0), P(215, 150)], fill=(255, 255, 255, 255), width=max(2, int(14*s)))
    d.ellipse([P(215-30, 150), P(215+30, 210)], fill=(255, 255, 255, 255))
    # 帽身开口（月牙形镂空，制造层次）
    d.pieslice([P(-110, -60), P(110, 130)], start=200, end=340, fill=(139, 92, 246, 90))

# ---------- 1. 标准图标（圆角透明角） ----------
for size, out in [(1024, None), (512, 'public/icons/icon-512.png'), (192, 'public/icons/icon-192.png')]:
    img = gradient_bg(size, rounded=int(size*0.226))
    draw_cap(img)
    if out:
        img.save(out)
        print('saved', out)
    else:
        img.save('data-raw/tmp/icon-1024-preview.png')

# ---------- 2. maskable（全出血，图形收进 66% 安全区） ----------
img = gradient_bg(1024, rounded=None)
draw_cap(img, scale=0.66)
img.save('public/icons/icon-maskable-512.png')
print('saved public/icons/icon-maskable-512.png')

# ---------- 3. apple-touch-icon 180（全出血方角，iOS 自行裁圆角） ----------
img = gradient_bg(1024, rounded=None)
draw_cap(img)
img = img.resize((180, 180), Image.LANCZOS)
img.save('public/icons/apple-touch-icon-180.png')
print('saved public/icons/apple-touch-icon-180.png')

# ---------- 4. favicon.svg（矢量版，同设计） ----------
svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366F1"/>
      <stop offset="1" stop-color="#8B5CF6"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="116" fill="url(#g)"/>
  <g fill="#fff">
    <rect x="146" y="302" width="220" height="86" rx="24"/>
    <polygon points="256,116 406,199 256,282 106,199"/>
    <polygon points="256,148 378,213 256,278 134,213" opacity="0.16"/>
    <circle cx="256" cy="199" r="11"/>
    <rect x="249" y="196" width="14" height="8" rx="4"/>
    <rect x="355" y="192" width="13" height="82" rx="6.5"/>
    <circle cx="361.5" cy="288" r="16"/>
  </g>
  <path d="M 196 236 A 62 40 0 0 0 316 236 L 316 262 A 62 40 0 0 1 196 262 Z" fill="#8B5CF6" opacity="0.35"/>
</svg>'''
open('public/favicon.svg', 'w', encoding='utf-8').write(svg)
print('saved public/favicon.svg')
