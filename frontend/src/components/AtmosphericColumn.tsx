import { Line, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { useState } from 'react'
import * as THREE from 'three'

import type { LayerBand, SoundingLevel } from '../types'
import { heightForPressureMb, windForPressureMb, worldYFromZM } from '../soundingMath'
import { WindBarb3D } from './WindBarb3D'

const REF_ISOBARS_MB = [1000, 925, 850, 700, 500, 300, 200]

/** Reference isobars plus sounding levels on ~50 mb spacing to avoid label clutter. */
function mergeIsobars(levels: SoundingLevel[]): number[] {
  const set = new Set<number>(REF_ISOBARS_MB)
  for (const l of levels) {
    const p = l.p_mb
    if (p < 100 || p > 1050) continue
    const near50 = Math.round(p / 50) * 50
    if (Math.abs(p - near50) < 3) set.add(near50)
  }
  return [...set].sort((a, b) => b - a)
}

interface Props {
  levels: SoundingLevel[]
  deltas: number[]
  zMaxM: number
  zMinM: number
  sceneHeight: number
  columnRadius: number
  showInversionsOnly?: boolean
  layers?: {
    moist: LayerBand[]
    dry: LayerBand[]
    cap: LayerBand[]
  }
}

function colorForDelta(dt: number): THREE.Color {
  const t = Math.max(-1, Math.min(1, dt / 3.2))
  const cold = new THREE.Color('#0b53e8')
  const neutral = new THREE.Color('#ffffff')
  const warm = new THREE.Color('#ff2400')
  if (t < 0) return neutral.clone().lerp(cold, Math.min(1, -t * 1.05))
  return neutral.clone().lerp(warm, Math.min(1, t * 1.2))
}

type ColumnVolumeProps = Pick<
  Props,
  'levels' | 'deltas' | 'zMaxM' | 'zMinM' | 'sceneHeight' | 'columnRadius' | 'showInversionsOnly'
>

function ColumnVolume({
  levels,
  deltas,
  zMaxM,
  zMinM,
  sceneHeight,
  columnRadius,
  showInversionsOnly = false,
}: ColumnVolumeProps) {
  const { envGeo, capeGeo } = useMemo(() => {
    const valid: SoundingLevel[] = []
    const ds: number[] = []
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].z_m != null && levels[i].t_c != null) {
        valid.push(levels[i])
        ds.push(deltas[i] ?? 0)
      }
    }
    if (valid.length < 2) return { envGeo: null, capeGeo: null }

    const sortedIdx = valid.map((_, i) => i).sort((a, b) => valid[b].p_mb - valid[a].p_mb)
    
    const radialSegments = 32
    const vEnv = [], cEnv = [], iEnv = []
    const vCape = [], cCape = [], iCape = []

    for (let i = 0; i < sortedIdx.length; i++) {
      const idx = sortedIdx[i]
      const l = valid[idx]
      const delta = ds[idx]
      const y = worldYFromZM(l.z_m!, zMaxM, zMinM, sceneHeight)
      
      const envColor = new THREE.Color('#1b2638')

      const rEnv = columnRadius
      
      // Neutral delta -> subtle thread
      // Positive delta (CAPE) -> wider, brighter warm plume
      // Negative delta (CIN) -> thin, darker cool plume
      let rCape = columnRadius * 0.1
      if (delta > 0) {
        rCape = columnRadius * (0.14 + Math.min(0.62, delta / 12))
      } else if (delta < 0) {
        rCape = columnRadius * Math.max(0.035, 0.1 - (-delta / 24))
      }
      
      const capeColor = colorForDelta(delta)

      for (let rSeg = 0; rSeg <= radialSegments; rSeg++) {
        const theta = (rSeg / radialSegments) * Math.PI * 2
        const cx = Math.cos(theta), cz = Math.sin(theta)
        
        vEnv.push(cx * rEnv, y, cz * rEnv)
        cEnv.push(envColor.r, envColor.g, envColor.b)
        
        vCape.push(cx * rCape, y, cz * rCape)
        cCape.push(capeColor.r, capeColor.g, capeColor.b)
      }
    }

    for (let i = 0; i < sortedIdx.length - 1; i++) {
      for (let rSeg = 0; rSeg < radialSegments; rSeg++) {
        const curr = i * (radialSegments + 1) + rSeg
        const next = curr + 1
        const top = curr + (radialSegments + 1)
        const topNext = top + 1
        
        iEnv.push(curr, next, top)
        iEnv.push(next, topNext, top)
        
        // Always emit the inner plume faces so it forms a continuous inner column
        iCape.push(curr, next, top)
        iCape.push(next, topNext, top)
      }
    }

    const ge = new THREE.BufferGeometry()
    ge.setAttribute('position', new THREE.Float32BufferAttribute(vEnv, 3))
    ge.setAttribute('color', new THREE.Float32BufferAttribute(cEnv, 3))
    ge.setIndex(iEnv)
    ge.computeVertexNormals()

    const gc = new THREE.BufferGeometry()
    gc.setAttribute('position', new THREE.Float32BufferAttribute(vCape, 3))
    gc.setAttribute('color', new THREE.Float32BufferAttribute(cCape, 3))
    gc.setIndex(iCape)
    gc.computeVertexNormals()

    return { envGeo: ge, capeGeo: gc }
  }, [levels, deltas, zMaxM, zMinM, sceneHeight, columnRadius])

  return (
    <group>
      {envGeo && (
        <mesh geometry={envGeo}>
          <meshPhysicalMaterial
            vertexColors
            transparent
            opacity={showInversionsOnly ? 0.02 : 0.06}
            roughness={0.6}
            metalness={0.1}
            transmission={0.4}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
      {capeGeo && (
        <mesh geometry={capeGeo}>
          <meshBasicMaterial
            vertexColors
            transparent
            opacity={showInversionsOnly ? 0.08 : 0.78}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  )
}

export function AtmosphericColumn({
  levels,
  deltas,
  zMaxM,
  zMinM,
  sceneHeight,
  columnRadius,
  showInversionsOnly = false,
  layers,
}: Props) {
  const [cameraDistance, setCameraDistance] = useState(28)
  const isobars = useMemo(() => mergeIsobars(levels), [levels])
  const target = useMemo(() => new THREE.Vector3(0, sceneHeight * 0.42, 0), [sceneHeight])

  useFrame(({ camera }) => {
    const d = camera.position.distanceTo(target)
    if (Math.abs(d - cameraDistance) > 0.2) setCameraDistance(d)
  })

  const planes = useMemo(() => {
    const out: { p: number; y: number; label: string }[] = []
    for (const p of isobars) {
      const z = heightForPressureMb(p, levels)
      if (z == null) continue
      out.push({ p, y: worldYFromZM(z, zMaxM, zMinM, sceneHeight), label: `${Math.round(z * 3.28084).toLocaleString()} ft` })
    }
    return out
  }, [isobars, levels, zMaxM, zMinM, sceneHeight])

  const labelStyle = useMemo(() => {
    const t = Math.max(0, Math.min(1, (cameraDistance - 8) / 62))
    return {
      fontSize: 0.5 - 0.22 * t,
      minSpacingY: 0.45 + 1.0 * t,
    }
  }, [cameraDistance])

  const labeledPressureSet = useMemo(() => {
    const sorted = [...planes].sort((a, b) => b.y - a.y)
    const keep = new Set<number>()
    let lastY: number | null = null
    for (const pl of sorted) {
      if (lastY == null || Math.abs(pl.y - lastY) >= labelStyle.minSpacingY) {
        keep.add(pl.p)
        lastY = pl.y
      }
    }
    return keep
  }, [planes, labelStyle.minSpacingY])

  const helixPoints = useMemo(() => {
    const pts: THREE.Vector3[] = []
    const ok = levels.filter((l) => l.z_m != null)
    for (let i = 0; i < ok.length; i += 3) {
      const z = ok[i].z_m!
      const y = worldYFromZM(z, zMaxM, zMinM, sceneHeight)
      const angle = (i / ok.length) * Math.PI * 6
      pts.push(new THREE.Vector3(Math.cos(angle) * columnRadius * 1.05, y, Math.sin(angle) * columnRadius * 1.05))
    }
    return pts
  }, [levels, zMaxM, zMinM, sceneHeight, columnRadius])

  return (
    <group>
      <ColumnVolume
        levels={levels}
        deltas={deltas}
        zMaxM={zMaxM}
        zMinM={zMinM}
        sceneHeight={sceneHeight}
        columnRadius={columnRadius}
        showInversionsOnly={showInversionsOnly}
      />

      {!showInversionsOnly &&
        planes.map((pl) => {
          const wind = windForPressureMb(pl.p, levels)
          return (
            <group key={pl.p} position={[0, pl.y, 0]}>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <ringGeometry args={[columnRadius, columnRadius * 1.05, 64]} />
                <meshBasicMaterial color="#ffffff" transparent opacity={0.6} depthWrite={false} />
              </mesh>
              {labeledPressureSet.has(pl.p) && (
                <>
                  <Text
                    position={[columnRadius * 1.75, 0, 0]}
                    fontSize={labelStyle.fontSize}
                    color="#ffffff"
                    anchorX="right"
                    anchorY="middle"
                    outlineWidth={0.02}
                    outlineColor="#000000"
                  >
                    {pl.label}
                  </Text>
                  {wind && (
                    <WindBarb3D
                      ax={-columnRadius * 1.75}
                      ay={0}
                      az={0}
                      u={wind.u}
                      v={wind.v}
                      scale={labelStyle.fontSize * 2.85}
                      color="#b8daf8"
                      lineWidth={1.45}
                    />
                  )}
                </>
              )}
            </group>
          )
        })}

      {!showInversionsOnly && helixPoints.length > 1 && (
        <Line points={helixPoints} color="#3d6e9c" lineWidth={1.2} transparent opacity={0.35} />
      )}

      {!showInversionsOnly &&
        layers &&
        layers.moist.map((b, i) => (
          <LayerFog
            key={`m-${i}`}
            band={b}
            levels={levels}
            zMaxM={zMaxM}
            zMinM={zMinM}
            sceneHeight={sceneHeight}
            columnRadius={columnRadius}
            color="#6ec8ff"
          />
        ))}
      {layers &&
        layers.cap.map((b, i) => (
          <LayerFog
            key={`c-${i}`}
            band={b}
            levels={levels}
            zMaxM={zMaxM}
            zMinM={zMinM}
            sceneHeight={sceneHeight}
            columnRadius={columnRadius}
            color="#ff4fd2"
            opacity={0.22}
            emphasize
            label={`Inversion ${i + 1}`}
          />
        ))}
    </group>
  )
}

function LayerFog({
  band,
  levels,
  zMaxM,
  zMinM,
  sceneHeight,
  columnRadius,
  color,
  opacity = 0.07,
  emphasize = false,
  label,
}: {
  band: LayerBand
  levels: SoundingLevel[]
  zMaxM: number
  zMinM: number
  sceneHeight: number
  columnRadius: number
  color: string
  opacity?: number
  emphasize?: boolean
  label?: string
}) {
  const zBottom = heightForPressureMb(Math.max(band.bottom_mb, band.top_mb), levels)
  const zTop = heightForPressureMb(Math.min(band.bottom_mb, band.top_mb), levels)
  if (zBottom == null || zTop == null) return null
  const y0 = worldYFromZM(Math.min(zBottom, zTop), zMaxM, zMinM, sceneHeight)
  const y1 = worldYFromZM(Math.max(zBottom, zTop), zMaxM, zMinM, sceneHeight)
  const h = Math.max(0.05, y1 - y0)
  const y = y0 + h / 2
  return (
    <group>
      <mesh position={[0, y, 0]}>
        <cylinderGeometry args={[columnRadius * 0.98, columnRadius * 0.98, h, 32, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {emphasize && (
        <>
          <mesh position={[0, y0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[columnRadius * 0.99, columnRadius * 1.03, 64]} />
            <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} />
          </mesh>
          <mesh position={[0, y1, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[columnRadius * 0.99, columnRadius * 1.03, 64]} />
            <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} />
          </mesh>
          {label && (
            <Text
              position={[columnRadius * 1.12, y1, 0]}
              fontSize={0.34}
              color={color}
              anchorX="left"
              anchorY="middle"
              outlineWidth={0.02}
              outlineColor="#000000"
            >
              {label}
            </Text>
          )}
        </>
      )}
    </group>
  )
}
