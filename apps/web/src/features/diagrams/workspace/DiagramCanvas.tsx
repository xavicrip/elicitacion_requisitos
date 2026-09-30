import { MapControls, useTexture } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { Component, Suspense, useEffect, useRef, type ComponentRef, type ReactNode } from 'react';
import { MOUSE, SRGBColorSpace } from 'three';
import { EditorLayer } from '../editor/EditorLayer';
import { fitZoom, MAX_ZOOM_FACTOR, MIN_ZOOM_FACTOR, type Size } from './camera/zoom';
import { useWorkspaceStore } from './store';

/**
 * Coordenadas del mundo: 1 unidad = 1 px de la imagen display, con la esquina superior
 * izquierda en el origen y el eje `y` hacia arriba (por eso la imagen ocupa `y` negativas).
 */
function DiagramImage({ url, image }: { url: string; image: Size }) {
  const texture = useTexture(url);
  const gl = useThree((state) => state.gl);
  const setImageStatus = useWorkspaceStore((state) => state.setImageStatus);

  useEffect(() => {
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = gl.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
    setImageStatus('ready');
  }, [texture, gl, setImageStatus]);

  return (
    <mesh position={[image.width / 2, -image.height / 2, 0]}>
      <planeGeometry args={[image.width, image.height]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

/** Ajusta la cámara a la imagen al abrirla y limita el zoom al 10 %–800 % del ajuste (R4). */
function CameraRig({ image, editing }: { image: Size; editing: boolean }) {
  const { camera, size, invalidate } = useThree();
  const controls = useRef<ComponentRef<typeof MapControls>>(null);
  const setCamera = useWorkspaceStore((state) => state.setCamera);
  const fitted = useRef(false);

  useEffect(() => {
    const fit = fitZoom(size, image);
    if (controls.current) {
      controls.current.minZoom = fit * MIN_ZOOM_FACTOR;
      controls.current.maxZoom = fit * MAX_ZOOM_FACTOR;
    }
    if (fitted.current) return;
    fitted.current = true;
    camera.zoom = fit;
    camera.position.set(image.width / 2, -image.height / 2, 100);
    camera.updateProjectionMatrix();
    controls.current?.target.set(image.width / 2, -image.height / 2, 0);
    controls.current?.update();
    setCamera({ zoom: fit, center: { x: image.width / 2, y: image.height / 2 } });
    invalidate();
  }, [camera, size, image, invalidate, setCamera]);

  return (
    <MapControls
      ref={controls}
      makeDefault
      // Al editar, el botón izquierdo dibuja y mueve zonas; se desplaza con el derecho o la rueda.
      mouseButtons={
        editing
          ? { LEFT: -1 as MOUSE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }
          : { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }
      }
      enableRotate={false}
      zoomToCursor
      screenSpacePanning
      onChange={() => {
        const target = controls.current?.target;
        if (target) setCamera({ zoom: camera.zoom, center: { x: target.x, y: -target.y } });
      }}
    />
  );
}

class TextureErrorBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onError();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Canvas three.js del diagrama (research R3): ortográfico y renderizado bajo demanda. */
export default function DiagramCanvas({
  imageUrl,
  image,
  versionId,
  editing,
}: {
  imageUrl: string;
  image: Size;
  versionId: string;
  editing: boolean;
}) {
  const setImageStatus = useWorkspaceStore((state) => state.setImageStatus);
  return (
    <Canvas
      orthographic
      frameloop="demand"
      camera={{ near: 0.1, far: 1000, position: [image.width / 2, -image.height / 2, 100] }}
      aria-label="Diagrama"
      className="touch-none"
    >
      <color attach="background" args={['#f3f4f6']} />
      <TextureErrorBoundary onError={() => setImageStatus('error')}>
        <Suspense fallback={null}>
          <DiagramImage url={imageUrl} image={image} />
        </Suspense>
      </TextureErrorBoundary>
      {editing && <EditorLayer versionId={versionId} image={image} />}
      <CameraRig image={image} editing={editing} />
    </Canvas>
  );
}
