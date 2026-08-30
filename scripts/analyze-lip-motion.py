"""Extract normalized lip and eyelid motion from a real talking-head video.

This is a QA tool, not a runtime dependency.  It deliberately compares motion
curves rather than pixels because two different identities have different lip
geometry and cannot be judged with SSIM alone.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np


def distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a - b))


def robust_normalize(values: np.ndarray) -> np.ndarray:
    if values.size == 0:
        return values
    low, high = np.percentile(values, [5, 95])
    if high - low < 1e-6:
        return np.zeros_like(values)
    return np.clip((values - low) / (high - low), 0.0, 1.0)


def smooth(values: np.ndarray, window: int = 5) -> np.ndarray:
    if values.size < 3:
        return values.copy()
    size = max(3, int(window) | 1)
    kernel = np.ones(size, dtype=np.float64) / size
    padded = np.pad(values, (size // 2, size // 2), mode="edge")
    return np.convolve(padded, kernel, mode="valid")


def count_direction_changes(values: np.ndarray, threshold: float = 0.08) -> int:
    if values.size < 3:
        return 0
    delta = np.diff(values)
    significant = delta[np.abs(delta) >= threshold]
    if significant.size < 2:
        return 0
    signs = np.sign(significant)
    return int(np.count_nonzero(signs[1:] != signs[:-1]))


def extract(video_path: Path) -> dict:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 25.0)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    rows: list[dict] = []
    failed_frames = 0
    face_mesh = mp.solutions.face_mesh.FaceMesh(
        static_image_mode=False,
        max_num_faces=1,
        refine_landmarks=True,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    try:
        index = 0
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = face_mesh.process(rgb)
            if not result.multi_face_landmarks:
                failed_frames += 1
                index += 1
                continue
            points = np.array([[item.x, item.y] for item in result.multi_face_landmarks[0].landmark], dtype=np.float64)
            mouth_width = max(1e-6, distance(points[61], points[291]))
            inner_open = distance(points[13], points[14]) / mouth_width
            outer_open = distance(points[0], points[17]) / mouth_width
            face_width = max(1e-6, distance(points[234], points[454]))
            width_ratio = mouth_width / face_width
            left_eye = distance(points[159], points[145]) / max(1e-6, distance(points[33], points[133]))
            right_eye = distance(points[386], points[374]) / max(1e-6, distance(points[362], points[263]))
            rows.append({
                "frame": index,
                "timeMs": round(index / fps * 1000.0, 3),
                "innerOpen": inner_open,
                "outerOpen": outer_open,
                "mouthWidth": width_ratio,
                "eyeOpen": (left_eye + right_eye) / 2.0,
            })
            index += 1
    finally:
        face_mesh.close()
        capture.release()

    if len(rows) < 5:
        raise RuntimeError(f"Too few detected face frames: {len(rows)}")
    inner = np.array([row["innerOpen"] for row in rows], dtype=np.float64)
    outer = np.array([row["outerOpen"] for row in rows], dtype=np.float64)
    widths = np.array([row["mouthWidth"] for row in rows], dtype=np.float64)
    eyes = np.array([row["eyeOpen"] for row in rows], dtype=np.float64)
    open_curve = smooth(robust_normalize(inner * 0.72 + outer * 0.28), max(3, round(fps * 0.12)))
    width_curve = smooth(robust_normalize(widths), max(3, round(fps * 0.12)))
    eye_curve = smooth(robust_normalize(eyes), max(3, round(fps * 0.08)))
    for row, openness, width, eye in zip(rows, open_curve, width_curve, eye_curve):
        row["mouthOpenNormalized"] = round(float(openness), 5)
        row["mouthWidthNormalized"] = round(float(width), 5)
        row["eyeOpenNormalized"] = round(float(eye), 5)
        row["innerOpen"] = round(float(row["innerOpen"]), 6)
        row["outerOpen"] = round(float(row["outerOpen"]), 6)
        row["mouthWidth"] = round(float(row["mouthWidth"]), 6)
        row["eyeOpen"] = round(float(row["eyeOpen"]), 6)

    duration = rows[-1]["timeMs"] / 1000.0
    return {
        "source": str(video_path.resolve()),
        "fps": fps,
        "sourceFrameCount": frame_count,
        "detectedFrameCount": len(rows),
        "failedFrameCount": failed_frames,
        "detectionRate": round(len(rows) / max(1, len(rows) + failed_frames), 5),
        "durationSeconds": round(duration, 3),
        "mouthDirectionChangesPerSecond": round(count_direction_changes(open_curve) / max(0.001, duration), 3),
        "mouthOpenP05": round(float(np.percentile(inner, 5)), 6),
        "mouthOpenP95": round(float(np.percentile(inner, 95)), 6),
        "samples": rows,
    }


def plot_report(report: dict, output_path: Path) -> None:
    import matplotlib.pyplot as plt

    samples = report["samples"]
    time = np.array([row["timeMs"] for row in samples]) / 1000.0
    mouth = np.array([row["mouthOpenNormalized"] for row in samples])
    width = np.array([row["mouthWidthNormalized"] for row in samples])
    eye = np.array([row["eyeOpenNormalized"] for row in samples])
    figure, axes = plt.subplots(2, 1, figsize=(12, 5.6), sharex=True)
    axes[0].plot(time, mouth, label="real mouth aperture", color="#0c8f86", linewidth=2)
    axes[0].plot(time, width, label="real mouth width", color="#e28b33", linewidth=1.4, alpha=0.85)
    axes[0].set_ylim(-0.05, 1.05)
    axes[0].set_ylabel("normalized motion")
    axes[0].legend(loc="upper right")
    axes[0].grid(alpha=0.18)
    axes[1].plot(time, eye, label="real eye openness", color="#4f6fd7", linewidth=1.6)
    axes[1].set_ylim(-0.05, 1.05)
    axes[1].set_xlabel("seconds")
    axes[1].set_ylabel("normalized motion")
    axes[1].legend(loc="upper right")
    axes[1].grid(alpha=0.18)
    figure.suptitle("Real-speaker facial motion reference")
    figure.tight_layout()
    figure.savefig(output_path, dpi=160)
    plt.close(figure)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("--json", dest="json_path", type=Path, required=True)
    parser.add_argument("--plot", dest="plot_path", type=Path, required=True)
    args = parser.parse_args()
    report = extract(args.video)
    args.json_path.parent.mkdir(parents=True, exist_ok=True)
    args.plot_path.parent.mkdir(parents=True, exist_ok=True)
    args.json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    plot_report(report, args.plot_path)
    print(json.dumps({key: value for key, value in report.items() if key != "samples"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
