import { z } from 'zod';

/**
 * Política de contraseña (FR-002, research R3). La comprobación contra la lista de
 * contraseñas comunes solo se hace en `api`, que es quien tiene la lista.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Escribe un email válido.' }));

/** Cuerpo de POST /auth/register (contracts/auth-projects.openapi.yaml). */
export const RegisterInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'Escribe tu nombre.' })
    .max(80, { error: 'El nombre admite como máximo 80 caracteres.' }),
  email: EmailSchema,
  // Sin trim: los espacios forman parte de la contraseña.
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, {
      error: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
    })
    .max(PASSWORD_MAX_LENGTH, {
      error: `La contraseña admite como máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
    }),
});

/** Cuerpo de POST /auth/login. No aplica la política: solo se comprueba el hash. */
export const LoginInputSchema = z.object({
  email: EmailSchema,
  password: z
    .string()
    .min(1, { error: 'Escribe tu contraseña.' })
    .max(PASSWORD_MAX_LENGTH, { error: 'Email o contraseña incorrectos' }),
});

/** Usuario de la sesión (`User` del contrato). Nunca incluye datos de la credencial. */
export const SessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

/** Respuesta de register, login y refresh. */
export const SessionSchema = z.object({
  accessToken: z.string(),
  /** Segundos hasta que caduca el access token. */
  expiresIn: z.number().int().positive(),
  user: SessionUserSchema,
});

export type RegisterInput = z.infer<typeof RegisterInputSchema>;
export type LoginInput = z.infer<typeof LoginInputSchema>;
export type SessionUser = z.infer<typeof SessionUserSchema>;
export type Session = z.infer<typeof SessionSchema>;
