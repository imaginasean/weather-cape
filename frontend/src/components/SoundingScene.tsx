import { Environment, OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useState } from 'react'

import type { ParcelId, SoundingAnalysis } from '../types'
import {
  animationTopPressure,
  heightAtProgress,
  heightForPressureMb,
  maxZInSounding,
  nearestIndexForHeight,
  surfaceHeight,
  worldYFromZM,
} from '../soundingMath'
import { AtmosphericColumn } from './AtmosphericColumn'
import { ParcelBlock } from './ParcelBlock'

const SCENE_HEIGHT = 18
const COLUMN_R = 3.2

interface InnerProps {
  data: SoundingAnalysis
  parcelId: ParcelId
  progress: number
  playing: boolean
  showInversionsOnly?: boolean
}

function SceneInner({ data, parcelId, progress, playing, showInversionsOnly = false }: InnerProps) {
  const parcel = data.parcels[parcelId]
  const deltas = data.delta_t_c[parcelId]
  const zMaxM = useMemo(() => maxZInSounding(data.levels), [data.levels])
  const zMinM = useMemo(() => surfaceHeight(data.levels) ?? 0, [data.levels])
  const [pulse, setPulse] = useState(0)

  useFrame((_, dt) => {
    if (playing) setPulse((p) => p + dt * 0.45)
  })

  const { parcelY, deltaTC, parcelZ } = useMemo(() => {
    const z0 = surfaceHeight(data.levels)
    const topP = animationTopPressure(parcel, data.levels)
    const z1 = heightForPressureMb(topP, data.levels) ?? maxZInSounding(data.levels)
    if (z0 == null) {
      return { parcelY: 0, deltaTC: 0, parcelZ: 0 }
    }
    const z = heightAtProgress(progress, z0, z1)
    const idx = nearestIndexForHeight(z, data.levels)
    const dt = deltas[idx] ?? 0
    const py = worldYFromZM(z, zMaxM, zMinM, SCENE_HEIGHT)
    return { parcelY: py, deltaTC: dt, parcelZ: z }
  }, [data.levels, parcel, progress, deltas, zMaxM, zMinM])

  return (
    <>
      <PerspectiveCamera makeDefault position={[18, SCENE_HEIGHT * 0.52, 22]} fov={45} near={0.1} far={500} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[12, 28, 10]} intensity={1.5} color="#dbefff" />
      <directionalLight position={[-10, 12, -8]} intensity={0.5} color="#4a6fa5" />
      <Environment preset="night" />
      <color attach="background" args={['#06080f']} />

      <group>
        <AtmosphericColumn
          levels={data.levels}
          deltas={deltas}
          zMaxM={zMaxM}
          zMinM={zMinM}
          sceneHeight={SCENE_HEIGHT}
          columnRadius={COLUMN_R}
          showInversionsOnly={showInversionsOnly}
          layers={{
            moist: data.layers.moist_layers,
            dry: data.layers.dry_layers,
            cap: data.layers.cap_layers,
          }}
        />
        {!showInversionsOnly && (
          <ParcelBlock y={parcelY} deltaTC={deltaTC} columnRadius={COLUMN_R} pulse={pulse} elevationM={parcelZ} />
        )}
      </group>

      <OrbitControls
        enablePan
        panSpeed={1.1}
        screenSpacePanning
        minDistance={2}
        maxDistance={120}
        target={[0, SCENE_HEIGHT * 0.42, 0]}
        maxPolarAngle={Math.PI / 1.8}
      />
    </>
  )
}

export function SoundingScene(props: InnerProps) {
  return (
    <Canvas gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }} dpr={[1, 2]}>
      <SceneInner {...props} />
    </Canvas>
  )
}
