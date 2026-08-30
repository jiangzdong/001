from __future__ import annotations

import argparse
import os
from pathlib import Path

import onnx


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    model = onnx.load(str(args.source))
    rewritten = 0
    for node in model.graph.node:
        if node.op_type != "Einsum":
            continue
        equation = next((attribute for attribute in node.attribute if attribute.name == "equation"), None)
        if equation is None:
            continue
        normalized = equation.s.decode("utf-8").replace(" ", "")
        if normalized == "...,f->...f":
            equation.s = b"i,j->ij"
            rewritten += 1

    if rewritten == 0:
        raise RuntimeError("No TensorRT-incompatible rotary Einsum equations were found")
    onnx.checker.check_model(model)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".building")
    onnx.save(model, str(temporary))
    os.replace(temporary, args.output)
    print(f"rewrote {rewritten} rotary Einsum nodes: {args.output}")


if __name__ == "__main__":
    main()
