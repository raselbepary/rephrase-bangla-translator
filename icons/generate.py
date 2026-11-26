#!/usr/bin/env python3
"""Generate the extension icons: rounded indigo square with two exchange arrows.

Pure standard library — draws at 768px and box-downsamples to each required
size (768 is divisible by 16, 32, 48 and 128). Run: python3 icons/generate.py
"""
import os
import struct
import zlib

BASE = 768
BG = (79, 70, 229, 255)    # indigo #4F46E5
FG = (255, 255, 255, 255)  # white (top arrow)
FG2 = (199, 210, 254, 255)  # light indigo #C7D2FE (bottom arrow)
SIZES = [16, 32, 48, 128]


def in_rounded(px, py, s):
    r = s * 0.205
    cx = min(max(px, r), s - r)
    cy = min(max(py, r), s - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def in_rect(px, py, x0, y0, x1, y1):
    return x0 <= px <= x1 and y0 <= py <= y1


def in_tri(px, py, ax, ay, bx, by, cx, cy):
    d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
    d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
    d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def draw(px, py, s):
    if not in_rounded(px, py, s):
        # Keep the background color in transparent pixels so downsampled edge
        # pixels blend toward indigo instead of black.
        return (BG[0], BG[1], BG[2], 0)
    # Top arrow: bar + head pointing right.
    if in_rect(px, py, s * 0.20, s * 0.27, s * 0.62, s * 0.37) or in_tri(
        px, py, s * 0.60, s * 0.22, s * 0.60, s * 0.42, s * 0.80, s * 0.32
    ):
        return FG
    # Bottom arrow: bar + head pointing left.
    if in_rect(px, py, s * 0.38, s * 0.63, s * 0.80, s * 0.73) or in_tri(
        px, py, s * 0.40, s * 0.58, s * 0.40, s * 0.78, s * 0.20, s * 0.68
    ):
        return FG2
    return BG


def render(s):
    buf = bytearray()
    for y in range(s):
        for x in range(s):
            buf.extend(draw(x + 0.5, y + 0.5, s))
    return buf


def downsample(pixels, base, target):
    step = base // target
    n = step * step
    out = []
    for ty in range(target):
        row = bytearray([0])  # PNG filter type 0
        for tx in range(target):
            r = g = b = a = 0
            for yy in range(ty * step, (ty + 1) * step):
                base_row = yy * base
                for xx in range(tx * step, (tx + 1) * step):
                    i = (base_row + xx) * 4
                    r += pixels[i]
                    g += pixels[i + 1]
                    b += pixels[i + 2]
                    a += pixels[i + 3]
            row.extend((r // n, g // n, b // n, a // n))
        out.append(bytes(row))
    return b"".join(out)


def write_png(path, size, raw):
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    with open(path, "wb") as f:
        f.write(
            b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b"")
        )


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    pixels = render(BASE)
    for size in SIZES:
        write_png(os.path.join(here, f"icon{size}.png"), size, downsample(pixels, BASE, size))
        print(f"wrote icon{size}.png")


if __name__ == "__main__":
    main()
