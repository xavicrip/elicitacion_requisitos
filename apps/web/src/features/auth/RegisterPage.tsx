import { zodResolver } from '@hookform/resolvers/zod';
import { RegisterInputSchema, type RegisterInput, type Session } from '@reqcanvas/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import { applyApiError, Field, FormError } from '../../components/form';
import { apiFetch } from '../../lib/api-client';
import { useAuthStore } from '../../lib/auth-store';

export function RegisterPage() {
  const navigate = useNavigate();
  const [formError, setFormError] = useState('');
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({ resolver: zodResolver(RegisterInputSchema) });

  const onSubmit = handleSubmit(async (input) => {
    setFormError('');
    try {
      const session = await apiFetch<Session>('/auth/register', { method: 'POST', body: input });
      useAuthStore.getState().setSession(session);
      navigate('/proyectos');
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  return (
    <section className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold">Crear cuenta</h1>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError>{formError}</FormError>
        <Field label="Nombre" autoComplete="name" error={errors.name} {...register('name')} />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email}
          {...register('email')}
        />
        <Field
          label="Contraseña"
          type="password"
          autoComplete="new-password"
          error={errors.password}
          {...register('password')}
        />
        <p className="text-xs text-gray-600">Mínimo 10 caracteres. Evita contraseñas comunes.</p>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded bg-blue-700 py-2 font-medium text-white disabled:opacity-60"
        >
          Crear cuenta
        </button>
      </form>
      <p className="text-sm">
        ¿Ya tienes cuenta? <Link to="/entrar">Inicia sesión</Link>
      </p>
    </section>
  );
}
