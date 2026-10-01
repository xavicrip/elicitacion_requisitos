import type { Comment } from '@reqcanvas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { FormError } from '../../components/form';
import { ApiError } from '../../lib/api-client';
import { detailKeys, detailsApi } from './api';

const dateFormat = new Intl.DateTimeFormat('es', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});

const message = (error: unknown, fallback: string) =>
  error instanceof ApiError ? error.message : fallback;

function CommentItem({
  comment,
  onChanged,
}: {
  comment: Comment;
  onChanged: () => Promise<unknown>;
}) {
  const fieldId = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.text);
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: () => detailsApi.editComment(comment.id, text),
    onSuccess: async () => {
      setEditing(false);
      setError('');
      await onChanged();
    },
    onError: (err) => setError(message(err, 'No se pudo guardar el comentario.')),
  });
  const remove = useMutation({
    mutationFn: () => detailsApi.removeComment(comment.id),
    onSuccess: onChanged,
    onError: (err) => setError(message(err, 'No se pudo eliminar el comentario.')),
  });

  return (
    <li className="space-y-1 border-l-2 pl-2">
      <p className="text-xs text-gray-600">
        {comment.author.name} ·{' '}
        <time dateTime={comment.createdAt}>{dateFormat.format(new Date(comment.createdAt))}</time>
        {comment.editedAt && ' · editado'}
      </p>
      {editing ? (
        <div className="space-y-1">
          <label htmlFor={fieldId} className="sr-only">
            Editar comentario
          </label>
          <textarea
            id={fieldId}
            value={text}
            maxLength={1000}
            onChange={(event) => setText(event.target.value)}
            className="w-full rounded border px-2 py-1"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => save.mutate()}
              className="rounded bg-blue-700 px-2 py-1 text-white"
            >
              Guardar comentario
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded border px-2 py-1"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <p>{comment.text}</p>
      )}
      <div className="flex gap-2 text-xs">
        {comment.permissions.canEdit && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="underline">
            Editar comentario
          </button>
        )}
        {comment.permissions.canDelete && (
          <button type="button" onClick={() => remove.mutate()} className="text-red-700 underline">
            Eliminar comentario
          </button>
        )}
      </div>
      <FormError>{error}</FormError>
    </li>
  );
}

/** Comentarios de un detalle (FR-009): lista, edición y borrado propios, y alta si está abierto. */
export function Comments({ detailId, canComment }: { detailId: string; canComment: boolean }) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const comments = useQuery({
    queryKey: detailKeys.comments(detailId),
    queryFn: () => detailsApi.comments(detailId),
  });
  // También cambia commentCount del detalle.
  const refresh = () => queryClient.invalidateQueries({ queryKey: detailKeys.all });
  const publish = useMutation({
    mutationFn: () => detailsApi.comment(detailId, text),
    onSuccess: async () => {
      setText('');
      setError('');
      await refresh();
    },
    onError: (err) => setError(message(err, 'No se pudo publicar el comentario.')),
  });

  return (
    <div className="space-y-2 border-t pt-2">
      {comments.isLoading && <p>Cargando…</p>}
      <ul aria-label="Comentarios" className="space-y-2">
        {comments.data?.map((comment) => (
          <CommentItem key={comment.id} comment={comment} onChanged={refresh} />
        ))}
      </ul>
      {canComment && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) publish.mutate();
          }}
          className="space-y-1"
        >
          <label htmlFor={fieldId} className="block font-medium">
            Nuevo comentario
          </label>
          <textarea
            id={fieldId}
            value={text}
            maxLength={1000}
            onChange={(event) => setText(event.target.value)}
            className="w-full rounded border px-2 py-1"
          />
          <FormError>{error}</FormError>
          <button
            type="submit"
            disabled={publish.isPending || !text.trim()}
            className="rounded bg-blue-700 px-3 py-1 text-white disabled:opacity-50"
          >
            Publicar
          </button>
        </form>
      )}
    </div>
  );
}
