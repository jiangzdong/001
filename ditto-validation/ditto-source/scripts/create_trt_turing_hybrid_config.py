from __future__ import annotations

import argparse
import pickle
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    with args.source.open("rb") as source_file:
        cfg = pickle.load(source_file)

    base = cfg["base_cfg"]
    pytorch_aux = "../ditto_pytorch/aux_models"
    pytorch_models = "../ditto_pytorch/models"
    base["insightface_det_cfg"]["model_path"] = f"{pytorch_aux}/det_10g.onnx"
    base["landmark106_cfg"]["model_path"] = f"{pytorch_aux}/2d106det.onnx"
    base["landmark203_cfg"]["model_path"] = f"{pytorch_aux}/landmark203.onnx"
    base["landmark478_cfg"]["task_path"] = f"{pytorch_aux}/face_landmarker.task"
    base["appearance_extractor_cfg"]["model_path"] = "appearance_extractor_fp32.engine"
    base["motion_extractor_cfg"]["model_path"] = "motion_extractor_fp32.engine"
    base["stitch_network_cfg"]["model_path"] = f"{pytorch_models}/stitch_network.pth"
    base["warp_network_cfg"]["model_path"] = f"{pytorch_models}/warp_network.pth"
    base["decoder_cfg"]["model_path"] = "decoder_fp32.engine"
    base["hubert_cfg"]["model_path"] = f"{pytorch_aux}/hubert_streaming_fix_kv.onnx"
    cfg["audio2motion_cfg"]["model_path"] = "lmdm_v0.4_hubert_fp32.engine"

    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".building")
    with temporary.open("wb") as output_file:
        pickle.dump(cfg, output_file, protocol=pickle.HIGHEST_PROTOCOL)
    temporary.replace(args.output)
    print(args.output)


if __name__ == "__main__":
    main()
