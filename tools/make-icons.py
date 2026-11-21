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
    # Orbit: a planet with a tilted elliptical ring and a small moon
    import math
    cx = cy = S / 2
    small = size < 32
    rx, ry = S * 0.40, S * 0.16
    lw = S * (0.075 if small else 0.055)
    tilt = -28
    ring = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(ring).ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=(255, 255, 255, 235), width=round(lw))
    ring = ring.rotate(tilt, resample=Image.BICUBIC, center=(cx, cy))
    planet = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    pr = S * (0.20 if small else 0.185)
    ImageDraw.Draw(planet).ellipse([cx - pr, cy - pr, cx + pr, cy + pr], fill=(255, 255, 255, 255))
    # moon sitting on the ring, upper right (ring is rotated clockwise by |tilt| on screen)
    t = math.radians(-12)
    th = math.radians(-tilt)
    mx, my = rx * math.cos(t), ry * math.sin(t)
    mxr = cx + mx * math.cos(th) - my * math.sin(th)
    myr = cy + mx * math.sin(th) + my * math.cos(th)
    mr = S * (0.085 if small else 0.07)
    moon = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(moon).ellipse([mxr - mr, myr - mr, mxr + mr, myr + mr], fill=(255, 255, 255, 255))
    img = Image.alpha_composite(img, ring)
    img = Image.alpha_composite(img, planet)
    img = Image.alpha_composite(img, moon)
    return img.resize((size, size), Image.LANCZOS)

for s in (16, 32, 48, 128):
    render(s).save(os.path.join(OUT, f'{s}.png'))

svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#7ac4be"/><stop offset="1" stop-color="#2c8280"/></linearGradient></defs>
  <rect width="128" height="128" rx="29" fill="url(#g)"/>
  <g transform="rotate(-28 64 64)" fill="none" stroke="#fff" stroke-width="7" stroke-opacity=".92">
    <ellipse cx="64" cy="64" rx="51" ry="20"/></g>
  <circle cx="64" cy="64" r="24" fill="#fff"/>
  <circle cx="110" cy="84" r="9" fill="#fff"/>
</svg>
'''
open(os.path.join(OUT, 'icon.svg'), 'w').write(svg)
