"""Pixel-level acceptance for final-window station avatar face frames."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def load_rgb(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.int16)


def crop(array: np.ndarray, bounds: tuple[float, float, float, float]) -> np.ndarray:
    height, width = array.shape[:2]
    left, top, right, bottom = bounds
    return array[
        int(round(top * height)):int(round(bottom * height)),
        int(round(left * width)):int(round(right * width)),
    ]


def difference_metrics(left: np.ndarray, right: np.ndarray, bounds) -> dict:
    difference = np.abs(left - right).mean(axis=2)
    region = crop(difference, bounds)
    return {
        "mean": round(float(region.mean()), 4),
        "p95": round(float(np.percentile(region, 95)), 4),
        "above3Percent": round(float((region > 3).mean() * 100), 4),
    }


def first_changed_row(left: np.ndarray, right: np.ndarray) -> int | None:
    difference = np.abs(left - right).mean(axis=2)
    for row in range(difference.shape[0]):
        if np.any(difference[row] > 1):
            return row
    return None


def detached_dark_components(frame: np.ndarray, idle: np.ndarray) -> dict:
    height, width = frame.shape[:2]
    rgb = frame.astype(np.uint8)
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    left, top, right, bottom = int(.15 * width), int(.50 * height), int(.85 * width), int(.80 * height)
    mask = (gray[top:bottom, left:right] < 60).astype(np.uint8)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
    components = []
    for index in range(1, count):
        x, y, component_width, component_height, area = stats[index]
        if area < 2:
            continue
        component_rows, component_columns = np.where(labels == index)
        absolute_rows = component_rows + top
        absolute_columns = component_columns + left
        idle_difference = np.abs(frame[absolute_rows, absolute_columns] - idle[absolute_rows, absolute_columns]).mean(axis=1)
        components.append({
            "area": int(area),
            "x": int(x + left),
            "y": int(y + top),
            "width": int(component_width),
            "height": int(component_height),
            "centerX": round(float(centroids[index][0] + left), 2),
            "centerY": round(float(centroids[index][1] + top), 2),
            "differenceFromIdleMean": round(float(idle_difference.mean()), 4),
            "unchangedFromIdlePercent": round(float((idle_difference < 1).mean() * 100), 4),
        })
    components.sort(key=lambda item: item["area"], reverse=True)
    # A legitimate E/U mouth can contain multiple dark components separated by
    # teeth or highlights. A residual is specifically an old closed-mouth mark:
    # it stays pixel-identical to idle while the authored mouth around it moves.
    detached = [
        component for component in components[1:]
        if component["area"] > 30
        and (component["differenceFromIdleMean"] < 3 or component["unchangedFromIdlePercent"] > 70)
    ]
    return {"components": components[:12], "detachedOver30Px": detached}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--idle", required=True, type=Path)
    parser.add_argument("--dynamic", required=True, type=Path, action="append")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    idle = load_rgb(args.idle)
    dynamic = [load_rgb(path) for path in args.dynamic]
    failures = []
    if len(dynamic) < 2:
        failures.append("need-at-least-two-held-dynamic-frames")
    if any(frame.shape != idle.shape for frame in dynamic):
        failures.append("frame-dimensions-mismatch")

    regions = {
        "eyes": (.05, .09, .95, .33),
        "nose": (.25, .32, .75, .53),
        "upperCheeks": (.05, .32, .95, .52),
        "mouth": (.19, .52, .81, .76),
        "chin": (.21, .72, .79, .965),
    }
    idle_to_dynamic = []
    for index, frame in enumerate(dynamic):
        metrics = {name: difference_metrics(idle, frame, bounds) for name, bounds in regions.items()}
        changed_row = first_changed_row(idle, frame)
        idle_to_dynamic.append({
            "frame": str(args.dynamic[index]),
            "metrics": metrics,
            "firstChangedRow": changed_row,
            "firstChangedRowRatio": round((changed_row or 0) / idle.shape[0], 4),
            "darkComponents": detached_dark_components(frame, idle),
        })
        if metrics["nose"]["mean"] > .08 or metrics["nose"]["p95"] > .5:
            failures.append(f"nose-not-locked:frame-{index + 1}")
        if metrics["upperCheeks"]["mean"] > .08 or metrics["upperCheeks"]["p95"] > .5:
            failures.append(f"upper-skin-brightness-shift:frame-{index + 1}")
        if changed_row is None or changed_row / idle.shape[0] < .51:
            failures.append(f"deformation-reaches-upper-face:frame-{index + 1}")
        if metrics["mouth"]["mean"] < 5 or metrics["chin"]["mean"] < 2:
            failures.append(f"dynamic-mouth-or-chin-not-visible:frame-{index + 1}")
        if idle_to_dynamic[-1]["darkComponents"]["detachedOver30Px"]:
            failures.append(f"detached-dark-mouth-residual:frame-{index + 1}")

    held_consistency = None
    if len(dynamic) >= 2 and dynamic[-2].shape == dynamic[-1].shape:
        held_consistency = {
            name: difference_metrics(dynamic[-2], dynamic[-1], bounds)
            for name, bounds in regions.items()
        }
        if held_consistency["nose"]["mean"] > .05 or held_consistency["upperCheeks"]["mean"] > .05:
            failures.append("held-frame-nose-or-skin-flicker")
        if held_consistency["mouth"]["mean"] > 1.5 or held_consistency["chin"]["mean"] > 2.5:
            failures.append("held-pose-frame-instability")

    report = {
        "suite": "station-final-window-face-stability",
        "idle": str(args.idle),
        "dynamic": [str(path) for path in args.dynamic],
        "shape": list(idle.shape),
        "idleToDynamic": idle_to_dynamic,
        "heldConsistency": held_consistency,
        "failures": failures,
        "result": "PASS" if not failures else "FAIL",
        "boundary": "Final-window pixels validate locked upper face, held-pose exposure, visible mouth/chin motion and detached dark residuals.",
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"result": report["result"], "failures": failures, "report": str(args.out)}, ensure_ascii=False, indent=2))
    raise SystemExit(0 if not failures else 1)


if __name__ == "__main__":
    main()
