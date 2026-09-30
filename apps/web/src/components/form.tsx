import type { InputHTMLAttributes, ReactNode } from 'react';
import type { FieldError, UseFormSetError, FieldValues, Path } from 'react-hook-form';
import { ApiError } from '../lib/api-client';

/** Campo con etiqueta y error accesible (el mensaje se anuncia con role="alert"). */
export function Field({
  label,
  error,
  ...input
}: { label: string; error?: FieldError } & InputHTMLAttributes<HTMLInputElement>) {
  const id = input.id ?? input.name;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        className="w-full rounded border px-3 py-2"
        {...input}
      />
      {error?.message && (
        <p role="alert" className="text-sm text-red-700">
          {error.message}
        </p>
      )}
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  );
}

/**
 * Lleva los errores de la API al formulario: los de campo (`fields`) a su campo y el resto como
 * mensaje general. Devuelve el mensaje general, si lo hay.
 */
export function applyApiError<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
): string {
  if (!(error instanceof ApiError))
    return 'No se pudo conectar con el servidor. Inténtalo de nuevo.';
  const fields = Object.entries(error.fields);
  for (const [name, message] of fields) setError(name as Path<T>, { message });
  return fields.length > 0 ? '' : error.message;
}
