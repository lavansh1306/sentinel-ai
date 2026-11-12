"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, ApiError, readToken, writeToken, type User } from "./api";

interface Toast { id: number; tone: "ok" | "warn" | "error"; text: string }

interface Store {
  user: User | null;
  ready: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => void;
  selected: string | null;
  select: (id: string | null) => void;
  tick: number;                  // bump to make every panel refetch
  refresh: () => void;
  toasts: Toast[];
  toast: (text: string, tone?: Toast["tone"]) => void;
  can: (role: User["role"]) => boolean;
}

const Ctx = createContext<Store | null>(null);
const RANK = { viewer: 0, responder: 1, approver: 2 } as const;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    if (!readToken()) { setReady(true); return; }
    api<User>("/api/me").then(setUser).catch(() => writeToken(null)).finally(() => setReady(true));
  }, []);

  const toast = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const r = await api<{ token: string; user: User }>("/api/auth/login", { method: "POST", body: { username, password } });
    writeToken(r.token);
    setUser(r.user);
  }, []);

  const signOut = useCallback(() => { writeToken(null); setUser(null); }, []);

  const value: Store = {
    user, ready, signIn, signOut,
    selected, select: setSelected,
    tick, refresh: () => setTick((t) => t + 1),
    toasts, toast,
    can: (role) => !!user && RANK[user.role] >= RANK[role],
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
}

/** Fetch + optional polling; refetches whenever deps or the global tick change. */
export function useApi<T>(path: string | null, opts: { poll?: number; deps?: unknown[] } = {}) {
  const { tick, signOut } = useStore();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) signOut();
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [path, signOut]);

  useEffect(() => { load(); }, [load, tick, ...(opts.deps ?? [])]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!opts.poll || !path) return;
    const t = setInterval(load, opts.poll);
    return () => clearInterval(t);
  }, [load, opts.poll, path]);

  return { data, error, loading, reload: load, setData };
}
