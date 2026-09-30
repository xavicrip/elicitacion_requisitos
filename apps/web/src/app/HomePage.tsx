import { CanvasPreview } from '../components/CanvasPreview';
import { supportsWebGL2 } from '../lib/config';

export function HomePage() {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-semibold">ReqCanvas</h1>
      <p>Levantamiento colaborativo de requisitos sobre diagramas UML de actividades.</p>
      {supportsWebGL2() ? (
        <CanvasPreview />
      ) : (
        <p role="status">
          Tu navegador no soporta WebGL 2. Usa una versión reciente de Chrome, Edge, Firefox o
          Safari.
        </p>
      )}
    </section>
  );
}
