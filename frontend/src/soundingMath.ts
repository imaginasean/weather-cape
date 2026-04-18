import type { SoundingLevel } from './types'

/** Pressure decreases with index; interpolate geometric height for target pressure. */
export function heightForPressureMb(
  pTarget: number,
  levels: SoundingLevel[],
): number | null {
  const ok = levels.filter((l) => l.z_m != null && Number.isFinite(l.p_mb))
  if (ok.length < 2) return null
  const byP = [...ok].sort((a, b) => b.p_mb - a.p_mb)
  if (pTarget >= byP[0].p_mb) return byP[0].z_m
  if (pTarget <= byP[byP.length - 1].p_mb) return byP[byP.length - 1].z_m
  for (let i = 0; i < byP.length - 1; i++) {
    const lo = byP[i + 1]
    const hi = byP[i]
    if (pTarget <= hi.p_mb && pTarget >= lo.p_mb) {
      const z0 = hi.z_m!
      const z1 = lo.z_m!
      const p0 = hi.p_mb
      const p1 = lo.p_mb
      const t = (pTarget - p0) / (p1 - p0)
      return z0 + t * (z1 - z0)
    }
  }
  return null
}

export function surfaceHeight(levels: SoundingLevel[]): number | null {
  const byP = [...levels].filter((l) => l.z_m != null).sort((a, b) => b.p_mb - a.p_mb)
  return byP[0]?.z_m ?? null
}

export function maxZInSounding(levels: SoundingLevel[]): number {
  let z = 0
  for (const l of levels) {
    if (l.z_m != null && Number.isFinite(l.z_m)) z = Math.max(z, l.z_m)
  }
  return z > 0 ? z : 1
}

/** Map meters to scene Y. We map the lowest point to Y=0 and the highest point to Y=sceneHeight. */
export function worldYFromZM(zM: number, zMaxM: number, zMinM: number, sceneHeight = 18): number {
  const range = zMaxM - zMinM
  if (range <= 0) return 0
  return ((zM - zMinM) / range) * sceneHeight
}

export function animationTopPressure(
  parcel: { el_mb: number | null },
  levels: SoundingLevel[],
): number {
  if (parcel.el_mb != null && Number.isFinite(parcel.el_mb)) {
    return parcel.el_mb
  }
  const ps = levels.map((l) => l.p_mb)
  return Math.min(...ps)
}

/** Smooth vertical motion (cinematic polish); timeline scrub stays linear in user space. */
export function heightAtProgress(t: number, z0: number, z1: number): number {
  const u = Math.min(1, Math.max(0, t))
  const s = u * u * (3 - 2 * u)
  return z0 + s * (z1 - z0)
}

export function nearestIndexForHeight(z: number, levels: SoundingLevel[]): number {
  const withZ = levels
    .map((l, i) => ({ i, z: l.z_m }))
    .filter((x): x is { i: number; z: number } => x.z != null && Number.isFinite(x.z))
  if (withZ.length === 0) return 0
  let best = withZ[0].i
  let bestD = Math.abs(withZ[0].z - z)
  for (const row of withZ) {
    const d = Math.abs(row.z - z)
    if (d < bestD) {
      bestD = d
      best = row.i
    }
  }
  return best
}

/** Interpolate u,v (m/s) at target pressure from levels with valid wind. */
export function windForPressureMb(
  pTarget: number,
  levels: SoundingLevel[],
): { u: number; v: number } | null {
  const ok = levels.filter(
    (l) =>
      l.u_ms != null &&
      l.v_ms != null &&
      Number.isFinite(l.u_ms) &&
      Number.isFinite(l.v_ms) &&
      Number.isFinite(l.p_mb),
  )
  if (ok.length < 2) return null
  const byP = [...ok].sort((a, b) => b.p_mb - a.p_mb)
  if (pTarget >= byP[0].p_mb) {
    return { u: byP[0].u_ms!, v: byP[0].v_ms! }
  }
  if (pTarget <= byP[byP.length - 1].p_mb) {
    const last = byP[byP.length - 1]
    return { u: last.u_ms!, v: last.v_ms! }
  }
  for (let i = 0; i < byP.length - 1; i++) {
    const hi = byP[i]
    const lo = byP[i + 1]
    if (pTarget <= hi.p_mb && pTarget >= lo.p_mb) {
      const p0 = hi.p_mb
      const p1 = lo.p_mb
      const t = (pTarget - p0) / (p1 - p0)
      return {
        u: hi.u_ms! + t * (lo.u_ms! - hi.u_ms!),
        v: hi.v_ms! + t * (lo.v_ms! - hi.v_ms!),
      }
    }
  }
  return null
}
