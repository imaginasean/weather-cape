"""MetPy parcel profiles, CAPE/CIN, LCL/LFC/EL for SB / ML / MU parcels."""

from __future__ import annotations

from typing import Any

import numpy as np
from metpy.calc import (
    el,
    lcl,
    lfc,
    mixed_layer_cape_cin,
    mixed_parcel,
    most_unstable_cape_cin,
    most_unstable_parcel,
    parcel_profile,
    surface_based_cape_cin,
)
from metpy.units import units


def _q_to_float(x: Any) -> float | None:
    if x is None:
        return None
    try:
        if hasattr(x, "magnitude"):
            return float(np.asarray(x.magnitude).flat[0])
        v = float(np.asarray(x).flat[0])
        return v if np.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _q_mask_none(x: Any) -> float | None:
    if x is None:
        return None
    try:
        arr = np.asarray(x.magnitude if hasattr(x, "magnitude") else x).astype(float)
        v = float(arr.flat[0])
        if not np.isfinite(v):
            return None
        return v
    except (TypeError, ValueError):
        return None


def _parcel_block(
    name: str,
    pressure,
    temperature,
    dewpoint,
    parcel_prof,
    cape,
    cin,
    *,
    parcel_p0,
    parcel_t0,
    parcel_td0,
) -> dict[str, Any]:
    lcl_p = lcl(parcel_p0, parcel_t0, parcel_td0)
    lfc_p = lfc(pressure, temperature, dewpoint, parcel_temperature_profile=parcel_prof)
    el_p = el(pressure, temperature, dewpoint, parcel_temperature_profile=parcel_prof)

    parcel_c = parcel_prof.to(units.degC)
    return {
        "id": name,
        "cape_jkg": _q_to_float(cape),
        "cin_jkg": _q_to_float(cin),
        "lcl_mb": _q_mask_none(lcl_p),
        "lfc_mb": _q_mask_none(lfc_p),
        "el_mb": _q_mask_none(el_p),
        "parcel_t_c": [float(x) for x in np.asarray(parcel_c.magnitude).flatten()],
    }


def analyze_sounding(
    p_hpa: np.ndarray,
    t_c: np.ndarray,
    td_c: np.ndarray,
    z_m: np.ndarray | None = None,
    ml_depth_hpa: float = 100.0,
    mu_depth_hpa: float = 300.0,
) -> dict[str, Any]:
    p = p_hpa * units.hPa
    t = t_c * units.degC
    td = td_c * units.degC

    height = None
    if z_m is not None and np.isfinite(z_m).all():
        height = z_m * units.m

    # --- Surface-based ---
    prof_sb = parcel_profile(p, t[0], td[0])
    cape_sb, cin_sb = surface_based_cape_cin(p, t, td)
    sb = _parcel_block(
        "sb", p, t, td, prof_sb, cape_sb, cin_sb,
        parcel_p0=p[0], parcel_t0=t[0], parcel_td0=td[0],
    )

    # --- Mixed layer ---
    p_ml, t_ml, td_ml = mixed_parcel(
        p,
        t,
        td,
        height=height,
        depth=ml_depth_hpa * units.hPa,
    )
    prof_ml = parcel_profile(p, t_ml, td_ml)
    cape_ml, cin_ml = mixed_layer_cape_cin(
        p, t, td, depth=ml_depth_hpa * units.hPa
    )
    ml = _parcel_block(
        "ml", p, t, td, prof_ml, cape_ml, cin_ml,
        parcel_p0=p_ml, parcel_t0=t_ml, parcel_td0=td_ml,
    )

    # --- Most unstable ---
    p_mu, t_mu, td_mu, _idx = most_unstable_parcel(
        p,
        t,
        td,
        height=height,
        depth=mu_depth_hpa * units.hPa,
    )
    prof_mu = parcel_profile(p, t_mu, td_mu)
    cape_mu, cin_mu = most_unstable_cape_cin(
        p, t, td, depth=mu_depth_hpa * units.hPa
    )
    mu = _parcel_block(
        "mu", p, t, td, prof_mu, cape_mu, cin_mu,
        parcel_p0=p_mu, parcel_t0=t_mu, parcel_td0=td_mu,
    )

    env_t = [float(x) for x in np.asarray(t.magnitude).flatten()]
    delta_sb = [float(tp - te) for tp, te in zip(sb["parcel_t_c"], env_t, strict=True)]
    delta_ml = [float(tp - te) for tp, te in zip(ml["parcel_t_c"], env_t, strict=True)]
    delta_mu = [float(tp - te) for tp, te in zip(mu["parcel_t_c"], env_t, strict=True)]

    return {
        "parcels": {"sb": sb, "ml": ml, "mu": mu},
        "delta_t_c": {"sb": delta_sb, "ml": delta_ml, "mu": delta_mu},
    }


def rough_layers_from_rh(
    p_hpa: np.ndarray,
    rh: np.ndarray,
    t_c: np.ndarray,
) -> dict[str, list[dict[str, float]]]:
    def merge_bands(
        bands: list[dict[str, float]], *, max_gap_mb: float = 2.0, min_thickness_mb: float = 0.0
    ) -> list[dict[str, float]]:
        if not bands:
            return []
        # Normalize so bottom_mb >= top_mb, then sort from lower altitude to higher altitude.
        norm = [
            {"bottom_mb": max(b["bottom_mb"], b["top_mb"]), "top_mb": min(b["bottom_mb"], b["top_mb"])}
            for b in bands
        ]
        norm.sort(key=lambda b: b["bottom_mb"], reverse=True)
        merged: list[dict[str, float]] = [norm[0].copy()]
        for b in norm[1:]:
            cur = merged[-1]
            # Overlap or very small gap between adjacent layers: merge.
            if b["bottom_mb"] >= cur["top_mb"] - max_gap_mb:
                cur["top_mb"] = min(cur["top_mb"], b["top_mb"])
                cur["bottom_mb"] = max(cur["bottom_mb"], b["bottom_mb"])
            else:
                merged.append(b.copy())
        if min_thickness_mb > 0:
            merged = [b for b in merged if (b["bottom_mb"] - b["top_mb"]) >= min_thickness_mb]
        return merged

    """Heuristic dry/moist/cap bands for visualization (not a substitute for analysis)."""
    p = np.asarray(p_hpa, dtype=float)
    rh_a = np.asarray(rh, dtype=float)
    t_a = np.asarray(t_c, dtype=float)
    moist: list[dict[str, float]] = []
    dry: list[dict[str, float]] = []
    i = 0
    n = len(p)
    while i < n:
        if np.isnan(rh_a[i]):
            i += 1
            continue
        if rh_a[i] >= 60.0:
            j = i
            while j + 1 < n and rh_a[j + 1] >= 55.0 and not np.isnan(rh_a[j + 1]):
                j += 1
            moist.append({"bottom_mb": float(p[i]), "top_mb": float(p[j])})
            i = j + 1
        else:
            i += 1

    i = 0
    while i < n:
        if np.isnan(rh_a[i]):
            i += 1
            continue
        if rh_a[i] <= 45.0:
            j = i
            while j + 1 < n and rh_a[j + 1] <= 50.0 and not np.isnan(rh_a[j + 1]):
                j += 1
            dry.append({"bottom_mb": float(p[i]), "top_mb": float(p[j])})
            i = j + 1
        else:
            i += 1

    cap: list[dict[str, float]] = []
    for k in range(1, n - 1):
        if p[k] > 700:
            dtdp = (t_a[k - 1] - t_a[k + 1]) / (p[k + 1] - p[k - 1])
            if dtdp > 0.08:
                cap.append({"bottom_mb": float(p[k + 1]), "top_mb": float(p[k - 1])})

    return {
        "moist_layers": merge_bands(moist, max_gap_mb=6.0, min_thickness_mb=8.0),
        "dry_layers": merge_bands(dry, max_gap_mb=6.0, min_thickness_mb=8.0),
        "cap_layers": merge_bands(cap, max_gap_mb=4.0, min_thickness_mb=3.0),
    }
