import { useEffect, useState } from "react";
import type { DraftEntry, ShowSession } from "./types";
import { buildInitialSessions } from "./data";

const STORAGE_KEY = "load-bench:v1";

export interface PersistState {
  sessions: ShowSession[];
  drafts: Record<string, DraftEntry[]>;
  activeSessionId: string;
}

export function defaultState(): PersistState {
  const sessions = buildInitialSessions();
  return {
    sessions,
    drafts: {},
    activeSessionId: sessions[0].id,
  };
}

function loadState(): PersistState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<PersistState>;
    if (!Array.isArray(parsed.sessions) || parsed.sessions.length === 0) {
      return defaultState();
    }
    return {
      sessions: parsed.sessions as ShowSession[],
      drafts: (parsed.drafts ?? {}) as Record<string, DraftEntry[]>,
      activeSessionId:
        typeof parsed.activeSessionId === "string" &&
        parsed.sessions.some((s) => s.id === parsed.activeSessionId)
          ? parsed.activeSessionId
          : parsed.sessions[0].id,
    };
  } catch {
    return defaultState();
  }
}

export function usePersistentState(): {
  state: PersistState;
  setState: React.Dispatch<React.SetStateAction<PersistState>>;
  savedAt: number | null;
} {
  const [state, setState] = useState<PersistState>(loadState);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      setSavedAt(Date.now());
    } catch {
      // 存储不可用时静默降级为内存态
    }
  }, [state]);

  return { state, setState, savedAt };
}
