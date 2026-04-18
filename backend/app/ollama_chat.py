"""Stream chat completions from a local Ollama instance (vision-capable models)."""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from copy import deepcopy
from typing import Any

import httpx

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_VISION_MODEL = os.environ.get("OLLAMA_VISION_MODEL", "gemma4:latest")
OLLAMA_TIMEOUT_S = float(os.environ.get("OLLAMA_TIMEOUT_S", "120"))

SEVERE_WX_SYSTEM_PROMPT = """You are a meteorologist analyzing atmospheric soundings for severe weather potential.

The user may provide a screenshot of a 3D or skew-T-style sounding visualization (temperature, moisture, stability, parcel path, wind, inversions). Treat it as observational context only; read visible cues carefully.

Produce a technical severe weather outlook. Structure your answer with clear sections:

1. **Thermodynamics** — Estimate or discuss CAPE/CIN if inferable from the graphic; LCL/LFC/EL if visible; capping inversions and their strength; low-level moisture depth.
2. **Lapse rates** — Comment on 700–500 mb (or visible) lapse rate character if inferable.
3. **Kinematics** — Hodograph / shear: 0–3 km and 0–6 km bulk shear character if wind data appears in the image; low-level vs deep-layer curvature.
4. **Hazards** — Tornado, large hail, damaging wind, flash flood potential with brief reasoning.
5. **Confidence** — Note limitations (single time, no mesoscale context, image resolution, 3D vs classic Skew-T).

Use concise bullet points where appropriate. Do not invent exact numbers not supported by the image; qualify estimates."""

CHAT_URL = f"{OLLAMA_HOST}/api/chat"


def _inject_image_into_first_user_message(messages: list[dict[str, Any]], image_b64: str | None) -> list[dict[str, Any]]:
    if not image_b64:
        return messages
    out = deepcopy(messages)
    for msg in out:
        if msg.get("role") == "user":
            msg["images"] = [image_b64]
            break
    return out


async def stream_chat(messages: list[dict[str, Any]], image_b64: str | None) -> AsyncIterator[bytes]:
    """Forward Ollama /api/chat NDJSON stream to the client (one JSON object per line)."""
    payload_messages = _inject_image_into_first_user_message(messages, image_b64)
    payload: dict[str, Any] = {
        "model": OLLAMA_VISION_MODEL,
        "stream": True,
        "messages": payload_messages,
    }
    timeout = httpx.Timeout(OLLAMA_TIMEOUT_S, connect=30.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            async with client.stream("POST", CHAT_URL, json=payload) as response:
                if response.status_code >= 400:
                    body = await response.aread()
                    text = body.decode("utf-8", errors="replace") or response.reason_phrase
                    err_line = json.dumps({"error": text, "status_code": response.status_code})
                    yield (err_line + "\n").encode("utf-8")
                    return
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    # Pass through Ollama's NDJSON line unchanged (already valid JSON per line)
                    yield (line + "\n").encode("utf-8")
        except httpx.RequestError as e:
            err_line = json.dumps({"error": f"Ollama request failed: {e}"})
            yield (err_line + "\n").encode("utf-8")
