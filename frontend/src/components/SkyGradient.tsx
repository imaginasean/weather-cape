import { useMemo } from 'react'
import * as THREE from 'three'

interface Props {
  sceneHeight: number
}

const vertexShader = `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragmentShader = `
uniform vec3 colorSurface;
uniform vec3 colorMid;
uniform vec3 colorSpace;
uniform float sceneHeight;

varying vec3 vWorldPosition;

void main() {
  // Map world Y to a 0-1 range
  float h = vWorldPosition.y / (sceneHeight * 1.5);
  h = clamp(h + 0.1, 0.0, 1.0); // Offset slightly so 0 isn't perfectly surface color
  
  vec3 color;
  if (h < 0.4) {
    // Surface to mid-atmosphere (troposphere)
    float t = h / 0.4;
    color = mix(colorSurface, colorMid, t);
  } else {
    // Mid-atmosphere to space (stratosphere and above)
    float t = (h - 0.4) / 0.6;
    color = mix(colorMid, colorSpace, t);
  }
  
  gl_FragColor = vec4(color, 1.0);
  
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export function SkyGradient({ sceneHeight }: Props) {
  const uniforms = useMemo(
    () => ({
      colorSurface: { value: new THREE.Color('#1a2a40') }, // Dark lower atmosphere
      colorMid: { value: new THREE.Color('#0b1222') }, // Dark navy mid atmosphere
      colorSpace: { value: new THREE.Color('#010204') }, // Near-black space
      sceneHeight: { value: sceneHeight },
    }),
    [sceneHeight],
  )

  return (
    <mesh>
      <sphereGeometry args={[250, 32, 32]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  )
}
