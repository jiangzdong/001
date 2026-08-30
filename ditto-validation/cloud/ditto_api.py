from __future__ import annotations

import hashlib
import io
import json
import math
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import wave
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

VALIDATION_ROOT = Path(__file__).resolve().parents[1]
DITTO_ROOT = Path(os.environ.get("DITTO_ROOT", VALIDATION_ROOT / "ditto-source")).resolve()
CHECKPOINT_ROOT = DITTO_ROOT / "checkpoints"
DEFAULT_PYTORCH_ROOT = CHECKPOINT_ROOT / "ditto_pytorch"
DEFAULT_TRT_ROOT = CHECKPOINT_ROOT / "ditto_trt_Ampere_Plus"
MODEL_ROOT = Path(os.environ.get(
    "DITTO_MODEL_ROOT",
    DEFAULT_PYTORCH_ROOT if DEFAULT_PYTORCH_ROOT.exists() else DEFAULT_TRT_ROOT,
)).resolve()
DEFAULT_PYTORCH_CONFIG = CHECKPOINT_ROOT / "ditto_cfg/v0.4_hubert_cfg_pytorch.pkl"
DEFAULT_TRT_CONFIG = CHECKPOINT_ROOT / "ditto_cfg/v0.4_hubert_cfg_trt.pkl"
CONFIG_PATH = Path(os.environ.get(
    "DITTO_CONFIG",
    DEFAULT_PYTORCH_CONFIG if MODEL_ROOT.name == "ditto_pytorch" else DEFAULT_TRT_CONFIG,
)).resolve()
SOURCE_PATH = Path(os.environ.get("DITTO_SOURCE", VALIDATION_ROOT / "xiaoa-source.png")).resolve()
DEFAULT_CACHE_ROOT = Path(os.environ.get("LOCALAPPDATA", VALIDATION_ROOT)) / "XiaoAnHealthKiosk/ditto-cache"
CACHE_ROOT = Path(os.environ.get("DITTO_CACHE", DEFAULT_CACHE_ROOT)).resolve()
MAX_AUDIO_BYTES = 16 * 1024 * 1024
SAMPLING_TIMESTEPS = max(4, min(50, int(os.environ.get("DITTO_SAMPLING_STEPS", "12"))))
MAX_FRAME_SIZE = max(640, min(1920, int(os.environ.get("DITTO_MAX_SIZE", "1280"))))
PREWARM_ENABLED = os.environ.get("DITTO_PREWARM", "1").strip().lower() not in {"0", "false", "off"}
PYTORCH_RUNTIME_FILES = (
    "aux_models/2d106det.onnx",
    "aux_models/det_10g.onnx",
    "aux_models/face_landmarker.task",
    "aux_models/hubert_streaming_fix_kv.onnx",
    "aux_models/landmark203.onnx",
    "models/appearance_extractor.pth",
    "models/decoder.pth",
    "models/lmdm_v0.4_hubert.pth",
    "models/motion_extractor.pth",
    "models/stitch_network.pth",
    "models/warp_network.pth",
)

app = FastAPI(title="XiaoAn Ditto Renderer", version="1.3.0")
render_lock = threading.Lock()
sdk = None
load_error = None
started_at = time.time()


def validate_runtime() -> list[str]:
    missing = [str(path) for path in (DITTO_ROOT, MODEL_ROOT, CONFIG_PATH, SOURCE_PATH) if not path.exists()]
    if MODEL_ROOT.name == "ditto_pytorch" and MODEL_ROOT.exists():
        missing.extend(str(MODEL_ROOT / relative) for relative in PYTORCH_RUNTIME_FILES if not (MODEL_ROOT / relative).exists())
    return missing


def load_sdk():
    global sdk, load_error
    if sdk is not None:
        return sdk
    missing = validate_runtime()
    if missing:
        raise RuntimeError(f"Ditto runtime is incomplete: {', '.join(missing)}")
    if str(DITTO_ROOT) not in sys.path:
        sys.path.insert(0, str(DITTO_ROOT))
    os.chdir(DITTO_ROOT)
    from stream_pipeline_online import StreamSDK

    sdk = StreamSDK(str(CONFIG_PATH), str(MODEL_ROOT))
    load_error = None
    return sdk


def prewarm_sdk() -> None:
    if not PREWARM_ENABLED:
        return
    import numpy as np

    engine = load_sdk()
    chunksize = (3, 5, 2)
    split_len = int(sum(chunksize) * 0.04 * 16000) + 80
    started = time.perf_counter()
    print("[startup] prewarming fixed avatar and CUDA/TensorRT kernels", flush=True)
    engine.setup(
        str(SOURCE_PATH),
        None,
        online_mode=True,
        emit_initial_context=True,
        frame_callback=lambda _frame: None,
        sampling_timesteps=SAMPLING_TIMESTEPS,
        max_size=MAX_FRAME_SIZE,
    )
    engine.setup_Nd(N_d=5, fade_in=1, fade_out=1)
    engine.run_chunk(np.zeros((split_len,), dtype=np.float32), chunksize)
    engine.close()
    print(f"[startup] prewarm complete in {time.perf_counter() - started:.2f}s", flush=True)


def provider_name() -> str:
    explicit_provider = os.environ.get("DITTO_PROVIDER", "").strip()
    if explicit_provider:
        return explicit_provider
    return "Ditto PyTorch CUDA" if MODEL_ROOT.name == "ditto_pytorch" else "Ditto TensorRT"


def gpu_summary() -> str:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip()
    except Exception:
        return "unavailable"


@app.on_event("startup")
def startup() -> None:
    global load_error
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        load_sdk()
        prewarm_sdk()
    except Exception as error:
        load_error = str(error)


@app.get("/health")
def health() -> dict:
    missing = validate_runtime()
    return {
        "ok": not missing and sdk is not None and load_error is None,
        "provider": provider_name(),
        "gpu": gpu_summary(),
        "busy": render_lock.locked(),
        "uptimeSeconds": round(time.time() - started_at),
        "missing": missing,
        "loadError": load_error,
        "modelRoot": str(MODEL_ROOT),
        "configPath": str(CONFIG_PATH),
        "sourcePath": str(SOURCE_PATH),
        "ffmpegAvailable": shutil.which("ffmpeg") is not None,
        "renderMode": "multipart-jpeg-frames",
        "frameStreaming": True,
        "audioStreaming": False,
        "supportsCancellation": True,
        "cacheEnabled": True,
        "samplingTimesteps": SAMPLING_TIMESTEPS,
        "maxFrameSize": MAX_FRAME_SIZE,
        "prewarmed": PREWARM_ENABLED,
    }


@app.get("/v1/capabilities")
def capabilities() -> dict:
    return {
        "renderMode": "multipart-jpeg-frames",
        "frameStreaming": True,
        "audioStreaming": False,
        "supportsCancellation": True,
        "transport": "http-post-multipart-jpeg",
        "frameRate": 25,
        "samplingTimesteps": SAMPLING_TIMESTEPS,
        "maxFrameSize": MAX_FRAME_SIZE,
        "fallback": "local-tts-viseme",
    }


def validate_audio(audio: bytes, request: Request) -> str:
    if len(audio) < 128:
        raise HTTPException(status_code=400, detail="Audio payload is empty")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio payload is too large")
    if audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
        raise HTTPException(status_code=415, detail="PCM WAV audio is required")
    supplied_key = request.headers.get("x-render-key", "").lower()
    if supplied_key and (len(supplied_key) != 64 or any(char not in "0123456789abcdef" for char in supplied_key)):
        raise HTTPException(status_code=400, detail="X-Render-Key must be a SHA-256 hex digest")
    return supplied_key or hashlib.sha256(audio).hexdigest()


def multipart_part(boundary: str, content_type: str, payload: bytes, headers: dict[str, str] | None = None) -> bytes:
    lines = [f"--{boundary}", f"Content-Type: {content_type}", f"Content-Length: {len(payload)}"]
    lines.extend(f"{key}: {value}" for key, value in (headers or {}).items())
    return ("\r\n".join(lines) + "\r\n\r\n").encode("ascii") + payload + b"\r\n"


@app.post("/v1/render/frames")
async def render_frames(request: Request):
    audio = await request.body()
    identity = validate_audio(audio, request)
    boundary = "xiaoan-frame"
    frame_queue: queue.Queue = queue.Queue(maxsize=24)
    cancel_event = threading.Event()
    done_event = threading.Event()
    # A previous canceled request can still be releasing its WAV on Windows.
    # Keep each request's temporary input distinct to avoid a write/unlink race.
    audio_path = CACHE_ROOT / f"{identity}.{time.time_ns()}.frames.wav"
    audio_path.write_bytes(audio)
    state = {
        "complete": False,
        "error": None,
        "frameCount": 0,
        "expectedFrameCount": 0,
        "featureChunkCount": 0,
        "inputSampleCount": 0,
        "queueSeconds": 0.0,
        "renderSeconds": 0.0,
    }

    def producer() -> None:
        queued_at = time.perf_counter()
        try:
            with render_lock:
                acquired_at = time.perf_counter()
                state["queueSeconds"] = acquired_at - queued_at
                import cv2
                import numpy as np

                engine = load_sdk()
                print("[frames] loading WAV", flush=True)
                with wave.open(io.BytesIO(audio), "rb") as wav_file:
                    channels = wav_file.getnchannels()
                    sample_width = wav_file.getsampwidth()
                    sample_rate = wav_file.getframerate()
                    if sample_width != 2:
                        raise RuntimeError(f"16-bit PCM WAV is required; received {sample_width * 8}-bit")
                    audio_samples = np.frombuffer(
                        wav_file.readframes(wav_file.getnframes()), dtype="<i2"
                    ).astype(np.float32) / 32768.0
                if channels > 1:
                    audio_samples = audio_samples.reshape(-1, channels).mean(axis=1)
                if sample_rate != 16000:
                    source_positions = np.arange(len(audio_samples), dtype=np.float64)
                    target_length = max(1, round(len(audio_samples) * 16000 / sample_rate))
                    target_positions = np.arange(target_length, dtype=np.float64) * sample_rate / 16000
                    audio_samples = np.interp(target_positions, source_positions, audio_samples).astype(np.float32)
                frame_total = math.ceil(len(audio_samples) / 16000 * 25)
                state["expectedFrameCount"] = frame_total
                state["inputSampleCount"] = len(audio_samples)
                frame_index = 0

                def emit_frame(frame_rgb) -> None:
                    nonlocal frame_index
                    if cancel_event.is_set():
                        raise RuntimeError("frame stream cancelled")
                    if frame_index >= frame_total:
                        return
                    ok, encoded = cv2.imencode(".jpg", cv2.cvtColor(frame_rgb, cv2.COLOR_RGB2BGR), [int(cv2.IMWRITE_JPEG_QUALITY), 82])
                    if not ok:
                        raise RuntimeError("JPEG frame encoding failed")
                    item = (frame_index, encoded.tobytes())
                    while not cancel_event.is_set():
                        try:
                            frame_queue.put(item, timeout=0.5)
                            frame_index += 1
                            state["frameCount"] = frame_index
                            return
                        except queue.Full:
                            continue
                    raise RuntimeError("frame stream cancelled")

                render_started = time.perf_counter()
                print(f"[frames] setup avatar; samples={len(audio_samples)} expected={frame_total}", flush=True)
                engine.setup(
                    str(SOURCE_PATH),
                    None,
                    online_mode=True,
                    emit_initial_context=True,
                    frame_callback=emit_frame,
                    sampling_timesteps=SAMPLING_TIMESTEPS,
                    max_size=MAX_FRAME_SIZE,
                )
                print("[frames] avatar setup complete; extracting streaming audio features", flush=True)
                engine.setup_Nd(N_d=frame_total, fade_in=5, fade_out=5)
                chunksize = (3, 5, 2)
                padded = np.concatenate([np.zeros((chunksize[0] * 640,), dtype=np.float32), audio_samples], 0)
                split_len = int(sum(chunksize) * 0.04 * 16000) + 80
                for index in range(0, len(padded), chunksize[1] * 640):
                    if cancel_event.is_set():
                        engine.stop_event.set()
                        break
                    chunk = padded[index:index + split_len]
                    if len(chunk) < split_len:
                        chunk = np.pad(chunk, (0, split_len - len(chunk)), mode="constant")
                    engine.run_chunk(chunk, chunksize)
                    state["featureChunkCount"] += 1
                    if state["featureChunkCount"] % 5 == 0:
                        print(f"[frames] feature chunks={state['featureChunkCount']}", flush=True)
                print(f"[frames] closing pipeline after {state['featureChunkCount']} feature chunks", flush=True)
                engine.close()
                state["renderSeconds"] = time.perf_counter() - render_started
                state["complete"] = state["frameCount"] == frame_total
                if not state["complete"] and not cancel_event.is_set():
                    state["error"] = f"incomplete frame stream: expected {frame_total}, emitted {state['frameCount']}"
                print(f"[frames] done; emitted={state['frameCount']} complete={state['complete']}", flush=True)
        except Exception as error:
            if not cancel_event.is_set():
                state["error"] = str(error)
                print(f"[frames] error: {error}", flush=True)
        finally:
            done_event.set()
            audio_path.unlink(missing_ok=True)

    threading.Thread(target=producer, daemon=True).start()

    def generate():
        try:
            while not done_event.is_set() or not frame_queue.empty():
                try:
                    index, jpeg = frame_queue.get(timeout=0.5)
                except queue.Empty:
                    continue
                yield multipart_part(boundary, "image/jpeg", jpeg, {
                    "X-Frame-Index": str(index),
                    "X-Frame-Timestamp-Ms": str(index * 40),
                })
            metadata = json.dumps(state, ensure_ascii=False).encode("utf8")
            yield multipart_part(boundary, "application/json", metadata, {"X-Frame-Final": "1"})
            yield f"--{boundary}--\r\n".encode("ascii")
        finally:
            cancel_event.set()

    return StreamingResponse(generate(), media_type=f"multipart/x-mixed-replace; boundary={boundary}", headers={
        "Cache-Control": "no-store",
        "X-Frame-Rate": "25",
        "X-Render-Mode": "frame-stream",
    })


@app.post("/v1/render")
async def render(request: Request):
    if shutil.which("ffmpeg") is None:
        raise HTTPException(status_code=503, detail="ffmpeg is required for the legacy MP4 endpoint; use /v1/render/frames")
    audio = await request.body()
    supplied_key = validate_audio(audio, request)
    identity = supplied_key.encode("ascii") if supplied_key else hashlib.sha256(audio).hexdigest().encode("ascii")
    cache_key = hashlib.sha256(identity + SOURCE_PATH.read_bytes()).hexdigest()
    output_path = CACHE_ROOT / f"{cache_key}.mp4"
    if output_path.exists() and output_path.stat().st_size > 1024:
        return FileResponse(output_path, media_type="video/mp4", headers={"X-Cache-Hit": "1", "X-Render-Seconds": "0", "X-Queue-Seconds": "0", "X-Total-Seconds": "0"})

    audio_path = CACHE_ROOT / f"{cache_key}.wav"
    temp_output = CACHE_ROOT / f"{cache_key}.rendering.mp4"
    queued_at = time.perf_counter()

    try:
        with render_lock:
            acquired_at = time.perf_counter()
            if output_path.exists() and output_path.stat().st_size > 1024:
                queue_seconds = acquired_at - queued_at
                return FileResponse(output_path, media_type="video/mp4", headers={"X-Cache-Hit": "1", "X-Render-Seconds": "0", "X-Queue-Seconds": f"{queue_seconds:.3f}", "X-Total-Seconds": f"{queue_seconds:.3f}"})
            audio_path.write_bytes(audio)
            from inference import run

            render_started = time.perf_counter()
            run(load_sdk(), str(audio_path), str(SOURCE_PATH), str(temp_output))
            if not temp_output.exists() or temp_output.stat().st_size < 1024:
                raise RuntimeError("Ditto did not produce a playable video")
            temp_output.replace(output_path)
    except Exception as error:
        temp_output.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=str(error)) from error
    finally:
        audio_path.unlink(missing_ok=True)

    finished_at = time.perf_counter()
    return FileResponse(
        output_path,
        media_type="video/mp4",
        headers={
            "X-Cache-Hit": "0",
            "X-Render-Seconds": f"{finished_at - render_started:.3f}",
            "X-Queue-Seconds": f"{acquired_at - queued_at:.3f}",
            "X-Total-Seconds": f"{finished_at - queued_at:.3f}",
        },
    )
