from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Literal
from urllib.parse import parse_qsl, urlparse

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, HttpUrl

from app.analysis import analyze_sounding, rough_layers_from_rh
from app.ollama_chat import SEVERE_WX_SYSTEM_PROMPT, stream_chat
from app.sounding_fetch import (
    extract_pre_body,
    fetch_sounding_text,
    levels_to_met_arrays,
    looks_like_wyoming_csv,
    parse_wyoming_csv,
    parse_wyoming_pre,
    to_wyoming_text_csv_url,
)

app = FastAPI(title="Weather Cape API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_TITLE_RE = re.compile(
    r"<H2>\s*(\d+)\s+([A-Z]+)\s+([^<]+?)\s+Observations\s+at\s+(\d+)Z\s+(\d+)\s+([A-Za-z]+)\s+(\d{4})",
    re.IGNORECASE,
)


def _parse_title(html: str) -> dict[str, Any]:
    m = _TITLE_RE.search(html)
    if not m:
        return {}
    return {
        "station_id": m.group(1),
        "station_code": m.group(2),
        "station_name": m.group(3).strip(),
        "utc_hour": int(m.group(4)),
        "utc_day": int(m.group(5)),
        "utc_month_name": m.group(6),
        "utc_year": int(m.group(7)),
    }


class SoundingRequest(BaseModel):
    url: HttpUrl = Field(..., description="Wyoming or compatible sounding page URL")


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    image_b64: str | None = None
    use_default_system_prompt: bool = True


def _parse_csv_meta(csv_text: str, source_url: str) -> dict[str, Any]:
    lines = [ln for ln in csv_text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return {}

    first_fields = [f.strip() for f in lines[1].split(",")]
    if not first_fields:
        return {}

    dt_str = first_fields[0]
    out: dict[str, Any] = {}
    try:
        dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S")
        out["utc_hour"] = int(dt.hour)
        out["utc_day"] = int(dt.day)
        out["utc_month_name"] = dt.strftime("%b")
        out["utc_year"] = int(dt.year)
    except ValueError:
        pass

    q = {k.lower(): v for k, v in parse_qsl(urlparse(source_url).query, keep_blank_values=True)}
    station_code = q.get("id")
    if station_code:
        out["station_code"] = station_code
    return out


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/chat/sounding")
async def chat_sounding(body: ChatRequest) -> StreamingResponse:
    msgs: list[dict[str, Any]] = [m.model_dump() for m in body.messages]
    if body.use_default_system_prompt and not any(m.get("role") == "system" for m in msgs):
        msgs.insert(0, {"role": "system", "content": SEVERE_WX_SYSTEM_PROMPT})
    return StreamingResponse(
        stream_chat(msgs, body.image_b64),
        media_type="application/x-ndjson",
    )


@app.post("/api/sounding/analyze")
def analyze_sounding_from_url(body: SoundingRequest) -> dict[str, Any]:
    original_url = str(body.url)
    url = to_wyoming_text_csv_url(original_url)
    try:
        payload = fetch_sounding_text(url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch URL: {e}") from e

    try:
        if looks_like_wyoming_csv(payload):
            levels, unit_meta = parse_wyoming_csv(payload)
            meta = _parse_csv_meta(payload, url)
            meta.update(unit_meta)
        else:
            pre = extract_pre_body(payload)
            levels = parse_wyoming_pre(pre)
            meta = _parse_title(payload)
            meta.update(
                {
                    "temperature_input_unit": "C",
                    "temperature_output_unit": "C",
                    "converted_from_kelvin": False,
                }
            )
        p, t, td, z, u, v, rh = levels_to_met_arrays(levels)
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Could not parse sounding: {e}") from e

    try:
        analysis = analyze_sounding(p, t, td, z_m=z)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"MetPy analysis failed: {e}") from e

    levels_out = []
    for i in range(len(p)):
        levels_out.append(
            {
                "p_mb": float(p[i]),
                "z_m": float(z[i]) if z.size > i and np.isfinite(z[i]) else None,
                "t_c": float(t[i]),
                "td_c": float(td[i]),
                "u_ms": float(u[i]) if np.isfinite(u[i]) else None,
                "v_ms": float(v[i]) if np.isfinite(v[i]) else None,
                "rh_pct": float(rh[i]) if np.isfinite(rh[i]) else None,
            }
        )

    layers = rough_layers_from_rh(p, rh, t)

    return {
        "source_url": url,
        "requested_url": original_url,
        "meta": meta,
        "levels": levels_out,
        "parcels": analysis["parcels"],
        "delta_t_c": analysis["delta_t_c"],
        "layers": layers,
    }
