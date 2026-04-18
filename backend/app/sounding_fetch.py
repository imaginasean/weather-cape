"""Fetch Wyoming sounding data and parse CSV or legacy PRE formats."""

from __future__ import annotations

import re
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass
class SoundingLevel:
    p_mb: float
    z_m: float | None
    t_c: float | None
    td_c: float | None
    u_ms: float | None
    v_ms: float | None
    rh_pct: float | None


def fetch_sounding_text(url: str, timeout_s: float = 45.0) -> str:
    headers = {
        "User-Agent": "weather-cape/1.0 (educational; +https://github.com/)",
        "Accept": "text/html,text/plain,*/*",
    }
    with httpx.Client(timeout=timeout_s, follow_redirects=True, headers=headers) as client:
        r = client.get(url)
        r.raise_for_status()
        return r.text


def to_wyoming_text_csv_url(url: str) -> str:
    """Return a Wyoming URL forced to the TEXT:CSV format when possible."""
    parsed = urlparse(url)
    if "weather.uwyo.edu" not in parsed.netloc.lower():
        return url
    if not parsed.path.endswith("/wsgi/sounding"):
        return url

    query_pairs = parse_qsl(parsed.query, keep_blank_values=True)
    query_by_lower = {k.lower(): v for k, v in query_pairs}

    # Keep datetime/id if present; force source/type expected by CSV endpoint.
    csv_pairs: list[tuple[str, str]] = []
    if "datetime" in query_by_lower:
        csv_pairs.append(("datetime", query_by_lower["datetime"]))
    if "id" in query_by_lower:
        csv_pairs.append(("id", query_by_lower["id"]))
    csv_pairs.append(("src", query_by_lower.get("src", "BUFR")))
    csv_pairs.append(("type", "TEXT:CSV"))

    return urlunparse(parsed._replace(query=urlencode(csv_pairs)))


_PRE_BLOCK = re.compile(r"<PRE>(.*?)</PRE>", re.IGNORECASE | re.DOTALL)


def extract_pre_body(html: str) -> str:
    m = _PRE_BLOCK.search(html)
    if not m:
        raise ValueError("No <PRE> block found; is this a Wyoming sounding page?")
    return m.group(1)


def looks_like_wyoming_csv(text: str) -> bool:
    first = text.lstrip().splitlines()[0] if text.strip() else ""
    return first.startswith("time,longitude,latitude,pressure_hPa")


def _knots_to_uv(direction_deg: float, speed_knots: float) -> tuple[float, float]:
    """Met convention: direction is where wind comes FROM."""
    import math

    rad = math.radians(direction_deg + 180.0)  # vector toward which wind blows
    ms = speed_knots * 0.514444
    return ms * math.sin(rad), ms * math.cos(rad)


def _ms_to_uv(direction_deg: float, speed_ms: float) -> tuple[float, float]:
    """Met convention: direction is where wind comes FROM."""
    import math

    rad = math.radians(direction_deg + 180.0)  # vector toward which wind blows
    return speed_ms * math.sin(rad), speed_ms * math.cos(rad)


def _to_float(s: str | None) -> float | None:
    if s is None:
        return None
    v = s.strip()
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def _first_float(row: dict[str, Any], keys: list[str]) -> float | None:
    for k in keys:
        if k in row:
            v = _to_float(str(row.get(k, "")))
            if v is not None:
                return v
    return None


def _normalize_celsius_maybe_from_kelvin(levels: list[SoundingLevel]) -> tuple[list[SoundingLevel], bool]:
    finite_t = [lv.t_c for lv in levels if lv.t_c is not None]
    if len(finite_t) < 3:
        return levels, False

    finite_t_sorted = sorted(finite_t)
    median_t = finite_t_sorted[len(finite_t_sorted) // 2]
    # Typical Kelvin temps are ~180-330, while Celsius atmospheric values are usually -100..60.
    looks_kelvin = 150.0 < median_t < 400.0
    if not looks_kelvin:
        return levels, False

    out: list[SoundingLevel] = []
    for lv in levels:
        out.append(
            SoundingLevel(
                p_mb=lv.p_mb,
                z_m=lv.z_m,
                t_c=(lv.t_c - 273.15) if lv.t_c is not None else None,
                td_c=(lv.td_c - 273.15) if lv.td_c is not None else None,
                u_ms=lv.u_ms,
                v_ms=lv.v_ms,
                rh_pct=lv.rh_pct,
            )
        )
    return out, True


def parse_wyoming_csv(csv_text: str) -> tuple[list[SoundingLevel], dict[str, Any]]:
    import csv
    import io

    rows = io.StringIO(csv_text.strip())
    reader = csv.DictReader(rows)
    levels: list[SoundingLevel] = []
    fields = set(reader.fieldnames or [])
    explicit_temp_k = "temperature_K" in fields or "dew point temperature_K" in fields

    for row in reader:
        p = _first_float(row, ["pressure_hPa", "pressure_mb", "pressure_hpa"])
        if p is None:
            continue
        z_m = _first_float(row, ["geopotential height_m", "height_m"])
        t_c = _first_float(row, ["temperature_C", "temperature_c", "temperature_K", "temperature_k"])
        td_c = _first_float(
            row,
            [
                "dew point temperature_C",
                "dewpoint_C",
                "dew point temperature_K",
                "dewpoint_K",
            ],
        )
        rh_pct = _first_float(row, ["relative humidity_%", "relative humidity", "rh_%"])

        u_ms = v_ms = None
        drct = _first_float(row, ["wind direction_degree", "wind direction_deg"])
        spd_ms = _first_float(row, ["wind speed_m/s", "wind speed_ms"])
        if drct is not None and spd_ms is not None:
            u_ms, v_ms = _ms_to_uv(drct, spd_ms)

        levels.append(
            SoundingLevel(
                p_mb=p,
                z_m=z_m,
                t_c=t_c,
                td_c=td_c,
                u_ms=u_ms,
                v_ms=v_ms,
                rh_pct=rh_pct,
            )
        )

    if len(levels) < 3:
        raise ValueError("Too few sounding levels parsed from CSV data.")
    converted_from_kelvin = False
    if explicit_temp_k:
        converted_from_kelvin = True
        converted: list[SoundingLevel] = []
        for lv in levels:
            converted.append(
                SoundingLevel(
                    p_mb=lv.p_mb,
                    z_m=lv.z_m,
                    t_c=(lv.t_c - 273.15) if lv.t_c is not None else None,
                    td_c=(lv.td_c - 273.15) if lv.td_c is not None else None,
                    u_ms=lv.u_ms,
                    v_ms=lv.v_ms,
                    rh_pct=lv.rh_pct,
                )
            )
        levels = converted
    else:
        levels, converted_from_kelvin = _normalize_celsius_maybe_from_kelvin(levels)

    unit_meta = {
        "temperature_input_unit": "K" if converted_from_kelvin else "C",
        "temperature_output_unit": "C",
        "converted_from_kelvin": converted_from_kelvin,
    }
    return levels, unit_meta


def parse_wyoming_pre(pre: str) -> list[SoundingLevel]:
    lines = pre.replace("\r\n", "\n").split("\n")
    levels: list[SoundingLevel] = []
    for line in lines:
        s = line.strip()
        if not s or s.startswith("-") or "PRES" in s or "hPa" in s:
            continue
        parts = s.split()
        if len(parts) < 2:
            continue
        try:
            p = float(parts[0])
            hght = float(parts[1]) if parts[1] != "" else None
        except ValueError:
            continue
        t_c = td_c = rh_pct = None
        u_ms = v_ms = None
        if len(parts) >= 4:
            try:
                t_c = float(parts[2])
                td_c = float(parts[3])
            except ValueError:
                pass
        if len(parts) >= 5:
            try:
                rh_pct = float(parts[4])
            except ValueError:
                pass
        if len(parts) >= 9:
            try:
                drct = float(parts[6])
                sknt = float(parts[7])
                u_ms, v_ms = _knots_to_uv(drct, sknt)
            except ValueError:
                pass
        levels.append(
            SoundingLevel(
                p_mb=p,
                z_m=hght,
                t_c=t_c,
                td_c=td_c,
                u_ms=u_ms,
                v_ms=v_ms,
                rh_pct=rh_pct,
            )
        )
    if len(levels) < 3:
        raise ValueError("Too few sounding levels parsed from PRE data.")
    return levels


def levels_to_met_arrays(levels: list[SoundingLevel]):
    """Return numpy arrays sorted high pressure (surface) -> low pressure (top), MetPy order."""
    import numpy as np

    valid = [L for L in levels if L.t_c is not None and L.td_c is not None]
    if len(valid) < 3:
        raise ValueError("Not enough levels with temperature and dewpoint.")
    p_raw = np.array([L.p_mb for L in valid], dtype=float)
    t_raw = np.array([L.t_c for L in valid], dtype=float)
    td_raw = np.array([L.td_c for L in valid], dtype=float)
    z_raw = np.array([L.z_m if L.z_m is not None else np.nan for L in valid], dtype=float)
    u_raw = np.array([L.u_ms if L.u_ms is not None else np.nan for L in valid], dtype=float)
    v_raw = np.array([L.v_ms if L.v_ms is not None else np.nan for L in valid], dtype=float)
    rh_raw = np.array([L.rh_pct if L.rh_pct is not None else np.nan for L in valid], dtype=float)
    order = np.argsort(-p_raw)
    p_sorted = p_raw[order]
    t_sorted = t_raw[order]
    td_sorted = td_raw[order]
    z_sorted = z_raw[order]
    u_sorted = u_raw[order]
    v_sorted = v_raw[order]
    rh_sorted = rh_raw[order]

    # High-resolution CSV soundings can repeat pressure levels.
    # Keep first sample at each 0.1 hPa level to avoid MetPy duplicate-pressure warnings.
    p_key = np.round(p_sorted, 1)
    _, keep_idx = np.unique(p_key, return_index=True)
    keep = np.sort(keep_idx)
    return (
        p_sorted[keep],
        t_sorted[keep],
        td_sorted[keep],
        z_sorted[keep],
        u_sorted[keep],
        v_sorted[keep],
        rh_sorted[keep],
    )
