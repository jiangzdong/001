"""Align generated facial targets to the master and produce a QA contact sheet."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np


STABLE = (33, 133, 362, 263, 1, 168)


def detect(landmarker, path: Path):
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Unable to read {path}")
    result = landmarker.detect(mp.Image.create_from_file(str(path)))
    if not result.face_landmarks:
        raise RuntimeError(f"No face detected in {path}")
    height, width = image.shape[:2]
    points = np.asarray(
        [(item.x * width, item.y * height) for item in result.face_landmarks[0]],
        dtype=np.float32,
    )
    return image, points


def transform(points, matrix):
    return cv2.transform(points.reshape(1, -1, 2), matrix).reshape(-1, 2)


def distance(left, right):
    return float(np.linalg.norm(left - right))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--master", required=True, type=Path)
    parser.add_argument("--candidates", required=True, type=Path)
    parser.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args()

    aligned_dir = args.out_dir / "aligned"
    aligned_dir.mkdir(parents=True, exist_ok=True)

    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(args.model)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.25,
        min_face_presence_confidence=0.25,
        output_face_blendshapes=True,
    )

    reports = []
    tiles = []
    with mp.tasks.vision.FaceLandmarker.create_from_options(options) as landmarker:
        master, master_points = detect(landmarker, args.master)
        height, width = master.shape[:2]
        eye_span = max(distance(master_points[33], master_points[263]), 1e-6)
        face_left = int(max(0, np.min(master_points[:, 0]) - eye_span * 0.20))
        face_right = int(min(width, np.max(master_points[:, 0]) + eye_span * 0.20))
        face_top = int(max(0, np.min(master_points[:, 1]) - eye_span * 0.28))
        face_bottom = int(min(height, np.max(master_points[:, 1]) + eye_span * 0.22))

        for path in sorted(args.candidates.glob("*.png")):
            try:
                candidate, candidate_points = detect(landmarker, path)
                matrix, _ = cv2.estimateAffinePartial2D(
                    candidate_points[list(STABLE)],
                    master_points[list(STABLE)],
                    method=cv2.LMEDS,
                )
                if matrix is None:
                    raise RuntimeError("Unable to estimate alignment")
                aligned = cv2.warpAffine(
                    candidate,
                    matrix,
                    (width, height),
                    flags=cv2.INTER_LANCZOS4,
                    borderMode=cv2.BORDER_REFLECT,
                )
                points = transform(candidate_points, matrix)
                residual = float(
                    np.mean(np.linalg.norm(points[list(STABLE)] - master_points[list(STABLE)], axis=1))
                    / eye_span
                )
                output_path = aligned_dir / path.name
                cv2.imwrite(str(output_path), aligned)

                metrics = {
                    "stableResidualOverEyeSpan": round(residual, 5),
                    "mouthWidthChangePercent": round(
                        (distance(points[61], points[291]) / max(distance(master_points[61], master_points[291]), 1e-6) - 1)
                        * 100,
                        2,
                    ),
                    "mouthApertureChangeOverEyeSpan": round(
                        (distance(points[13], points[14]) - distance(master_points[13], master_points[14])) / eye_span,
                        4,
                    ),
                    "lowerLipDownOverEyeSpan": round(float(points[14][1] - master_points[14][1]) / eye_span, 4),
                    "chinDownOverEyeSpan": round(float(points[152][1] - master_points[152][1]) / eye_span, 4),
                    "leftEyeOpennessChangeOverEyeSpan": round(
                        (distance(points[159], points[145]) - distance(master_points[159], master_points[145])) / eye_span,
                        4,
                    ),
                    "rightEyeOpennessChangeOverEyeSpan": round(
                        (distance(points[386], points[374]) - distance(master_points[386], master_points[374])) / eye_span,
                        4,
                    ),
                }
                reports.append({"file": path.name, "status": "measured", **metrics})

                crop = aligned[face_top:face_bottom, face_left:face_right].copy()
                crop = cv2.resize(crop, (320, 400), interpolation=cv2.INTER_AREA)
                cv2.rectangle(crop, (0, 0), (319, 45), (16, 24, 32), -1)
                label = path.stem.replace("xiaoa-", "")[:42]
                cv2.putText(crop, label, (9, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.43, (245, 245, 245), 1, cv2.LINE_AA)
                tiles.append(crop)
            except Exception as error:
                reports.append({"file": path.name, "status": "error", "error": str(error)})

    report_path = args.out_dir / "mediapipe-audit.json"
    report_path.write_text(json.dumps(reports, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if tiles:
        columns = 4
        rows = []
        blank = np.full_like(tiles[0], 242)
        for index in range(0, len(tiles), columns):
            row = tiles[index : index + columns]
            row.extend([blank] * (columns - len(row)))
            rows.append(np.hstack(row))
        sheet = np.vstack(rows)
        cv2.imwrite(str(args.out_dir / "generated-face-contact-sheet.png"), sheet)

    print(json.dumps({"count": len(reports), "report": str(report_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
