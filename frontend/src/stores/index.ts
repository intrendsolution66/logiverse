import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { User, Notification } from "../types/index.js";

// ── Auth Store ────────────────────────────────────────────────────────────────
interface AuthStore {
  user:            User | null;
  accessToken:     string | null;
  refreshToken:    string | null;
  isAuthenticated: boolean;
  setAuth:  (user: User, accessToken: string, refreshToken: string) => void;
  setUser:  (user: User) => void;
  clearAuth:() => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user:            null,
      accessToken:     null,
      refreshToken:    null,
      isAuthenticated: false,
      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),
      setUser: (user) => set({ user }),
      clearAuth: () =>
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false }),
    }),
    {
      name: "lv-auth",
      partialize: (s) => ({
        user:         s.user,
        accessToken:  s.accessToken,
        refreshToken: s.refreshToken,
        isAuthenticated: s.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken) {
          localStorage.setItem("accessToken",  state.accessToken);
          localStorage.setItem("refreshToken", state.refreshToken ?? "");
        }
      },
    }
  )
);

// ── Theme Store ───────────────────────────────────────────────────────────────
interface ThemeStore {
  theme: "light" | "dark";
  toggleTheme: () => void;
  setTheme:    (t: "light" | "dark") => void;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: "dark",
      toggleTheme: () => set((s) => {
        const next = s.theme === "dark" ? "light" : "dark";
        applyTheme(next);
        return { theme: next };
      }),
      setTheme: (t) => {
        applyTheme(t);
        set({ theme: t });
      },
    }),
    { name: "lv-theme" }
  )
);

function applyTheme(t: "light" | "dark") {
  if (t === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

// ── Notification Store ────────────────────────────────────────────────────────
interface NotifStore {
  notifications:  Notification[];
  unreadCount:    number;
  setNotifications: (n: Notification[], count: number) => void;
  markRead:  (id: string)   => void;
  markAllRead:  ()          => void;
  addNotification:(n: Notification) => void;
}

export const useNotifStore = create<NotifStore>((set) => ({
  notifications: [],
  unreadCount:   0,
  setNotifications: (notifications, unreadCount) => set({ notifications, unreadCount }),
  markRead: (id) => set((s) => ({
    notifications: s.notifications.map((n) => n.id === id ? { ...n, is_read: true } : n),
    unreadCount:   Math.max(0, s.unreadCount - 1),
  })),
  markAllRead: () => set((s) => ({
    notifications: s.notifications.map((n) => ({ ...n, is_read: true })),
    unreadCount: 0,
  })),
  addNotification: (n) => set((s) => ({
    notifications: [n, ...s.notifications],
    unreadCount:   n.is_read ? s.unreadCount : s.unreadCount + 1,
  })),
}));

// ── UI Store (sidebar, modals) ────────────────────────────────────────────────
interface UIStore {
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  toggleSidebar:  () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  toggleSidebar:  ()  => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
