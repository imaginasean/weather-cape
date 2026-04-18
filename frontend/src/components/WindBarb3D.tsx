import { Line } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'

const MS_TO_KT = 1.94384
const COS60 = 0.5
const SIN60 = Math.sqrt(3) / 2

function speedToKnots(u: number, v: number): number {
  return Math.hypot(u, v) * MS_TO_KT
}

/** WMO-style counts: 50 kt pennants, 10 kt longs, 5 kt half. */
function discretizeBarbs(kn: number): { n50: number; n10: number; n5: number } {
  if (kn < 2.5) return { n50: 0, n10: 0, n5: 0 }
  let s = Math.round(kn / 5) * 5
  if (s < 5) s = 5
  const n50 = Math.floor(s / 50)
  s -= n50 * 50
  const n10 = Math.floor(s / 10)
  s -= n10 * 10
  const n5 = s >= 5 ? 1 : 0
  return { n50, n10, n5 }
}

/**
 * Plan-view barb drawn on a fixed card in the world XY plane (normal = +Z).
 * Local convention: staff along +X (right on the card), feathers toward +Y (up on the card).
 * A parent rotation about +Z then aligns staff with horizontal wind (u east, v north)
 * so the symbol reads as a map with east-right / north-up.
 */
function buildBarbSegmentsXY(parts: { n50: number; n10: number; n5: number }, scale: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  const pushSeg = (a: THREE.Vector3, b: THREE.Vector3) => {
    out.push(a.clone(), b.clone())
  }

  const S = new THREE.Vector3(1, 0, 0)
  const R = new THREE.Vector3(0, 1, 0)
  const featherDir = new THREE.Vector3()
    .addScaledVector(S, -COS60)
    .addScaledVector(R, SIN60)
    .normalize()

  const anchor = new THREE.Vector3(0, 0, 0)
  const symbolCount = parts.n50 + parts.n10 + parts.n5
  const staffLen = scale * (0.9 + 0.07 * Math.min(symbolCount * 1.4, 14))
  pushSeg(anchor, new THREE.Vector3(staffLen, 0, 0))

  const spacing = scale * 0.1
  const barbLen = scale * 0.34
  const halfLen = barbLen * 0.48
  const pennantAlong = scale * 0.38
  const pennantHalf = scale * 0.2

  let d = staffLen
  for (let p = 0; p < parts.n50; p++) {
    const apex = new THREE.Vector3(d, 0, 0)
    const baseMid = new THREE.Vector3(d - pennantAlong * 0.55, 0, 0)
    const wing = R.clone().multiplyScalar(pennantHalf)
    pushSeg(apex, baseMid.clone().add(wing))
    pushSeg(apex, baseMid.clone().sub(wing))
    pushSeg(baseMid.clone().add(wing), baseMid.clone().sub(wing))
    d -= pennantAlong + spacing * 0.25
  }
  for (let p = 0; p < parts.n10; p++) {
    const pt = new THREE.Vector3(d, 0, 0)
    pushSeg(pt, pt.clone().add(featherDir.clone().multiplyScalar(barbLen)))
    d -= spacing
  }
  if (parts.n5) {
    const pt = new THREE.Vector3(d, 0, 0)
    pushSeg(pt, pt.clone().add(featherDir.clone().multiplyScalar(halfLen)))
  }

  return out
}

function calmSegmentsXY(scale: number): THREE.Vector3[] {
  const r = scale * 0.1
  return [
    new THREE.Vector3(-r, 0, 0),
    new THREE.Vector3(r, 0, 0),
    new THREE.Vector3(0, -r, 0),
    new THREE.Vector3(0, r, 0),
  ]
}

type Props = {
  ax: number
  ay: number
  az: number
  u: number
  v: number
  /** Overall size (matched to altitude label scale). */
  scale: number
  color?: string
  lineWidth?: number
}

export function WindBarb3D({ ax, ay, az, u, v, scale, color = '#b8daf8', lineWidth = 1.35 }: Props) {
  const kn = useMemo(() => speedToKnots(u, v), [u, v])
  const parts = useMemo(() => discretizeBarbs(kn), [kn])
  const points = useMemo(() => {
    if (parts.n50 + parts.n10 + parts.n5 === 0) return calmSegmentsXY(scale)
    return buildBarbSegmentsXY(parts, scale)
  }, [scale, parts])

  // Meteorological convention: barb staff points UPWIND (toward the direction the wind
  // is coming from), so for southerly flow (u=0, v>0) the staff points south (down on the
  // card). Rotate so local +X aligns with -(u, v) on the card surface.
  // Card: +X right (east), +Y up (north). angle = atan2(-v, -u) = atan2(v, u) + π.
  const zRot = useMemo(() => {
    if (Math.hypot(u, v) < 1e-9) return 0
    return Math.atan2(-v, -u)
  }, [u, v])

  if (points.length === 0) return null

  return (
    <group position={[ax, ay, az]} rotation={[0, 0, zRot]}>
      <Line points={points} color={color} lineWidth={lineWidth} segments transparent opacity={0.95} depthWrite={false} />
    </group>
  )
}
