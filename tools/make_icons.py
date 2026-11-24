"""Builds the Luma PWA icons from the supplied monogram artwork.

Source: design/assets/originals/luma-app-icon-reference.jpg (1254x1254 mockup with a
cream margin and a rounded-square tile). We crop a square inset inside the tile so the
mockup margin and rounded corners are removed (full-bleed), then derive:
  icons/icon-192.png, icons/icon-512.png      purpose "any", full-bleed
  icons/apple-touch-icon.png (180)            full-bleed, opaque (iOS applies its own mask)
  icons/icon-maskable-512.png                 monogram scaled into the 80% safe zone over a
                                              blurred backdrop of the same artwork
  icons/favicon-32.png
Run: python tools/make_icons.py   (dev-only; requires Pillow)
"""
from pathlib import Path
from PIL import Image, ImageFilter, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "design" / "assets" / "originals" / "luma-app-icon-reference.jpg"
OUT = ROOT / "icons"
OUT.mkdir(exist_ok=True)

# Tile spans roughly x 168..1085, y 172..1085 with ~170px corner radius. An inset of ~95px
# keeps every crop corner inside the rounded tile (needs >= 0.293 * radius).
CROP = (266, 268, 990, 992)

src = Image.open(SRC).convert("RGB")
tile = src.crop(CROP)


def full(size):
    return tile.resize((size, size), Image.LANCZOS)


def maskable(size):
    backdrop = tile.resize((size, size), Image.LANCZOS).filter(ImageFilter.GaussianBlur(size * 0.12))
    inner = int(size * 0.72)
    art = tile.resize((inner, inner), Image.LANCZOS)
    mask = Image.new("L", (inner, inner), 0)
    feather = int(inner * 0.06)
    ImageDraw.Draw(mask).rectangle((feather, feather, inner - feather, inner - feather), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(feather * 0.8))
    off = (size - inner) // 2
    backdrop.paste(art, (off, off), mask)
    return backdrop


full(192).save(OUT / "icon-192.png", optimize=True)
full(512).save(OUT / "icon-512.png", optimize=True)
full(180).save(OUT / "apple-touch-icon.png", optimize=True)
full(32).save(OUT / "favicon-32.png", optimize=True)
maskable(512).save(OUT / "icon-maskable-512.png", optimize=True)
print("icons written to", OUT)
