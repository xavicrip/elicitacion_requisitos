import { CanvasPreview } from './components/CanvasPreview';
import { getConfig, supportsWebGL2 } from './lib/config';

export function App() {
  const { version } = getConfig();
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 720,
        margin: '2rem auto',
        padding: '0 1rem',
      }}
    >
      <h1>ReqCanvas</h1>
      <p>Levantamiento colaborativo de requisitos sobre diagramas UML de actividades.</p>
      {supportsWebGL2() ? (
        <CanvasPreview />
      ) : (
        <p role="status">
          Tu navegador no soporta WebGL 2. Usa una versión reciente de Chrome, Edge, Firefox o
          Safari.
        </p>
      )}
      <footer>
        <small>v{version}</small>
      </footer>
    </main>
  );
}
