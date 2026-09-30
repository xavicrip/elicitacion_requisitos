import { Link } from 'react-router';

/**
 * Proyecto inexistente o ajeno (US4 escenario 1): la API responde 404 en ambos casos y la
 * interfaz tampoco los distingue, así que no revela si el proyecto existe.
 */
export function ProjectNotFound() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Proyecto no encontrado</h1>
      <p>El proyecto no existe o no tienes acceso a él.</p>
      <Link to="/proyectos" className="text-blue-700 underline">
        Volver a Mis proyectos
      </Link>
    </section>
  );
}
