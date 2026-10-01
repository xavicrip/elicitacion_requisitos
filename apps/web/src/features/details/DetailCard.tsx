import type { Detail } from '@reqcanvas/shared';
import { DETAIL_STATUS_LABEL, DETAIL_TYPE_LABEL, PRIORITY_LABEL } from './labels';

const dateFormat = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});

/**
 * Un detalle de requisito: escenario Dado/Cuando/Entonces y sus metadatos. El texto es texto
 * plano: React lo escapa, nunca se interpreta como HTML (constitución V).
 */
export function DetailCard({ detail }: { detail: Detail }) {
  return (
    <article className="space-y-2 rounded border p-3 text-sm">
      <dl className="space-y-1">
        <div>
          <dt className="inline font-semibold">Dado </dt>
          <dd className="inline">{detail.given}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Cuando </dt>
          <dd className="inline">{detail.when}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Entonces </dt>
          <dd className="inline">{detail.then}</dd>
        </div>
      </dl>
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-gray-600">
        <span>{DETAIL_TYPE_LABEL[detail.type]}</span>
        {detail.priority && <span>{PRIORITY_LABEL[detail.priority]}</span>}
        {detail.status !== 'pending' && <span>{DETAIL_STATUS_LABEL[detail.status]}</span>}
        {detail.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
      </p>
      <p className="text-gray-600">
        {detail.author.name}
        {detail.authorRole && ` · ${detail.authorRole}`} ·{' '}
        <time dateTime={detail.createdAt}>{dateFormat.format(new Date(detail.createdAt))}</time> ·{' '}
        {detail.voteCount} voto(s)
      </p>
    </article>
  );
}
