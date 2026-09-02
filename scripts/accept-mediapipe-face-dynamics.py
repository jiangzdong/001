"""Offline MediaPipe geometry acceptance for Xiao An dynamic face frames."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import mediapipe as mp


def distance(left, right):
    return math.hypot(left.x - right.x, left.y - right.y)


def analyze(landmarker, image_path: Path):
    image = mp.Image.create_from_file(str(image_path))
    result = landmarker.detect(image)
    if not result.face_landmarks:
        return {"detected": False, "path": str(image_path)}
    landmarks = result.face_landmarks[0]
    scores = {
        category.category_name: round(float(category.score), 6)
        for category in (result.face_blendshapes[0] if result.face_blendshapes else [])
    }
    face_height = max(distance(landmarks[10], landmarks[152]), 1e-6)
    mouth_width = max(distance(landmarks[61], landmarks[291]), 1e-6)
    eye_span = max(distance(landmarks[33], landmarks[263]), 1e-6)
    return {
        "detected": True,
        "path": str(image_path),
        "blendshapes": scores,
        "geometry": {
            "upperLipX": round(landmarks[13].x, 6),
            "upperLipY": round(landmarks[13].y, 6),
            "lowerLipX": round(landmarks[14].x, 6),
            "lowerLipY": round(landmarks[14].y, 6),
            "chinX": round(landmarks[152].x, 6),
            "chinY": round(landmarks[152].y, 6),
            "mouthGapOverFace": round(distance(landmarks[13], landmarks[14]) / face_height, 6),
            "mouthWidthOverFace": round(mouth_width / face_height, 6),
            "lowerLipChinOverFace": round(distance(landmarks[14], landmarks[152]) / face_height, 6),
            "lowerLipChinOverEyeSpan": round(distance(landmarks[14], landmarks[152]) / eye_span, 6),
            "leftEyeAperture": round(distance(landmarks[159], landmarks[145]) / mouth_width, 6),
            "rightEyeAperture": round(distance(landmarks[386], landmarks[374]) / mouth_width, 6),
        },
    }


def score(frame, name):
    return float(frame.get("blendshapes", {}).get(name, 0))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--idle", required=True, type=Path)
    for name in ("a", "e", "o", "u", "blink-entry", "blink-closed", "blink-exit"):
        parser.add_argument(f"--{name}", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    options = mp.tasks.vision.FaceLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=str(args.model)),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_faces=1,
        min_face_detection_confidence=0.35,
        min_face_presence_confidence=0.35,
        output_face_blendshapes=True,
    )
    paths = {
        "idle": args.idle,
        "A": args.a,
        "E": args.e,
        "O": args.o,
        "U": args.u,
        "blinkEntry": args.blink_entry,
        "blinkClosed": args.blink_closed,
        "blinkExit": args.blink_exit,
    }
    with mp.tasks.vision.FaceLandmarker.create_from_options(options) as landmarker:
        frames = {name: analyze(landmarker, path) for name, path in paths.items()}

    failures = []
    missing = [name for name, frame in frames.items() if not frame.get("detected")]
    if missing:
        failures.append(f"face-not-detected:{','.join(missing)}")
    else:
        mouth_frames = [frames[name] for name in ("A", "E", "O", "U")]
        idle_gap = frames["idle"]["geometry"]["mouthGapOverFace"]
        max_gap = max(frame["geometry"]["mouthGapOverFace"] for frame in mouth_frames)
        if max_gap - idle_gap < 0.018:
            failures.append(f"mouth-aperture-range-too-small:{max_gap - idle_gap:.4f}")

        jaw_range = max(score(frame, "jawOpen") for frame in mouth_frames) - score(frames["idle"], "jawOpen")
        if jaw_range < 0.08:
            failures.append(f"jaw-open-range-too-small:{jaw_range:.4f}")

        # A jaw drop should translate the lower lip and menton without visibly
        # collapsing or stretching the chin itself. Judge the widest-aperture
        # runtime frame against idle. Use the stable eye span for scale
        # normalization: forehead-to-chin height includes the moving menton and
        # therefore changes its own denominator during the action.
        widest = max(mouth_frames, key=lambda frame: frame["geometry"]["mouthGapOverFace"])
        idle_chin_height = frames["idle"]["geometry"]["lowerLipChinOverEyeSpan"]
        open_chin_height = widest["geometry"]["lowerLipChinOverEyeSpan"]
        chin_height_change = abs(open_chin_height / max(idle_chin_height, 1e-6) - 1)
        if chin_height_change > 0.1:
            failures.append(f"chin-height-distortion:{chin_height_change:.4f}")

        pucker_peak = max(score(frames[name], "mouthPucker") for name in ("O", "U"))
        spread_peak = max(
            (score(frames[name], "mouthStretchLeft") + score(frames[name], "mouthStretchRight")) / 2
            for name in ("A", "E")
        )
        spread_width = max(frames[name]["geometry"]["mouthWidthOverFace"] for name in ("A", "E"))
        rounded_width = max(frames[name]["geometry"]["mouthWidthOverFace"] for name in ("O", "U"))
        spread_width_delta = spread_width - rounded_width
        if pucker_peak < 0.12:
            failures.append(f"rounded-viseme-pucker-too-small:{pucker_peak:.4f}")
        if pucker_peak > 0.9:
            failures.append(f"rounded-viseme-pucker-too-large:{pucker_peak:.4f}")
        # MediaPipe can classify a photorealistic E viseme with a low
        # mouthStretch score even when its landmark width clearly separates
        # from the rounded O/U pair. Accept either signal, but never neither.
        if spread_peak < 0.08 and spread_width_delta < 0.07:
            failures.append(
                f"spread-viseme-too-small:score={spread_peak:.4f},width={spread_width_delta:.4f}"
            )

        bilateral = []
        for name in ("A", "E", "O", "U"):
            frame = frames[name]
            bilateral.extend([
                abs(score(frame, "mouthLowerDownLeft") - score(frame, "mouthLowerDownRight")),
                abs(score(frame, "mouthStretchLeft") - score(frame, "mouthStretchRight")),
            ])
        if max(bilateral) > 0.2:
            failures.append(f"mouth-bilateral-asymmetry:{max(bilateral):.4f}")

        # The capture loop can label the entry frame closer to the true eyelid
        # minimum than the nominal closed frame. Judge the most closed sampled
        # frame by landmark aperture and retain blendshapes as supporting data.
        blink_candidates = [frames["blinkEntry"], frames["blinkClosed"]]
        closed = min(
            blink_candidates,
            key=lambda frame: max(
                frame["geometry"]["leftEyeAperture"],
                frame["geometry"]["rightEyeAperture"],
            ),
        )
        idle_aperture = min(
            frames["idle"]["geometry"]["leftEyeAperture"],
            frames["idle"]["geometry"]["rightEyeAperture"],
        )
        closed_aperture = max(
            closed["geometry"]["leftEyeAperture"],
            closed["geometry"]["rightEyeAperture"],
        )
        blink_delta = abs(score(closed, "eyeBlinkLeft") - score(closed, "eyeBlinkRight"))
        if (
            min(score(closed, "eyeBlinkLeft"), score(closed, "eyeBlinkRight")) < 0.5
            and closed_aperture > idle_aperture * 0.75
        ):
            failures.append("closed-blink-not-detected")
        if blink_delta > 0.2:
            failures.append(f"blink-bilateral-asymmetry:{blink_delta:.4f}")

    report = {
        "suite": "mediapipe-face-landmarker-dynamic-geometry",
        "model": str(args.model),
        "frames": frames,
        "failures": failures,
        "result": "PASS" if not failures else "FAIL",
        "boundary": "MediaPipe validates landmark and blendshape geometry; visual seams, dots, identity and audio sync require separate dynamic-frame review.",
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"result": report["result"], "failures": failures, "report": str(args.out), "frames": frames}, ensure_ascii=False, indent=2))
    raise SystemExit(0 if not failures else 1)


if __name__ == "__main__":
    main()
