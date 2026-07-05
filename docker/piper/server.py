"""Minimal HTTP wrapper around piper-tts so the Node adapters can call it over REST.

Endpoints:
  GET  /health
  GET  /voices
  POST /synthesize   { "text": str, "voiceId": str, "outputFormat": "wav" } -> audio/wav bytes
"""
import io
import os
import wave
from pathlib import Path

import requests
from flask import Flask, Response, jsonify, request
from piper.voice import PiperVoice

app = Flask(__name__)

MODELS_DIR = Path(os.environ.get("PIPER_MODELS_DIR", "/data/models"))
MODELS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_VOICE = os.environ.get("PIPER_DEFAULT_VOICE", "en_US-lessac-medium")

VOICE_CATALOG = {
    "en_US-lessac-medium": "en/en_US/lessac/medium/en_US-lessac-medium",
    "es_ES-davefx-medium": "es/es_ES/davefx/medium/es_ES-davefx-medium",
}

HF_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

_loaded_voices: dict[str, PiperVoice] = {}


def ensure_voice_files(voice_id: str) -> Path:
    rel_path = VOICE_CATALOG.get(voice_id, VOICE_CATALOG[DEFAULT_VOICE])
    onnx_path = MODELS_DIR / f"{voice_id}.onnx"
    json_path = MODELS_DIR / f"{voice_id}.onnx.json"
    if not onnx_path.exists():
        resp = requests.get(f"{HF_BASE}/{rel_path}.onnx", timeout=120)
        resp.raise_for_status()
        onnx_path.write_bytes(resp.content)
    if not json_path.exists():
        resp = requests.get(f"{HF_BASE}/{rel_path}.onnx.json", timeout=60)
        resp.raise_for_status()
        json_path.write_bytes(resp.content)
    return onnx_path


def get_voice(voice_id: str) -> PiperVoice:
    voice_id = voice_id or DEFAULT_VOICE
    if voice_id not in _loaded_voices:
        onnx_path = ensure_voice_files(voice_id)
        _loaded_voices[voice_id] = PiperVoice.load(str(onnx_path))
    return _loaded_voices[voice_id]


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/voices")
def voices():
    return jsonify(
        [{"id": vid, "label": vid, "language": vid.split("_")[0]} for vid in VOICE_CATALOG]
    )


@app.post("/synthesize")
def synthesize():
    payload = request.get_json(force=True)
    text = payload.get("text", "")
    voice_id = payload.get("voiceId") or DEFAULT_VOICE
    if not text.strip():
        return jsonify({"error": "text is required"}), 400

    voice = get_voice(voice_id)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        voice.synthesize(text, wav_file)

    buffer.seek(0)
    return Response(buffer.read(), mimetype="audio/wav")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
