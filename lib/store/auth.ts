'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PortalRole = 'STUDENT' | 'TEACHER' | 'TEACHING_ASSISTANT' | 'ADMIN';

function portalRole(role?: string): PortalRole {
  return role === 'ADMIN' || role === 'TEACHER' || role === 'TEACHING_ASSISTANT' ? role : 'STUDENT';
}

interface AuthState {
  isLoggedIn: boolean;
  userId: string;
  username: string;
  name: string;
  email: string;
  role: PortalRole;
  attributes: Record<string, string | number | boolean>;
  syncFromOAuth: (payload: {
    userId: string;
    name: string;
    email: string;
    role?: 'USER' | 'STUDENT' | 'TEACHER' | 'TEACHING_ASSISTANT' | 'ADMIN';
  }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isLoggedIn: false,
      userId: '',
      username: '',
      name: '',
      email: '',
      role: 'STUDENT',
      attributes: {},
      syncFromOAuth: ({ userId, name, email, role }) =>
        set({
          isLoggedIn: true,
          userId: userId.trim(),
          username: '',
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: portalRole(role),
          attributes: {},
        }),
      logout: () =>
        set({
          isLoggedIn: false,
          userId: '',
          username: '',
          name: '',
          email: '',
          role: 'STUDENT',
          attributes: {},
        }),
    }),
    {
      name: 'synatra-auth',
      version: 3,
      migrate: (persisted) => {
        const p = (persisted ?? {}) as Partial<AuthState>;
        return {
          isLoggedIn: false,
          userId: p.userId ?? '',
          username: p.username ?? '',
          name: p.name ?? '',
          email: p.email ?? '',
          role: portalRole(p.role),
          attributes: p.attributes ?? {},
        };
      },
      partialize: (s) => ({
        isLoggedIn: s.isLoggedIn,
        userId: s.userId,
        username: s.username,
        name: s.name,
        email: s.email,
        role: s.role,
        attributes: s.attributes,
      }),
    },
  ),
);
