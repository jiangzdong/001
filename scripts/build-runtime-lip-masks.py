"""Build tight transparent MediaPipe lip masks for the runtime viseme set."""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np


OUTER_LIPS = (61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 185, 40, 39, 37, 0, 267, 269, 270, 409)
VISEMES = {
    "REST": "xiaoa-viseme-rest-v5.png",
    "A": "xiaoa-viseme-a-v5.png",
    "E": "xiaoa-viseme-e-v5.png",
    "O": "xiaoa-viseme-o-v10.png",
    "U": "xiaoa-viseme-u-v8.png",
    "MBP": "xiaoa-viseme-mbp-v5.png",
    "F": "xiaoa-viseme-f-v5.png",
    "L": "xiaoa-viseme-l-v5.png",
    "NDT": "xiaoa-viseme-ndt-v5.png",
    "S": "xiaoa-viseme-s-v5.png",
    "SH": "xiaoa-viseme-s-v5.png",
}


def landmarks(landmarker, path: Path) -> tuple[np.ndarray, tuple[int, int]]:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError(f"Unable to read {path}")
    result = landmarker.detect(mp.Image.create_from_file(str(path)))
    if not result.face_landmarks:
        raise RuntimeError(f"No face detected in {path}")
    height, width = image.shape[:2]
    points = np.asarray([(point.x * width, point.y * height) for point in result.face_landmarks[0]], dtype=np.float32)
    return points, (width, height)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--assets", required=True, type=Path)
    args = parser.parse_args()
    master_path = args.assets / "xiaoa-ditto-master-v1.0.3.png"
    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(args.model)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.25,
        min_face_presence_confidence=0.25,
    )
    with mp.tasks.vision.FaceLandmarker.create_from_options(options) as landmarker:
        master_points, size = landmarks(landmarker, master_path)
        width, height = size
        master_lips = np.round(master_points[list(OUTER_LIPS)]).astype(np.int32)
        for label, filename in VISEMES.items():
            target_points, target_size = landmarks(landmarker, args.assets / filename)
            if target_size != size:
                raise RuntimeError(f"Unexpected dimensions for {filename}: {target_size} != {size}")
            target_lips = np.round(target_points[list(OUTER_LIPS)]).astype(np.int32)
            alpha = np.zeros((height, width), dtype=np.uint8)
            cv2.fillPoly(alpha, [master_lips, target_lips], 255, lineType=cv2.LINE_AA)
            alpha = cv2.dilate(alpha, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)), iterations=1)
            alpha = cv2.GaussianBlur(alpha, (0, 0), 2.2)
            rgba = np.full((height, width, 4), 255, dtype=np.uint8)
            rgba[:, :, 3] = alpha
            output = args.assets / f"xiaoa-mouth-mask-{label.lower()}-v1.png"
            if not cv2.imwrite(str(output), rgba):
                raise RuntimeError(f"Unable to write {output}")
            print(f"{label}: {output.name}")


if __name__ == "__main__":
    main()
