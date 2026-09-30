import { zodResolver } from '@hookform/resolvers/zod';
import { LoginInputSchema, type LoginInput, type Session } from '@reqcanvas/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { applyApiError, Field, FormError } from '../../components/form';
import { apiFetch } from '../../lib/api-client';
import { useAuthStore } from '../../lib/auth-store';
import { safeRedirect } from './redirect';

export function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [formError, setFormError] = useState('');
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginInputSchema) });

  const onSubmit = handleSubmit(async (input) => {
    setFormError('');
    try {
      const session = await apiFetch<Session>('/auth/login', { method: 'POST', body: input });
      useAuthStore.getState().setSession(session);
      navigate(safeRedirect(params.get('redirect')));
    } catch (error) {
      setFormError(applyApiError(error, setError));
    }
  });

  return (
    <section className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold">Iniciar sesión</h1>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormError>{formError}</FormError>
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
          autoComplete="current-password"
          error={errors.password}
          {...register('password')}
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded bg-blue-700 py-2 font-medium text-white disabled:opacity-60"
        >
          Entrar
        </button>
      </form>
      <p className="text-sm">
        ¿No tienes cuenta? <Link to="/registro">Crea una</Link>
      </p>
    </section>
  );
}
