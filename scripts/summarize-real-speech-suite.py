"""Aggregate the packaged-Electron same-content real-speaker comparisons."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--comparisons", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    cases = []
    for item in manifest["cases"]:
        report_path = args.comparisons / item["id"] / "comparison.json"
        report = json.loads(report_path.read_text(encoding="utf-8"))
        cases.append({
            "id": item["id"],
            "text": item["text"],
            "detectionRate": item["detectionRate"],
            "report": str(report_path.resolve()),
            "pass": bool(report.get("pass")),
            "normalizedCorrelation": report.get("normalizedCorrelation"),
            "mouthWidthCorrelationAtMatchedTiming": report.get("mouthWidthCorrelationAtMatchedTiming"),
            "combinedShapeCorrelation": report.get("combinedShapeCorrelation"),
            "avatarEquivalentLagMs": report.get("avatarEquivalentLagMs"),
            "orderedCharacterPrecision": report.get("orderedCharacterPrecision"),
            "spokenCharacterCoverage": report.get("spokenCharacterCoverage"),
            "shapeSequencePrecision": report.get("shapeSequencePrecision"),
            "shapeSequenceCoverage": report.get("shapeSequenceCoverage"),
            "normalizedShapeTimingMeanAbsoluteError": report.get("normalizedShapeTimingMeanAbsoluteError"),
            "avatarVisemeTransitionsPerSecond": report.get("avatarVisemeTransitionsPerSecond"),
            "avatarDirectionChangesPerSecond": report.get("avatarDirectionChangesPerSecond"),
            "checks": report.get("checks", {}),
        })

    def average(key: str) -> float:
        values = [float(item[key]) for item in cases if item.get(key) is not None]
        return round(sum(values) / max(1, len(values)), 4)

    summary = {
        "suite": manifest["name"],
        "sourcePage": manifest["sourcePage"],
        "license": manifest["license"],
        "caseCount": len(cases),
        "passedCases": sum(1 for item in cases if item["pass"]),
        "averageApertureCorrelation": average("normalizedCorrelation"),
        "averageWidthCorrelation": average("mouthWidthCorrelationAtMatchedTiming"),
        "averageCombinedShapeCorrelation": average("combinedShapeCorrelation"),
        "averageOrderedCharacterPrecision": average("orderedCharacterPrecision"),
        "averageSpokenCharacterCoverage": average("spokenCharacterCoverage"),
        "averageShapeSequencePrecision": average("shapeSequencePrecision"),
        "averageShapeSequenceCoverage": average("shapeSequenceCoverage"),
        "averageNormalizedShapeTimingMeanAbsoluteError": average("normalizedShapeTimingMeanAbsoluteError"),
        "pass": len(cases) >= 3 and all(item["pass"] for item in cases),
        "cases": cases,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if not summary["pass"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
