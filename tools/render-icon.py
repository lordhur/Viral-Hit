"""Render the Viral Hit PNG icon with only the Python standard library."""

from __future__ import annotations

import math
from pathlib import Path
import struct
import zlib


SIZE = 1024
UNITS = 32.0
ROOT = Path(__file__).resolve().parents[1]
V_POLYGON = [(8, 9.5), (14.05, 23), (17.95, 23), (24, 9.5), (19.7, 9.5), (15.98, 18.36), (12.28, 9.5)]
SPARK_POLYGON = [(22.8, 5.2), (23.5, 7.3), (25.6, 8), (23.5, 8.7), (22.8, 10.8), (22.1, 8.7), (20, 8), (22.1, 7.3)]
STOPS = [(0.0, (255, 106, 61)), (0.52, (255, 61, 113)), (1.0, (168, 85, 247))]


def inside_polygon(x: float, y: float, points: list[tuple[float, float]]) -> bool:
    inside = False
    previous = points[-1]
    for current in points:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
        previous = current
    return inside


def gradient(x: float, y: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, ((x - 4) * 24 - (y - 28) * 24) / 1152))
    left, right = STOPS[0], STOPS[-1]
    for index in range(len(STOPS) - 1):
        if STOPS[index][0] <= t <= STOPS[index + 1][0]:
            left, right = STOPS[index], STOPS[index + 1]
            break
    local = (t - left[0]) / (right[0] - left[0])
    return tuple(round(a + (b - a) * local) for a, b in zip(left[1], right[1]))


def rounded_mark(x: float, y: float) -> bool:
    qx = abs(x - 16) - 6
    qy = abs(y - 16) - 6
    distance = math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - 9
    return distance <= 0


def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def main() -> None:
    rows: list[bytes] = []
    for py in range(SIZE):
        y = (py + 0.5) * UNITS / SIZE
        row = bytearray([0])
        for px in range(SIZE):
            x = (px + 0.5) * UNITS / SIZE
            if not rounded_mark(x, y):
                row.extend((0, 0, 0, 0))
            elif inside_polygon(x, y, V_POLYGON):
                row.extend((255, 255, 255, 255))
            elif inside_polygon(x, y, SPARK_POLYGON):
                row.extend((255, 255, 255, 235))
            else:
                row.extend((*gradient(x, y), 255))
        rows.append(bytes(row))
    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    payload = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")
    (ROOT / "build" / "icon.png").write_bytes(payload)


if __name__ == "__main__":
    main()
