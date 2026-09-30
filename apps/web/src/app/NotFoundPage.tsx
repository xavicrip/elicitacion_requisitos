import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Página no encontrada</h1>
      <p>La dirección que buscas no existe.</p>
      <Link to="/" className="text-blue-700 underline">
        Volver al inicio
      </Link>
    </section>
  );
}
