"""Fetch radiosonde station availability for a UTC cycle from Wyoming sounding_json."""

from __future__ import annotations

import time
from collections import OrderedDict
from typing import Any
from urllib.parse import quote

import httpx

WYOMING_SOUNDING_JSON = "https://weather.uwyo.edu/wsgi/sounding_json"

# (cache_key -> (expires_epoch, station_ids))
_cache: OrderedDict[tuple[str, str], tuple[float, list[str]]] = OrderedDict()
_MAX_CACHE = 256
_TTL_S = 86400.0


def _cache_get(key: tuple[str, str]) -> list[str] | None:
    now = time.time()
    if key in _cache:
        exp, data = _cache[key]
        if now < exp:
            _cache.move_to_end(key)
            return data
        del _cache[key]
    return None


def _cache_set(key: tuple[str, str], data: list[str]) -> None:
    now = time.time()
    _cache[key] = (now + _TTL_S, data)
    _cache.move_to_end(key)
    while len(_cache) > _MAX_CACHE:
        _cache.popitem(last=False)


async def available_stations(date: str, hour: str) -> tuple[list[str], bool]:
    """
    Return station IDs reported for the given UTC date/hour (Wyoming BUFR index).
    date: YYYY-MM-DD, hour: 0-23 (typically 0,3,6,9,12,15,18,21).
    """
    h = hour.zfill(2) if len(hour) <= 2 else hour[:2]
    key = (date, h)
    hit = _cache_get(key)
    if hit is not None:
        return hit, True

    dt = f"{date} {h}:00:00"
    url = f"{WYOMING_SOUNDING_JSON}?datetime={quote(dt)}"
    timeout = httpx.Timeout(25.0, connect=10.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            r = await client.get(url)
            r.raise_for_status()
            payload: dict[str, Any] = r.json()
    except Exception:
        return [], False

    stations = payload.get("stations")
    if not isinstance(stations, list):
        return [], False

    out: list[str] = []
    seen: set[str] = set()
    for row in stations:
        if not isinstance(row, dict):
            continue
        sid = row.get("stationid")
        if sid is None:
            continue
        s = str(sid).strip()
        if not s or s in seen:
            continue
        seen.add(s)
        out.append(s)

    _cache_set(key, out)
    return out, False
