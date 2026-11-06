import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  tone: 'done' | 'problem';
  leaving: boolean;
}

interface ToastState {
  toasts: Toast[];
  show: (message: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
}

let next = 1;

/** Short confirmations after an action ("Club saved"). Errors stay inline where they happened. */
export const useToasts = create<ToastState>()((set, get) => ({
  toasts: [],
  show: (message, tone = 'done') => {
    const id = next++;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, tone, leaving: false }] }));
    setTimeout(() => get().dismiss(id), tone === 'done' ? 2600 : 5000);
  },
  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 200);
  },
}));

export const toast = (message: string, tone?: Toast['tone']) => useToasts.getState().show(message, tone);
