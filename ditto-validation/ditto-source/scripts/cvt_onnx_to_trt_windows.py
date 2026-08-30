"""Build Ditto TensorRT 8.6 engines for the local Windows/Turing GPU.

The upstream converter assumes Linux and always tries to load a GridSample3D
`.so` for warp_network.  This converter deliberately excludes warp_network so
the Windows runtime can use a safe PyTorch fallback for that one submodel.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import time

import torch


MODEL_PRECISION = {
    # The GTX 1660 Ti (TU116) has no Tensor Cores.  Ditto's A100-oriented FP16
    # defaults produced unacceptable feature/keypoint errors on this GPU, so
    # the Turing hybrid uses FP32 throughout.
    "appearance_extractor": "fp32",
    "decoder": "fp32",
    "lmdm_v0.4_hubert": "fp32",
    "motion_extractor": "fp32",
}

MODEL_ONNX_NAMES = {
    "lmdm_v0.4_hubert": "lmdm_v0.4_hubert_trt.onnx",
}


def configure_windows_dll_search(trt_root: Path) -> list[object]:
    handles: list[object] = []
    if os.name != "nt" or not hasattr(os, "add_dll_directory"):
        return handles
    directories = [(trt_root / "lib").resolve(), (Path(torch.__file__).parent / "lib").resolve()]
    os.environ["PATH"] = os.pathsep.join([*(str(directory) for directory in directories), os.environ.get("PATH", "")])
    for directory in directories:
        if directory.is_dir():
            handles.append(os.add_dll_directory(str(directory)))
    return handles


def parse_errors(parser) -> str:
    return "\n".join(str(parser.get_error(index)) for index in range(parser.num_errors))


def build_engine(
    trt,
    onnx_path: Path,
    engine_path: Path,
    precision: str,
    workspace_gib: float,
    optimization_level: int,
) -> None:
    logger = trt.Logger(trt.Logger.INFO)
    builder = trt.Builder(logger)
    network = builder.create_network(1 << int(trt.NetworkDefinitionCreationFlag.EXPLICIT_BATCH))
    parser = trt.OnnxParser(network, logger)
    if not parser.parse(onnx_path.read_bytes()):
        raise RuntimeError(f"TensorRT could not parse {onnx_path}:\n{parse_errors(parser)}")

    dynamic_inputs = []
    for index in range(network.num_inputs):
        tensor = network.get_input(index)
        if any(dimension < 0 for dimension in tensor.shape):
            dynamic_inputs.append(f"{tensor.name}={tuple(tensor.shape)}")
    if dynamic_inputs:
        raise RuntimeError(
            f"Dynamic input profiles are not defined for {onnx_path.name}: {', '.join(dynamic_inputs)}"
        )

    config = builder.create_builder_config()
    config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, int(workspace_gib * 1024**3))
    if hasattr(config, "builder_optimization_level"):
        config.builder_optimization_level = optimization_level
    if precision == "fp16":
        config.set_flag(trt.BuilderFlag.FP16)
        if hasattr(trt.BuilderFlag, "PREFER_PRECISION_CONSTRAINTS"):
            config.set_flag(trt.BuilderFlag.PREFER_PRECISION_CONSTRAINTS)

    started = time.perf_counter()
    serialized = builder.build_serialized_network(network, config)
    if serialized is None:
        raise RuntimeError(f"TensorRT engine build failed for {onnx_path}")

    temporary_path = engine_path.with_suffix(engine_path.suffix + ".building")
    temporary_path.write_bytes(serialized)
    os.replace(temporary_path, engine_path)
    elapsed = time.perf_counter() - started
    print(f"built {engine_path.name} ({engine_path.stat().st_size} bytes) in {elapsed:.1f}s", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--onnx-dir", type=Path, required=True)
    parser.add_argument("--trt-dir", type=Path, required=True)
    parser.add_argument("--trt-root", type=Path, required=True)
    parser.add_argument("--models", nargs="*", default=list(MODEL_PRECISION))
    parser.add_argument("--workspace-gib", type=float, default=2.0)
    parser.add_argument(
        "--optimization-level",
        type=int,
        choices=range(0, 6),
        default=3,
        help="TensorRT builder optimization level. Level 3 avoids a TRT 8.6 rank assertion seen at level 5 on Turing.",
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    args.trt_dir.mkdir(parents=True, exist_ok=True)
    dll_handles = configure_windows_dll_search(args.trt_root)
    import tensorrt as trt

    print(
        f"TensorRT={trt.__version__} GPU={torch.cuda.get_device_name(0)} "
        f"capability={torch.cuda.get_device_capability(0)}",
        flush=True,
    )
    for model_name in args.models:
        if model_name not in MODEL_PRECISION:
            raise ValueError(f"Unsupported Windows hybrid model: {model_name}")
        precision = MODEL_PRECISION[model_name]
        onnx_path = args.onnx_dir / MODEL_ONNX_NAMES.get(model_name, f"{model_name}.onnx")
        engine_path = args.trt_dir / f"{model_name}_{precision}.engine"
        if not onnx_path.is_file():
            raise FileNotFoundError(onnx_path)
        if engine_path.is_file() and engine_path.stat().st_size > 0 and not args.force:
            print(f"skip complete engine {engine_path.name}", flush=True)
            continue
        build_engine(
            trt,
            onnx_path,
            engine_path,
            precision,
            args.workspace_gib,
            args.optimization_level,
        )

    # Retain Windows DLL directory handles until every build has completed.
    del dll_handles


if __name__ == "__main__":
    main()
