"""Reject visually identical mouth/blink evidence even when DOM states look correct."""

from __future__ import annotations

import argparse
import itertools
import json
from pathlib import Path

import cv2
import numpy as np


def load(path: Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise FileNotFoundError(path)
    return image.astype(np.int16)


def difference(first: np.ndarray, second: np.ndarray) -> dict[str, float]:
    if first.shape != second.shape:
        raise ValueError(f"image shape mismatch: {first.shape} != {second.shape}")
    delta = np.abs(first - second)
    height, width = delta.shape[:2]
    return {
        "meanAbsoluteDifference": round(float(delta.mean()), 4),
        "changedPixelPercent": round(float((delta.max(axis=2) > 8).mean() * 100), 3),
        "screenLeftDifference": round(float(delta[:, : width // 2].mean()), 4),
        "screenRightDifference": round(float(delta[:, width // 2 :].mean()), 4),
    }


def outside_eye_difference(first: np.ndarray, second: np.ndarray) -> dict[str, float]:
    """Measure head stability while excluding the intentional eyelid replacement."""
    if first.shape != second.shape:
        raise ValueError(f"image shape mismatch: {first.shape} != {second.shape}")
    delta = np.abs(first - second)
    height, width = delta.shape[:2]
    outside = np.ones((height, width), dtype=bool)
    # The broad exclusion contains both blink masks and their feathered seam.
    outside[int(height * 0.28):int(height * 0.62), int(width * 0.12):int(width * 0.88)] = False
    selected = delta[outside]
    changed = delta.max(axis=2)[outside] > 8
    return {
        "meanAbsoluteDifference": round(float(selected.mean()), 4),
        "changedPixelPercent": round(float(changed.mean() * 100), 3),
    }


def eye_core_difference(first: np.ndarray, second: np.ndarray) -> dict[str, float]:
    """Measure intentional eyelid motion without diluting it with cheeks and background."""
    if first.shape != second.shape:
        raise ValueError(f"image shape mismatch: {first.shape} != {second.shape}")
    delta = np.abs(first - second)
    height, width = delta.shape[:2]
    left_mask = np.zeros((height, width), dtype=np.uint8)
    right_mask = np.zeros((height, width), dtype=np.uint8)
    axes = (max(1, int(width * 0.13)), max(1, int(height * 0.18)))
    cv2.ellipse(left_mask, (int(width * 0.30), int(height * 0.43)), axes, 0, 0, 360, 1, -1)
    cv2.ellipse(right_mask, (int(width * 0.69), int(height * 0.43)), axes, 0, 0, 360, 1, -1)
    combined = (left_mask | right_mask).astype(bool)
    left = left_mask.astype(bool)
    right = right_mask.astype(bool)
    return {
        "meanAbsoluteDifference": round(float(delta[combined].mean()), 4),
        "changedPixelPercent": round(float((delta.max(axis=2)[combined] > 8).mean() * 100), 3),
        "screenLeftDifference": round(float(delta[left].mean()), 4),
        "screenRightDifference": round(float(delta[right].mean()), 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", type=Path, required=True)
    parser.add_argument("--json", dest="json_path", type=Path, required=True)
    args = parser.parse_args()
    evidence = args.dir.resolve()
    mouth_names = ["closed", "a", "e", "o", "u"]
    mouths = {name: load(evidence / f"mouth-{name}.png") for name in mouth_names}
    mouth_pairs = {
        f"{first}-{second}": difference(mouths[first], mouths[second])
        for first, second in itertools.combinations(mouth_names, 2)
    }
    blink = {
        name: load(evidence / f"blink-{name}.png")
        for name in ["entry", "closed", "exit"]
    }
    blink_pairs = {
        "entry-closed": eye_core_difference(blink["entry"], blink["closed"]),
        "closed-exit": eye_core_difference(blink["closed"], blink["exit"]),
        "entry-exit": eye_core_difference(blink["entry"], blink["exit"]),
    }
    head_paths = {
        name: evidence / f"blink-{name}-head.png"
        for name in ["entry", "closed", "exit"]
    }
    head = {name: load(path) for name, path in head_paths.items()} if all(path.exists() for path in head_paths.values()) else {}
    head_pairs = {
        "entry-closed": outside_eye_difference(head["entry"], head["closed"]),
        "closed-exit": outside_eye_difference(head["closed"], head["exit"]),
        "entry-exit": outside_eye_difference(head["entry"], head["exit"]),
    } if head else {}
    failures: list[str] = []
    for name, metrics in mouth_pairs.items():
        minimum = 3.0 if name.startswith("closed-") else 0.8
        if metrics["meanAbsoluteDifference"] < minimum:
            failures.append(f"mouth-images-too-similar:{name}")
    for name in ["entry-closed", "closed-exit"]:
        metrics = blink_pairs[name]
        if metrics["meanAbsoluteDifference"] < 2.0:
            failures.append(f"blink-phases-too-similar:{name}")
        left = metrics["screenLeftDifference"]
        right = metrics["screenRightDifference"]
        if min(left, right) / max(1e-6, max(left, right)) < 0.45:
            failures.append(f"blink-eye-asymmetry:{name}")
    for name, metrics in head_pairs.items():
        if metrics["meanAbsoluteDifference"] > 1.25 or metrics["changedPixelPercent"] > 3.5:
            failures.append(f"blink-head-instability:{name}")
    report = {
        "evidenceDirectory": str(evidence),
        "mouthPairs": mouth_pairs,
        "blinkPairs": blink_pairs,
        "blinkHeadOutsideEyePairs": head_pairs,
        "failures": failures,
        "pass": not failures,
    }
    args.json_path.parent.mkdir(parents=True, exist_ok=True)
    args.json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
