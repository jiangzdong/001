"""Compare a locally-built Ditto TensorRT engine with its ONNX source."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import numpy as np
import onnxruntime as ort


MODEL_INPUTS = {
    "appearance_extractor": {
        "image": ((1, 3, 256, 256), "normal"),
    },
    "decoder": {
        "feature": ((1, 256, 64, 64), "normal"),
    },
    "lmdm_v0.4_hubert": {
        "x": ((1, 80, 265), "normal"),
        "cond_frame": ((1, 265), "normal"),
        "cond": ((1, 80, 1103), "normal"),
        "time_cond": ((1,), "time"),
    },
    "motion_extractor": {
        "image": ((1, 3, 256, 256), "normal"),
    },
}


def make_inputs(model_name: str) -> dict[str, np.ndarray]:
    rng = np.random.default_rng(20260828)
    inputs: dict[str, np.ndarray] = {}
    for name, (shape, kind) in MODEL_INPUTS[model_name].items():
        if kind == "time":
            inputs[name] = np.array([500], dtype=np.int64)
        else:
            inputs[name] = rng.standard_normal(shape).astype(np.float32)
    return inputs


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=MODEL_INPUTS, required=True)
    parser.add_argument("--onnx", type=Path, required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--max-abs", type=float, default=1e-3)
    parser.add_argument("--mean-abs", type=float, default=1e-4)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo_root))
    from core.utils.tensorrt_utils import TRTWrapper

    inputs = make_inputs(args.model)
    session = ort.InferenceSession(str(args.onnx), providers=["CPUExecutionProvider"])
    reference_values = session.run(None, inputs)
    reference = dict(zip((output.name for output in session.get_outputs()), reference_values))

    engine = TRTWrapper(str(args.engine))
    engine.setup(inputs)
    engine.infer()

    failed = False
    for name, expected in reference.items():
        actual = engine.buffer[name][0]
        finite = bool(np.isfinite(actual).all())
        difference = np.abs(actual.astype(np.float32) - expected.astype(np.float32))
        maximum = float(difference.max())
        mean = float(difference.mean())
        passed = finite and maximum <= args.max_abs and mean <= args.mean_abs
        failed = failed or not passed
        print(
            f"{name}: shape={actual.shape} finite={finite} "
            f"max_abs={maximum:.9g} mean_abs={mean:.9g} passed={passed}"
        )

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
