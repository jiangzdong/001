"""Rigidly align two face frames and compare mouth/chin physiology."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np


STABLE_LANDMARKS = (33, 133, 362, 263, 1, 168)
FACE_OVAL = (10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10)


def detect(landmarker, path: Path, background=None):
    raw = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if raw is None:
        raise RuntimeError(f"Unable to read {path}")
    if raw.ndim == 3 and raw.shape[2] == 4:
        bgr = raw[:, :, :3]
        if background is not None:
            if background.shape[:2] != bgr.shape[:2]:
                background = cv2.resize(background, (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_LANCZOS4)
            alpha = raw[:, :, 3:4].astype(np.float32) / 255.0
            bgr = np.clip(bgr.astype(np.float32) * alpha + background.astype(np.float32) * (1.0 - alpha), 0, 255).astype(np.uint8)
    else:
        bgr = raw
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    result = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
    if not result.face_landmarks:
        raise RuntimeError(f"No face detected in {path}")
    h, w = bgr.shape[:2]
    points = np.asarray([(item.x * w, item.y * h) for item in result.face_landmarks[0]], dtype=np.float32)
    return bgr, points


def transformed(points, matrix):
    return cv2.transform(points.reshape(1, -1, 2), matrix).reshape(-1, 2)


def distance(left, right):
    return float(np.linalg.norm(left - right))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--open", required=True, type=Path)
    parser.add_argument("--closed", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)

    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(args.model)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.25,
        min_face_presence_confidence=0.25,
        output_face_blendshapes=True,
    )
    with mp.tasks.vision.FaceLandmarker.create_from_options(options) as landmarker:
        closed_bgr, closed_points = detect(landmarker, args.closed)
        open_bgr, open_points = detect(landmarker, args.open, closed_bgr)

    matrix, _ = cv2.estimateAffinePartial2D(
        open_points[list(STABLE_LANDMARKS)],
        closed_points[list(STABLE_LANDMARKS)],
        method=cv2.LMEDS,
    )
    if matrix is None:
        raise RuntimeError("Unable to align faces")
    height, width = closed_bgr.shape[:2]
    open_aligned = cv2.warpAffine(open_bgr, matrix, (width, height), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)
    open_aligned_points = transformed(open_points, matrix)

    overlay = cv2.addWeighted(closed_bgr, 0.5, open_aligned, 0.5, 0)
    outline = overlay.copy()
    for points, color in ((closed_points, (80, 220, 80)), (open_aligned_points, (70, 70, 255))):
        poly = np.round(points[list(FACE_OVAL)]).astype(np.int32)
        cv2.polylines(outline, [poly], False, color, 1, cv2.LINE_AA)
        for index in (13, 14, 152):
            cv2.circle(outline, tuple(np.round(points[index]).astype(int)), 2, color, -1, cv2.LINE_AA)

    absolute = cv2.absdiff(closed_bgr, open_aligned)
    gray = cv2.cvtColor(absolute, cv2.COLOR_BGR2GRAY)
    heat = cv2.applyColorMap(np.clip(gray.astype(np.float32) * 4.0, 0, 255).astype(np.uint8), cv2.COLORMAP_TURBO)
    heat[gray < 4] = closed_bgr[gray < 4] // 3

    overlay_path = args.out_dir / "open-closed-overlay-50.png"
    outline_path = args.out_dir / "open-closed-landmark-overlay.png"
    heat_path = args.out_dir / "open-closed-difference-heatmap.png"
    aligned_path = args.out_dir / "open-aligned.png"
    cv2.imwrite(str(overlay_path), overlay)
    cv2.imwrite(str(outline_path), outline)
    cv2.imwrite(str(heat_path), heat)
    cv2.imwrite(str(aligned_path), open_aligned)

    eye_span_for_crop = max(distance(closed_points[33], closed_points[263]), 1e-6)
    center_x = float(closed_points[1][0])
    crop_left = int(max(0, center_x - eye_span_for_crop * 0.72))
    crop_right = int(min(width, center_x + eye_span_for_crop * 0.72))
    crop_top = int(max(0, closed_points[13][1] - eye_span_for_crop * 0.34))
    crop_bottom = int(min(height, closed_points[152][1] + eye_span_for_crop * 0.34))
    closeup_path = args.out_dir / "open-mouth-chin-closeup.png"
    cv2.imwrite(str(closeup_path), open_aligned[crop_top:crop_bottom, crop_left:crop_right])

    eye_span = max(distance(closed_points[33], closed_points[263]), 1e-6)
    closed_chin_height = distance(closed_points[14], closed_points[152])
    open_chin_height = distance(open_aligned_points[14], open_aligned_points[152])
    lower_lip_down = float(open_aligned_points[14][1] - closed_points[14][1])
    chin_bottom_down = float(open_aligned_points[152][1] - closed_points[152][1])
    report = {
        "alignment": "open frame aligned to closed frame using both eyes and nose bridge",
        "legend": {"closed": "green", "open": "red"},
        "measurements": {
            "lowerLipDownPx": round(lower_lip_down, 3),
            "chinBottomDownPx": round(chin_bottom_down, 3),
            "chinToLowerLipMotionRatio": round(chin_bottom_down / max(lower_lip_down, 1e-6), 3),
            "upperLipDownPx": round(float(open_aligned_points[13][1] - closed_points[13][1]), 3),
            "closedLowerLipToChinPx": round(closed_chin_height, 3),
            "openLowerLipToChinPx": round(open_chin_height, 3),
            "chinHeightChangePercent": round((open_chin_height / max(closed_chin_height, 1e-6) - 1) * 100, 2),
            "lowerLipDownOverEyeSpan": round(float(open_aligned_points[14][1] - closed_points[14][1]) / eye_span, 4),
            "chinBottomDownOverEyeSpan": round(float(open_aligned_points[152][1] - closed_points[152][1]) / eye_span, 4),
        },
        "landmarkPixels": {
            "closedUpperLip": [round(float(item), 3) for item in closed_points[13]],
            "closedLowerLip": [round(float(item), 3) for item in closed_points[14]],
            "closedChinBottom": [round(float(item), 3) for item in closed_points[152]],
            "openUpperLipAligned": [round(float(item), 3) for item in open_aligned_points[13]],
            "openLowerLipAligned": [round(float(item), 3) for item in open_aligned_points[14]],
            "openChinBottomAligned": [round(float(item), 3) for item in open_aligned_points[152]],
        },
        "artifacts": {
            "overlay": str(overlay_path),
            "landmarks": str(outline_path),
            "heatmap": str(heat_path),
            "alignedOpen": str(aligned_path),
            "closeup": str(closeup_path),
        },
    }
    report_path = args.out_dir / "open-closed-comparison.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
