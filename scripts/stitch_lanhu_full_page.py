"""Stitch Lanhu's embedded Axure canvas from browser viewport captures."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


ROOT = (
    Path(__file__).resolve().parents[1]
    / "docs"
    / "requirements"
    / "station-advisor"
    / "screenshots"
    / "lanhu-full-page"
)
METADATA = ROOT / "capture-metadata.json"
OUTPUT = ROOT / "lanhu-8.25-final-full-page.png"


def main() -> None:
    metadata = json.loads(METADATA.read_text(encoding="utf-8"))
    canvas = Image.new(
        "RGB",
        (metadata["canvas"]["width"], metadata["canvas"]["height"]),
        "white",
    )
    viewport = metadata["iframeViewport"]
    crop_box = (
        viewport["x"],
        viewport["y"],
        viewport["x"] + viewport["width"],
        viewport["y"] + viewport["height"],
    )

    for tile in metadata["tiles"]:
        with Image.open(ROOT / "tiles" / tile["name"]) as screenshot:
            visible_canvas = screenshot.convert("RGB").crop(crop_box)
            canvas.paste(visible_canvas, (tile["left"], tile["top"]))

    canvas.save(OUTPUT, optimize=True)
    print(f"stitched={OUTPUT}")
    print(f"size={canvas.width}x{canvas.height}")


if __name__ == "__main__":
    main()
