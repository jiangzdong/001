"""Export the local Ditto PyTorch checkpoints to TensorRT-ready ONNX.

This is a deterministic fallback for unreliable model-CDN downloads.  The
export signatures match the names and static shapes consumed by Ditto's model
wrappers and the official ONNX release (opset 17).
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

import onnx
import torch


def export_model(model, inputs, input_names, output_names, output_path: Path, force_mha_weights: bool = False) -> None:
    model.eval()
    temporary = output_path.with_suffix(output_path.suffix + ".exporting")
    original_mha_forward = torch.nn.MultiheadAttention.forward
    if force_mha_weights:
        # PyTorch 2.0 lowers need_weights=False to aten::scaled_dot_product_attention,
        # whose ONNX symbolic was added later.  The classic MHA path is numerically
        # equivalent for this eval-only export and is supported by opset 17.
        def export_mha_forward(self, *args, **kwargs):
            kwargs["need_weights"] = True
            return original_mha_forward(self, *args, **kwargs)

        torch.nn.MultiheadAttention.forward = export_mha_forward
    try:
        torch.onnx.export(
            model,
            inputs,
            str(temporary),
            input_names=input_names,
            output_names=output_names,
            opset_version=17,
            do_constant_folding=True,
        )
    finally:
        torch.nn.MultiheadAttention.forward = original_mha_forward
    exported = onnx.load(str(temporary))
    onnx.checker.check_model(exported)
    os.replace(temporary, output_path)
    print(f"exported {output_path.name} ({output_path.stat().st_size} bytes)", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint-root", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument(
        "--models",
        nargs="*",
        default=["appearance_extractor", "decoder", "lmdm_v0.4_hubert", "motion_extractor", "stitch_network"],
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    repository_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repository_root))
    from core.utils.load_model import load_model

    args.output_dir.mkdir(parents=True, exist_ok=True)
    torch.manual_seed(0)
    definitions = {
        "appearance_extractor": {
            "checkpoint": "appearance_extractor.pth",
            "module": "AppearanceFeatureExtractor",
            "inputs": torch.randn(1, 3, 256, 256),
            "input_names": ["image"],
            "output_names": ["pred"],
            "kwargs": {},
        },
        "decoder": {
            "checkpoint": "decoder.pth",
            "module": "SPADEDecoder",
            "inputs": torch.randn(1, 256, 64, 64),
            "input_names": ["feature"],
            "output_names": ["output"],
            "kwargs": {},
        },
        "lmdm_v0.4_hubert": {
            "checkpoint": "lmdm_v0.4_hubert.pth",
            "module": "LMDM",
            "inputs": (
                torch.randn(1, 80, 265),
                torch.randn(1, 265),
                torch.randn(1, 80, 1103),
                torch.full((1,), 999, dtype=torch.long),
            ),
            "input_names": ["x", "cond_frame", "cond", "time_cond"],
            "output_names": ["pred_noise", "x_start"],
            "kwargs": {"motion_feat_dim": 265, "audio_feat_dim": 1103, "seq_frames": 80},
        },
        "motion_extractor": {
            "checkpoint": "motion_extractor.pth",
            "module": "MotionExtractor",
            "inputs": torch.randn(1, 3, 256, 256),
            "input_names": ["image"],
            "output_names": ["pitch", "yaw", "roll", "t", "exp", "scale", "kp"],
            "kwargs": {},
        },
        "stitch_network": {
            "checkpoint": "stitch_network.pth",
            "module": "StitchingNetwork",
            "inputs": (torch.randn(1, 21, 3), torch.randn(1, 21, 3)),
            "input_names": ["kp_source", "kp_driving"],
            "output_names": ["out"],
            "kwargs": {},
        },
    }

    for model_name in args.models:
        if model_name not in definitions:
            raise ValueError(f"Unknown model: {model_name}")
        output_path = args.output_dir / f"{model_name}.onnx"
        if output_path.is_file() and output_path.stat().st_size > 0 and not args.force:
            print(f"skip existing {output_path.name}", flush=True)
            continue
        definition = definitions[model_name]
        checkpoint_path = args.checkpoint_root / "models" / definition["checkpoint"]
        model, model_type = load_model(
            str(checkpoint_path),
            device="cpu",
            module_name=definition["module"],
            **definition["kwargs"],
        )
        if model_type != "pytorch":
            raise RuntimeError(f"Expected PyTorch checkpoint, got {model_type}")
        export_model(
            model,
            definition["inputs"],
            definition["input_names"],
            definition["output_names"],
            output_path,
            force_mha_weights=model_name == "lmdm_v0.4_hubert",
        )
        del model


if __name__ == "__main__":
    main()
