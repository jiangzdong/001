"""Build identity-locked offline viseme, expression and blink assets."""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np


STABLE = (33, 133, 362, 263, 1, 168)
LIPS = (61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 185, 40, 39, 37, 0, 267, 269, 270, 409)
LEFT_EYE_BROW = (46, 53, 52, 65, 55, 33, 133, 159, 145)
RIGHT_EYE_BROW = (276, 283, 282, 295, 285, 362, 263, 386, 374)

MOUTH_TARGETS = {
    "rest": "xiaoa-viseme-rest-generated-v1.png",
    "a": "xiaoa-viseme-a-generated-candidate-v1.png",
    "e": "xiaoa-viseme-ei-generated-v1.png",
    "o": "xiaoa-viseme-o-generated-v1.png",
    "u": "xiaoa-viseme-uw-generated-v1.png",
    "mbp": "xiaoa-viseme-mbp-generated-v1.png",
    "f": "xiaoa-viseme-fv-generated-candidate-v2.png",
    "l": "xiaoa-viseme-l-generated-candidate-v1.png",
    "s": "xiaoa-viseme-szc-generated-v1.png",
    "sh": "xiaoa-viseme-shchzhr-generated-v1.png",
    "ndt": "xiaoa-viseme-ndt-generated-candidate-v1.png",
}

FACE_TARGETS = {
    "expression-smile-v4": ("xiaoa-expression-smile-generated-v1.png", "expression"),
    "expression-concern-v4": ("xiaoa-expression-empathy-generated-v1.png", "expression"),
    "expression-encourage-v4": ("xiaoa-expression-encourage-generated-v1.png", "expression"),
    "expression-listening-v4": ("xiaoa-expression-focus-generated-v1.png", "expression"),
    "expression-clarify-v1": ("xiaoa-expression-clarify-generated-v1.png", "expression"),
    "blink-half-v6": ("xiaoa-blink-half-generated-v1.png", "blink"),
    "blink-closed-v4": ("xiaoa-blink-closed-generated-v1.png", "blink"),
}


def detect(landmarker, path: Path):
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Unable to read {path}")
    result = landmarker.detect(mp.Image.create_from_file(str(path)))
    if not result.face_landmarks:
        raise RuntimeError(f"No face detected in {path}")
    height, width = image.shape[:2]
    points = np.asarray([(point.x * width, point.y * height) for point in result.face_landmarks[0]], dtype=np.float32)
    return image, points


def align(image, points, master_points, size):
    matrix, _ = cv2.estimateAffinePartial2D(points[list(STABLE)], master_points[list(STABLE)], method=cv2.LMEDS)
    if matrix is None:
        raise RuntimeError("Unable to estimate face alignment")
    aligned = cv2.warpAffine(image, matrix, size, flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
    aligned_points = cv2.transform(points.reshape(1, -1, 2), matrix).reshape(-1, 2)
    return aligned, aligned_points


def polygon_mask(size, polygons, blur):
    width, height = size
    mask = np.zeros((height, width), dtype=np.uint8)
    for polygon in polygons:
        cv2.fillConvexPoly(mask, np.round(polygon).astype(np.int32), 255, cv2.LINE_AA)
    if blur:
        mask = cv2.GaussianBlur(mask, (0, 0), blur)
    return mask.astype(np.float32)[:, :, None] / 255.0


def mouth_mask(points, size):
    mouth = points[list(LIPS)]
    left, top = np.min(mouth, axis=0)
    right, bottom = np.max(mouth, axis=0)
    mouth_width = right - left
    mouth_height = max(bottom - top, mouth_width * 0.12)
    center = ((left + right) * 0.5, (top + bottom) * 0.5 + mouth_height * 0.08)
    axes = (mouth_width * 0.78, mouth_height * 1.25 + mouth_width * 0.10)
    polygon = cv2.ellipse2Poly(
        tuple(np.round(center).astype(int)),
        tuple(np.round(axes).astype(int)),
        0,
        0,
        360,
        5,
    )
    return polygon_mask(size, [polygon], max(7.0, mouth_width * 0.075))


def eye_expression_mask(points, size, expression):
    polygons = []
    for indices in (LEFT_EYE_BROW, RIGHT_EYE_BROW):
        region = points[list(indices)]
        left, top = np.min(region, axis=0)
        right, bottom = np.max(region, axis=0)
        span = right - left
        if expression:
            left -= span * 0.42
            right += span * 0.42
            top -= span * 0.34
            bottom += span * 0.58
        else:
            left -= span * 0.24
            right += span * 0.24
            top -= span * 0.18
            bottom += span * 0.28
        center = ((left + right) * 0.5, (top + bottom) * 0.5)
        axes = ((right - left) * 0.5, (bottom - top) * 0.5)
        polygons.append(cv2.ellipse2Poly(tuple(np.round(center).astype(int)), tuple(np.round(axes).astype(int)), 0, 0, 360, 5))
    return polygon_mask(size, polygons, 10.0 if expression else 6.0)


def composite(master, target, mask):
    mixed = target.astype(np.float32) * mask + master.astype(np.float32) * (1.0 - mask)
    return np.clip(mixed, 0, 255).astype(np.uint8)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--master", required=True, type=Path)
    parser.add_argument("--candidates", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(args.model)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.25,
        min_face_presence_confidence=0.25,
    )
    with mp.tasks.vision.FaceLandmarker.create_from_options(options) as landmarker:
        master, master_points = detect(landmarker, args.master)
        height, width = master.shape[:2]
        size = (width, height)
        for label, filename in MOUTH_TARGETS.items():
            image, points = detect(landmarker, args.candidates / filename)
            aligned, aligned_points = align(image, points, master_points, size)
            mask = mouth_mask(aligned_points, size)
            cv2.imwrite(str(args.output / f"xiaoa-viseme-{label}-v5.png"), composite(master, aligned, mask))

        for output_stem, (filename, kind) in FACE_TARGETS.items():
            image, points = detect(landmarker, args.candidates / filename)
            aligned, aligned_points = align(image, points, master_points, size)
            mask = eye_expression_mask(aligned_points, size, kind == "expression")
            cv2.imwrite(str(args.output / f"xiaoa-{output_stem}.png"), composite(master, aligned, mask))

    print(f"Built {len(MOUTH_TARGETS) + len(FACE_TARGETS)} offline assets in {args.output}")


if __name__ == "__main__":
    main()
