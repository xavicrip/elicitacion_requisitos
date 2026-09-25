import { Canvas, useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';

function SpinningBox() {
  const mesh = useRef<Mesh>(null);
  useFrame((_state, delta) => {
    if (mesh.current) mesh.current.rotation.y += delta * 0.5;
  });
  return (
    <mesh ref={mesh} rotation={[0.4, 0.6, 0]}>
      <boxGeometry args={[1.6, 1.6, 1.6]} />
      <meshStandardMaterial color="#4f7cff" />
    </mesh>
  );
}

/** Canvas three.js mínimo: verifica que el stack gráfico funciona en el entorno desplegado. */
export function CanvasPreview() {
  return (
    <Canvas style={{ height: 240 }} aria-label="Vista previa del canvas three.js">
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 3, 3]} />
      <SpinningBox />
    </Canvas>
  );
}
