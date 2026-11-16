"""Regenerates icons/*.png (and icons/icon.svg). Requires Pillow: python3 tools/make-icons.py"""
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
SS = 8  # supersampling factor

def lerp(a, b, t): return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def render(size):
    S = size * SS
    top, bot = (122, 196, 190), (44, 130, 128)
    grad = Image.new('RGBA', (S, S))
    px = grad.load()
    for y in range(S):
        c = lerp(top, bot, y / (S - 1))
        for x in range(S): px[x, y] = c + (255,)
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.225, fill=255)
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)
    overlay = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    # 2x2 grid of "spaces"; top-left is the active one (solid white), the rest translucent
    m = S * (0.17 if size >= 32 else 0.14)   # outer margin
    gap = S * (0.09 if size >= 32 else 0.10)
    cell = (S - 2 * m - gap) / 2
    r = cell * 0.24
    for i, (cx, cy) in enumerate([(0, 0), (1, 0), (0, 1), (1, 1)]):
        x0 = m + cx * (cell + gap); y0 = m + cy * (cell + gap)
        fill = (255, 255, 255, 255) if i == 0 else (255, 255, 255, 150)
        d.rounded_rectangle([x0, y0, x0 + cell, y0 + cell], radius=r, fill=fill)
    img = Image.alpha_composite(img, overlay)
    return img.resize((size, size), Image.LANCZOS)

for s in (16, 32, 48, 128):
    render(s).save(os.path.join(OUT, f'{s}.png'))

svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#7ac4be"/><stop offset="1" stop-color="#2c8280"/></linearGradient></defs>
  <rect width="128" height="128" rx="29" fill="url(#g)"/>
  <rect x="22" y="22" width="38" height="38" rx="9" fill="#fff"/>
  <rect x="68" y="22" width="38" height="38" rx="9" fill="#fff" fill-opacity=".59"/>
  <rect x="22" y="68" width="38" height="38" rx="9" fill="#fff" fill-opacity=".59"/>
  <rect x="68" y="68" width="38" height="38" rx="9" fill="#fff" fill-opacity=".59"/>
</svg>
'''
open(os.path.join(OUT, 'icon.svg'), 'w').write(svg)
