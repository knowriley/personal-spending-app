#!/usr/bin/env python3
"""build_assets.py — generate icon + splash PNGs from source SVGs.

Idempotent: skips a target whose PNG is newer than its source SVG.
Called by build_static.py at deploy time; safe to run standalone for
local design iteration.

If cairosvg's runtime can't find libcairo on the build host, the build
fails loudly here rather than producing a half-baked /dist. The fallback
plan (svglib + reportlab) is documented in PRD-v2-engineering.md and
will be wired in if Render's static-site env can't satisfy libcairo.
"""

import sys
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).parent
ICONS_DIR = ROOT / "static" / "icons"
SPLASH_DIR = ROOT / "static" / "splash"

ICONS_SRC = ICONS_DIR / "source.svg"
SPLASH_SRC = SPLASH_DIR / "source.svg"

# (output_filename, output_size_px). Square output: width == height.
ICONS = [
    ("icon-120.png", 120),         # iOS @2x iPhone
    ("icon-152.png", 152),         # iPad
    ("icon-167.png", 167),         # iPad Pro
    ("icon-180.png", 180),         # iOS @3x iPhone (primary)
    ("icon-192.png", 192),         # W3C manifest
    ("icon-512.png", 512),         # W3C manifest, macOS dock
    ("icon-192-maskable.png", 192),
    ("icon-512-maskable.png", 512),
    ("favicon-32.png", 32),
    ("favicon-16.png", 16),
]

# (output_filename, width_px, height_px) for iOS apple-touch-startup-images.
SPLASHES = [
    ("splash-1290x2796.png", 1290, 2796),   # iPhone 15/14/13 Pro Max
    ("splash-1206x2622.png", 1206, 2622),   # iPhone 15/14 Pro
    ("splash-1170x2532.png", 1170, 2532),   # iPhone 15/14/13 standard
    ("splash-1080x2340.png", 1080, 2340),   # iPhone 13/12 mini
    ("splash-750x1334.png",   750, 1334),   # iPhone SE/8/7/6s
    ("splash-2048x2732.png", 2048, 2732),   # iPad Pro 12.9"
    ("splash-1668x2388.png", 1668, 2388),   # iPad Pro 11" / iPad Air
    ("splash-1620x2160.png", 1620, 2160),   # iPad standard
    ("splash-1488x2266.png", 1488, 2266),   # iPad mini
]


def main():
    if not ICONS_SRC.exists():
        sys.exit(f"missing icon source: {ICONS_SRC}")
    if not SPLASH_SRC.exists():
        sys.exit(f"missing splash source: {SPLASH_SRC}")

    rendered = 0
    skipped = 0

    for fname, size in ICONS:
        dst = ICONS_DIR / fname
        if _is_fresh(dst, ICONS_SRC):
            skipped += 1
            continue
        cairosvg.svg2png(
            url=str(ICONS_SRC),
            output_width=size, output_height=size,
            write_to=str(dst),
        )
        rendered += 1

    for fname, w, h in SPLASHES:
        dst = SPLASH_DIR / fname
        if _is_fresh(dst, SPLASH_SRC):
            skipped += 1
            continue
        cairosvg.svg2png(
            url=str(SPLASH_SRC),
            output_width=w, output_height=h,
            write_to=str(dst),
        )
        rendered += 1

    # favicon.ico — multi-resolution ICO assembled from favicon-32.png.
    favicon_png = ICONS_DIR / "favicon-32.png"
    favicon_ico = ICONS_DIR / "favicon.ico"
    if not _is_fresh(favicon_ico, favicon_png):
        img = Image.open(favicon_png).convert("RGBA")
        img.save(favicon_ico, format="ICO", sizes=[(16, 16), (32, 32)])
        rendered += 1
    else:
        skipped += 1

    print(f"build_assets: {rendered} rendered, {skipped} skipped")


def _is_fresh(dst: Path, src: Path) -> bool:
    """True iff dst exists and is newer than src."""
    if not dst.exists():
        return False
    return dst.stat().st_mtime >= src.stat().st_mtime


if __name__ == "__main__":
    main()
