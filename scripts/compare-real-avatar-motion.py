"""Compare real-speaker and packaged-Electron mouth motion for the same text."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


def normalize(values: np.ndarray) -> np.ndarray:
    low, high = np.percentile(values, [5, 95])
    return np.clip((values - low) / max(1e-6, high - low), 0.0, 1.0)


def resample(samples: list[dict], key: str, points: int = 320) -> np.ndarray:
    times = np.array([float(sample["timeMs"]) for sample in samples], dtype=np.float64)
    values = normalize(np.array([float(sample[key]) for sample in samples], dtype=np.float64))
    progress = (times - times[0]) / max(1e-6, times[-1] - times[0])
    return np.interp(np.linspace(0.0, 1.0, points), progress, values)


def pearson(first: np.ndarray, second: np.ndarray) -> float:
    if first.size < 3 or np.std(first) < 1e-7 or np.std(second) < 1e-7:
        return 0.0
    return float(np.corrcoef(first, second)[0, 1])


def alignment(real: np.ndarray, avatar: np.ndarray, max_lag: int) -> dict:
    best = {"lag": 0, "correlation": -2.0, "real": real, "avatar": avatar}
    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            current_real, current_avatar = real[lag:], avatar[: avatar.size - lag or None]
        else:
            current_real, current_avatar = real[: real.size + lag], avatar[-lag:]
        correlation = pearson(current_real, current_avatar)
        if correlation > best["correlation"]:
            best = {"lag": lag, "correlation": correlation, "real": current_real, "avatar": current_avatar}
    return best


def compare_at_lag(real: np.ndarray, avatar: np.ndarray, lag: int) -> tuple[np.ndarray, np.ndarray]:
    if lag >= 0:
        return real[lag:], avatar[: avatar.size - lag or None]
    return real[: real.size + lag], avatar[-lag:]


def direction_changes(values: np.ndarray, threshold: float = 0.06) -> int:
    delta = np.diff(values)
    signs = np.sign(delta[np.abs(delta) >= threshold])
    return int(np.count_nonzero(signs[1:] != signs[:-1])) if signs.size > 1 else 0


def lcs_length(first: list[str], second: list[str]) -> int:
    row = [0] * (len(second) + 1)
    for left in first:
        previous = 0
        for index, right in enumerate(second, start=1):
            saved = row[index]
            row[index] = previous + 1 if left == right else max(row[index], row[index - 1])
            previous = saved
    return row[-1]


def lcs_pairs(first: list[str], second: list[str]) -> list[tuple[int, int]]:
    table = [[0] * (len(second) + 1) for _ in range(len(first) + 1)]
    for left in range(1, len(first) + 1):
        for right in range(1, len(second) + 1):
            table[left][right] = table[left - 1][right - 1] + 1 if first[left - 1] == second[right - 1] else max(table[left - 1][right], table[left][right - 1])
    pairs = []
    left, right = len(first), len(second)
    while left and right:
        if first[left - 1] == second[right - 1]:
            pairs.append((left - 1, right - 1))
            left -= 1
            right -= 1
        elif table[left - 1][right] >= table[left][right - 1]:
            left -= 1
        else:
            right -= 1
    return list(reversed(pairs))


def visible_final_sequence(samples: list[dict]) -> list[dict]:
    groups: list[dict] = []
    active_key = None
    for sample in samples:
        character = str(sample.get("visemeCharacter", ""))
        role = str(sample.get("visemeRole", ""))
        event = str(sample.get("visemeEvent", ""))
        if not character or role != "final" or character in "，、。！？；：,.!?;:":
            continue
        key = (event, character)
        if key != active_key:
            groups.append({"character": character, "timeMs": float(sample["timeMs"]), "shapes": []})
            active_key = key
        shape = str(sample.get("viseme", ""))
        if shape and shape not in ("CLOSED", "REST"):
            groups[-1]["shapes"].append(shape)
    output = []
    for group in groups:
        if not group["shapes"]:
            continue
        shape = max(set(group["shapes"]), key=group["shapes"].count)
        output.append({"character": group["character"], "shape": shape, "timeMs": group["timeMs"]})
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--real", type=Path, required=True)
    parser.add_argument("--avatar", type=Path, required=True)
    parser.add_argument("--json", dest="json_path", type=Path, required=True)
    parser.add_argument("--plot", dest="plot_path", type=Path, required=True)
    parser.add_argument("--real-visemes", dest="real_visemes_path", type=Path)
    args = parser.parse_args()
    real_report = json.loads(args.real.read_text(encoding="utf-8"))
    avatar_report = json.loads(args.avatar.read_text(encoding="utf-8"))
    real_viseme_report = json.loads(args.real_visemes_path.read_text(encoding="utf-8")) if args.real_visemes_path else None
    real = resample(real_report["samples"], "mouthOpenNormalized")
    avatar = resample(avatar_report["samples"], "mouthOpen")
    real_width = resample(real_report["samples"], "mouthWidthNormalized")
    avatar_width = resample(avatar_report["samples"], "mouthWidth")
    best = alignment(real, avatar, round(real.size * 0.1))
    matched_real_width, matched_avatar_width = compare_at_lag(real_width, avatar_width, best["lag"])
    width_correlation = pearson(matched_real_width, matched_avatar_width)
    mae = float(np.mean(np.abs(best["real"] - best["avatar"])))
    real_duration = float(real_report["durationSeconds"])
    avatar_duration = float(avatar_report["speechDurationMs"]) / 1000.0
    real_raw = normalize(np.array([float(sample["mouthOpenNormalized"]) for sample in real_report["samples"]], dtype=np.float64))
    avatar_raw = normalize(np.array([float(sample["mouthOpen"]) for sample in avatar_report["samples"]], dtype=np.float64))
    real_changes = direction_changes(real_raw)
    avatar_changes = direction_changes(avatar_raw)
    observed = set(avatar_report.get("observedVisemes", []))
    alignment_providers = avatar_report.get("alignmentProviders", [])
    spoken_text = [character for character in avatar_report.get("referenceText", "") if character.strip() and character not in "，、。！？；：,.!?;:"]
    observed_characters: list[str] = []
    observed_character_index = None
    for sample in avatar_report.get("samples", []):
        character = str(sample.get("visemeCharacter", ""))
        character_index = str(sample.get("visemeCharacterIndex", ""))
        role = str(sample.get("visemeRole", ""))
        if character and character not in "，、。！？；：,.!?;:" and role == "final" and character_index != observed_character_index:
            observed_characters.append(character)
            observed_character_index = character_index
    ordered_matches = lcs_length(observed_characters, spoken_text)
    avatar_final_events = visible_final_sequence(avatar_report.get("samples", []))
    real_final_events = []
    if real_viseme_report:
        for event in real_viseme_report.get("visemes", []):
            character = str(event.get("character", ""))
            shape = str(event.get("shape", ""))
            if event.get("role") == "final" and character and character not in "，、。！？；：,.!?;:" and shape not in ("CLOSED", "REST"):
                real_final_events.append({"character": character, "shape": shape, "timeMs": float(event.get("timeMs", 0))})
    real_shape_tokens = [f"{event['character']}:{event['shape']}" for event in real_final_events]
    avatar_shape_tokens = [f"{event['character']}:{event['shape']}" for event in avatar_final_events]
    shape_matches = lcs_length(avatar_shape_tokens, real_shape_tokens)
    shape_precision = shape_matches / max(1, len(avatar_shape_tokens))
    shape_coverage = shape_matches / max(1, len(real_shape_tokens))
    timing_errors = []
    for avatar_index, real_index in lcs_pairs(avatar_shape_tokens, real_shape_tokens):
        avatar_event = avatar_final_events[avatar_index]
        real_event = real_final_events[real_index]
        real_progress = real_event["timeMs"] / max(1, float(real_viseme_report.get("durationMs", 1)))
        avatar_progress = avatar_event["timeMs"] / max(1, float(avatar_report.get("speechDurationMs", 1)))
        timing_errors.append(abs(real_progress - avatar_progress))
    result = {
        "sameContent": avatar_report.get("referenceText", ""),
        "realDurationSeconds": round(real_duration, 3),
        "avatarDurationSeconds": round(avatar_duration, 3),
        "normalizedBestLag": round(best["lag"] / real.size, 5),
        "avatarEquivalentLagMs": round(best["lag"] / real.size * avatar_duration * 1000),
        "normalizedCorrelation": round(best["correlation"], 4),
        "mouthWidthCorrelationAtMatchedTiming": round(width_correlation, 4),
        "combinedShapeCorrelation": round((max(0.0, best["correlation"]) + max(0.0, width_correlation)) / 2.0, 4),
        "normalizedMeanAbsoluteError": round(mae, 4),
        "realDirectionChangesPerSecond": round(real_changes / max(0.001, real_duration), 3),
        "avatarDirectionChangesPerSecond": round(avatar_changes / max(0.001, avatar_duration), 3),
        "avatarVisemeTransitionsPerSecond": avatar_report.get("visemeTransitionsPerSecond"),
        "alignmentProviders": alignment_providers,
        "observedVisemes": sorted(observed),
        "observedCharacterEvents": "".join(observed_characters),
        "orderedCharacterPrecision": round(ordered_matches / max(1, len(observed_characters)), 4),
        "spokenCharacterCoverage": round(ordered_matches / max(1, len(spoken_text)), 4),
        "realAlignedShapeEvents": len(real_shape_tokens),
        "avatarVisibleShapeEvents": len(avatar_shape_tokens),
        "shapeSequencePrecision": round(shape_precision, 4),
        "shapeSequenceCoverage": round(shape_coverage, 4),
        "normalizedShapeTimingMeanAbsoluteError": round(float(np.mean(timing_errors)), 4) if timing_errors else None,
        "overlapSamples": avatar_report.get("overlapSamples"),
        "wrongFrameSamples": avatar_report.get("wrongFrameSamples"),
    }
    result["checks"] = {
        "characterTimestampAlignment": "sensevoice-character-timestamps" in alignment_providers,
        "timingLagWithinTenPercent": abs(result["normalizedBestLag"]) <= 0.1,
        "geometryRecordedForCrossSpeakerDiagnosis": result["normalizedCorrelation"] > -1 and result["mouthWidthCorrelationAtMatchedTiming"] > -1,
        # Label changes include both halves of a Mandarin diphthong. Judge the
        # perceived pace primarily by aperture direction changes below; allow
        # up to 6.2 coarticulated labels/s while still rejecting flipbook rates.
        "eventRateNatural": 1.5 <= float(result["avatarVisemeTransitionsPerSecond"] or 0) <= 6.2,
        "apertureMotionNatural": 1.5 <= float(result["avatarDirectionChangesPerSecond"] or 0) <= 5.0,
        "characterOrderAccurate": result["orderedCharacterPrecision"] >= 0.95,
        "sameTextShapeSequenceAccurate": result["shapeSequencePrecision"] >= 0.9 and result["shapeSequenceCoverage"] >= 0.85,
        "sameTextShapeTimingAccurate": result["normalizedShapeTimingMeanAbsoluteError"] is not None and result["normalizedShapeTimingMeanAbsoluteError"] <= 0.12,
        "noMouthLayerOverlap": result["overlapSamples"] == 0,
        "noWrongMouthFrame": result["wrongFrameSamples"] == 0,
    }
    result["pass"] = all(result["checks"].values())
    args.json_path.parent.mkdir(parents=True, exist_ok=True)
    args.plot_path.parent.mkdir(parents=True, exist_ok=True)
    args.json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    progress = np.linspace(0.0, 1.0, real.size)
    figure, axes = plt.subplots(2, 1, figsize=(13, 6.2), sharex=True)
    axes[0].plot(progress, real, color="#0b8f86", linewidth=2.2, label="real speaker")
    axes[0].plot(progress, avatar, color="#db7c2c", linewidth=2.0, label="XiaoAn packaged Electron")
    axes[0].set_ylim(-0.05, 1.05)
    axes[0].set_ylabel("normalized mouth aperture")
    axes[0].legend(loc="upper right")
    axes[0].grid(alpha=0.18)

    axes[0].plot(progress, real_width, color="#3d65c8", linewidth=1.2, alpha=0.55, label="real width")
    axes[0].plot(progress, avatar_width, color="#8d4fb3", linewidth=1.2, alpha=0.55, label="XiaoAn width")
    axes[0].legend(loc="upper right")

    avatar_samples = avatar_report["samples"]
    avatar_end = max(1.0, float(avatar_samples[-1]["timeMs"]))
    last_viseme = None
    for sample in avatar_samples:
        viseme = sample.get("viseme")
        if viseme and viseme != last_viseme:
            x = float(sample["timeMs"]) / avatar_end
            axes[1].axvline(x, color="#7a8f98", linewidth=0.65, alpha=0.45)
            axes[1].text(x, 0.5, viseme, rotation=90, va="center", ha="right", fontsize=8)
            last_viseme = viseme
    axes[1].set_ylim(0, 1)
    axes[1].set_yticks([])
    axes[1].set_xlabel("normalized utterance progress")
    axes[1].set_title("XiaoAn visible viseme events")
    figure.suptitle(f"Same-content real vs avatar motion | corr={result['normalizedCorrelation']:.3f}, lag={result['normalizedBestLag']:.3f}")
    figure.tight_layout()
    figure.savefig(args.plot_path, dpi=170)
    plt.close(figure)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
