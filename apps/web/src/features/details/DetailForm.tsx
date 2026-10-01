import { zodResolver } from '@hookform/resolvers/zod';
import {
  DetailInputSchema,
  DetailTypeSchema,
  PrioritySchema,
  type Facets,
} from '@reqcanvas/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { z } from 'zod';
import { applyApiError, FormError } from '../../components/form';
import { detailKeys, detailsApi } from './api';
import { DETAIL_TYPE_LABEL, PRIORITY_LABEL } from './labels';

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

/** Alta de un detalle Dado/Cuando/Entonces con tipo, prioridad, rol y etiquetas (FR-002, FR-003). */
export function DetailForm({
  projectId,
  diagramId,
  activityKey,
  facets,
}: {
  projectId: string;
  diagramId: string;
  activityKey: string;
  facets: Facets | undefined;
}) {
  const queryClient = useQueryClient();
  const typeId = useId();
  const priorityId = useId();
  const roleId = useId();
  const rolesListId = useId();
  const tagsId = useId();
  const [error, setError] = useState('');
  const form = useForm<FormValues>({ resolver: zodResolver(FormSchema), defaultValues: EMPTY });
  const values = form.watch();
  const errors = form.formState.errors;

  const create = useMutation({
    mutationFn: (input: FormValues) =>
      detailsApi.create(diagramId, activityKey, {
        given: input.given,
        when: input.when,
        then: input.then,
        type: input.type,
        priority: input.priority || null,
        authorRole: input.authorRole.trim() || null,
        tags: splitTags(input.tags),
      }),
    onSuccess: async () => {
      setError('');
      form.reset(EMPTY);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: detailKeys.activity(diagramId, activityKey) }),
        queryClient.invalidateQueries({ queryKey: detailKeys.facets(projectId) }),
      ]);
    },
    onError: (err) => setError(applyApiError(err, form.setError)),
  });

  const addTag = (tag: string) => {
    const tags = splitTags(values.tags);
    if (!tags.includes(tag)) form.setValue('tags', [...tags, tag].join(', '));
  };

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((input) => create.mutate(input))}
      className="space-y-3 border-t pt-3 text-sm"
      aria-label="Nuevo requisito"
    >
      <h3 className="font-semibold">Nuevo requisito</h3>
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
      <button
        type="submit"
        disabled={create.isPending}
        className="rounded bg-blue-700 px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        Guardar requisito
      </button>
    </form>
  );
}
