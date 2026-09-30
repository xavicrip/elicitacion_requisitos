import type { Session, SessionUser } from '@reqcanvas/shared';
import { create } from 'zustand';

type AuthState = {
  /** Access token: solo en memoria, nunca en localStorage (research R1, XSS). */
  accessToken: string | null;
  user: SessionUser | null;
  setSession(session: Session): void;
  clear(): void;
};

/** Sesión de la pestaña. Al recargar se recupera con la cookie `rt` (`refreshSession`). */
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setSession: ({ accessToken, user }) => set({ accessToken, user }),
  clear: () => set({ accessToken: null, user: null }),
}));
