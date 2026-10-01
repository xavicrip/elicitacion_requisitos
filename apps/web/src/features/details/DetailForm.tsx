import { zodResolver } from '@hookform/resolvers/zod';
import {
  DetailInputSchema,
  DetailTypeSchema,
  PrioritySchema,
  type Detail,
  type DetailInput,
  type Facets,
} from '@reqcanvas/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useId, useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';
import { applyApiError, FormError } from '../../components/form';
import { ApiError } from '../../lib/api-client';
import { detailKeys, detailsApi } from './api';
import { DETAIL_TYPE_LABEL, PRIORITY_LABEL } from './labels';

// `diff` solo se descarga si hay un conflicto.
const ConflictDialog = lazy(() => import('./ConflictDialog'));

const MAX_LENGTH = 1000;
/** A partir de aquí se muestra el contador de caracteres. */
const COUNTER_FROM = 900;

const FormSchema = z.object({
  given: DetailInputSchema.shape.given,
  when: DetailInputSchema.shape.when,
  then: DetailInputSchema.shape.then,
  type: DetailTypeSchema,
  priority: z.union([PrioritySchema, z.literal('')]),
  authorRole: z.string().max(60, { error: 'El rol admite como máximo 60 caracteres.' }),
  tags: z.string(),
});
type FormValues = z.infer<typeof FormSchema>;

const EMPTY: FormValues = {
  given: '',
  when: '',
  then: '',
  type: 'functional',
  priority: '',
  authorRole: '',
  tags: '',
};

const splitTags = (text: string) =>
  text
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

const toInput = (values: FormValues): DetailInput => ({
  given: values.given,
  when: values.when,
  then: values.then,
  type: values.type,
  priority: values.priority || null,
  authorRole: values.authorRole.trim() || null,
  tags: splitTags(values.tags),
});

const fromDetail = (detail: Detail): FormValues => ({
  given: detail.given,
  when: detail.when,
  then: detail.then,
  type: detail.type,
  priority: detail.priority ?? '',
  authorRole: detail.authorRole ?? '',
  tags: detail.tags.join(', '),
});

/** Un 409 de PATCH trae el detalle actual; el de un proyecto no abierto trae `code`. */
const conflictOf = (error: unknown): Detail | null =>
  error instanceof ApiError &&
  error.status === 409 &&
  error.body &&
  !(error.body as { code?: string }).code
    ? (error.body as Detail)
    : null;

function ScenarioField({
  label,
  value,
  error,
  registration,
}: {
  label: string;
  value: string;
  error?: string;
  registration: UseFormRegisterReturn;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-medium">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={MAX_LENGTH}
        aria-invalid={error ? true : undefined}
        className="w-full rounded border px-2 py-1"
        {...registration}
      />
      {value.length >= COUNTER_FROM && (
        <p aria-live="polite" className="text-right text-xs text-gray-600">
          {value.length}/{MAX_LENGTH}
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Alta o edición de un detalle Dado/Cuando/Entonces con tipo, prioridad, rol y etiquetas
 * (FR-002, FR-003). En edición, un 409 abre la comparación con la versión actual (FR-007).
 */
export function DetailForm({
  projectId,
  diagramId,
  activityKey,
  facets,
  detail,
  onDone,
}: {
  projectId: string;
  diagramId: string;
  activityKey: string;
  facets: Facets | undefined;
  /** Detalle que se edita; sin él, el formulario da de alta uno nuevo. */
  detail?: Detail;
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const typeId = useId();
  const priorityId = useId();
  const roleId = useId();
  const rolesListId = useId();
  const tagsId = useId();
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<{ mine: DetailInput; current: Detail } | null>(null);
  const editing = Boolean(detail);
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: detail ? fromDetail(detail) : EMPTY,
  });
  const values = form.watch();
  const errors = form.formState.errors;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: detailKeys.activity(diagramId, activityKey) }),
      queryClient.invalidateQueries({ queryKey: detailKeys.facets(projectId) }),
    ]);

  const save = useMutation({
    mutationFn: ({ input, rev }: { input: DetailInput; rev?: number }) =>
      detail
        ? detailsApi.update(detail.id, rev ?? detail.rev, input)
        : detailsApi.create(diagramId, activityKey, input),
    onSuccess: async () => {
      setError('');
      setConflict(null);
      if (!editing) form.reset(EMPTY);
      await refresh();
      onDone?.();
    },
    onError: (err, { input }) => {
      const current = conflictOf(err);
      if (current) setConflict({ mine: input, current });
      else setError(applyApiError(err, form.setError));
    },
  });

  const addTag = (tag: string) => {
    const tags = splitTags(values.tags);
    if (!tags.includes(tag)) form.setValue('tags', [...tags, tag].join(', '));
  };

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => save.mutate({ input: toInput(values) }))}
      className={editing ? 'space-y-3 text-sm' : 'space-y-3 border-t pt-3 text-sm'}
      aria-label={editing ? 'Editar requisito' : 'Nuevo requisito'}
    >
      <h3 className="font-semibold">{editing ? 'Editar requisito' : 'Nuevo requisito'}</h3>
      <ScenarioField
        label="Dado (contexto)"
        value={values.given}
        error={errors.given?.message}
        registration={form.register('given')}
      />
      <ScenarioField
        label="Cuando (acción)"
        value={values.when}
        error={errors.when?.message}
        registration={form.register('when')}
      />
      <ScenarioField
        label="Entonces (resultado)"
        value={values.then}
        error={errors.then?.message}
        registration={form.register('then')}
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label htmlFor={typeId} className="block font-medium">
            Tipo
          </label>
          <select
            id={typeId}
            className="w-full rounded border px-2 py-1"
            {...form.register('type')}
          >
            {Object.entries(DETAIL_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={priorityId} className="block font-medium">
            Prioridad
          </label>
          <select
            id={priorityId}
            className="w-full rounded border px-2 py-1"
            {...form.register('priority')}
          >
            <option value="">Sin prioridad</option>
            {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <label htmlFor={roleId} className="block font-medium">
          Tu rol
        </label>
        <input
          id={roleId}
          list={rolesListId}
          maxLength={60}
          className="w-full rounded border px-2 py-1"
          {...form.register('authorRole')}
        />
        <datalist id={rolesListId}>
          {facets?.roles.map((role) => (
            <option key={role.value} value={role.value} />
          ))}
        </datalist>
      </div>
      <div className="space-y-1">
        <label htmlFor={tagsId} className="block font-medium">
          Etiquetas (separadas por comas)
        </label>
        <input id={tagsId} className="w-full rounded border px-2 py-1" {...form.register('tags')} />
        {facets && facets.tags.length > 0 && (
          <p className="flex flex-wrap gap-1">
            {facets.tags.slice(0, 8).map(({ value }) => (
              <button
                key={value}
                type="button"
                aria-label={`Añadir la etiqueta ${value}`}
                onClick={() => addTag(value)}
                className="rounded bg-gray-100 px-2 py-0.5 text-xs"
              >
                #{value}
              </button>
            ))}
          </p>
        )}
      </div>
      <FormError>{error}</FormError>
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {editing ? 'Guardar cambios' : 'Guardar requisito'}
        </button>
        {editing && (
          <button type="button" onClick={onDone} className="rounded border px-4 py-2">
            Cancelar
          </button>
        )}
      </div>
      {conflict && (
        <Suspense fallback={null}>
          <ConflictDialog
            mine={conflict.mine}
            current={conflict.current}
            saving={save.isPending}
            onKeepMine={() => save.mutate({ input: conflict.mine, rev: conflict.current.rev })}
            onUseCurrent={async () => {
              setConflict(null);
              await refresh();
              onDone?.();
            }}
          />
        </Suspense>
      )}
    </form>
  );
}
