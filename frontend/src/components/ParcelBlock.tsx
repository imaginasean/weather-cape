import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line, Text } from '@react-three/drei'
import * as THREE from 'three'

interface Props {
  y: number
  deltaTC: number
  columnRadius: number
  pulse: number
  elevationM?: number
}

function colorForDelta(dt: number): THREE.Color {
  const t = Math.max(-1, Math.min(1, dt / 3.2))
  const cold = new THREE.Color('#0b53e8')
  const neutral = new THREE.Color('#ffffff')
  const warm = new THREE.Color('#ff2400')
  if (t < 0) return neutral.clone().lerp(cold, Math.min(1, -t * 1.05))
  return neutral.clone().lerp(warm, Math.min(1, t * 1.2))
}

export function ParcelBlock({ y, deltaTC, columnRadius, pulse, elevationM }: Props) {
  const ref = useRef<THREE.Mesh>(null)
  const size = columnRadius * 0.64
  const { boxGeo, emissiveColor } = useMemo(() => {
    const base = colorForDelta(deltaTC)
    const top = base.clone().lerp(new THREE.Color('#ffffff'), 0.34)
    const bottom = base.clone().multiplyScalar(0.62)
    const geo = new THREE.BoxGeometry(size, size * 1.05, size)
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const h = size * 1.05
    // Positive dT bulges the parcel at mid-level; negative dT pinches inward.
    const shapeAmp = Math.max(-0.16, Math.min(0.2, deltaTC / 10))
    const colors = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const yLocal = pos.getY(i)
      const t = Math.max(0, Math.min(1, yLocal / h + 0.5))
      const yNorm = Math.min(1, Math.abs(yLocal) / (h * 0.5))
      const midWeight = Math.pow(1 - yNorm, 1.35)
      const radialScale = Math.max(0.74, Math.min(1.32, 1 + shapeAmp * midWeight))
      pos.setX(i, pos.getX(i) * radialScale)
      pos.setZ(i, pos.getZ(i) * radialScale)
      const c = bottom.clone().lerp(top, t)
      colors[i * 3] = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
    pos.needsUpdate = true
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.computeVertexNormals()
    return { boxGeo: geo, emissiveColor: base.clone().multiplyScalar(0.24) }
  }, [deltaTC, size])

  const mat = useMemo(() => {
    return new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      emissive: emissiveColor,
      emissiveIntensity: 0.48 + Math.min(1.2, Math.max(0, deltaTC) / 7),
      metalness: 0.06,
      roughness: 0.2,
      transmission: 0.88,
      thickness: 1.05,
      transparent: true,
      opacity: 0.4,
      clearcoat: 0.55,
      ior: 1.18,
      depthWrite: false,
    })
  }, [deltaTC, emissiveColor])

  useFrame((_, delta) => {
    if (!ref.current) return
    const s = 1 + 0.04 * Math.sin(pulse * Math.PI * 2) + 0.02 * Math.sin(delta * 8)
    ref.current.scale.setScalar(s)
  })

  return (
    <group position={[0, y, 0]}>
      <mesh ref={ref} material={mat}>
        <primitive object={boxGeo} attach="geometry" />
      </mesh>
      <mesh scale={[0.92, 0.92, 0.92]}>
        <primitive object={boxGeo} attach="geometry" />
        <meshBasicMaterial
          color={colorForDelta(deltaTC).clone().lerp(new THREE.Color('#ffffff'), 0.2)}
          transparent
          opacity={0.16 + Math.min(0.24, Math.max(0, deltaTC) / 20)}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      
      {elevationM != null && (
        <group>
          <Line
            points={[
              [size * 0.6, 0, 0],
              [columnRadius * 1.2, 0, 0]
            ]}
            color="#ffffff"
            lineWidth={1.5}
            transparent
            opacity={0.8}
          />
          <Text
            position={[columnRadius * 1.25, 0, 0]}
            fontSize={0.4}
            color="#ffffff"
            anchorX="left"
            anchorY="middle"
            outlineWidth={0.02}
            outlineColor="#000000"
          >
            {Math.round(elevationM * 3.28084).toLocaleString()} ft
          </Text>
        </group>
      )}
    </group>
  )
}
