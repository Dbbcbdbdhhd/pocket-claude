import AsyncStorage from '@react-native-async-storage/async-storage';
import { createStore, useSelector } from './store';

const KEY = 'pc.lastOpened';

const opened = createStore<Record<string, number>>({});
let hydrated: Promise<void> | null = null;

function hydrate(): Promise<void> {
  hydrated ??= AsyncStorage.getItem(KEY).then(
    (raw) => {
      if (raw) opened.set({ ...(JSON.parse(raw) as Record<string, number>), ...opened.get() });
    },
    () => {},
  );
  return hydrated;
}

export function markOpened(sessionId: string): void {
  void hydrate().then(() => {
    opened.set({ ...opened.get(), [sessionId]: Date.now() });
    void AsyncStorage.setItem(KEY, JSON.stringify(opened.get())).catch(() => {});
  });
}

export function useLastOpened(sessionId: string): number {
  void hydrate();
  return useSelector(opened, (m) => m[sessionId] ?? 0);
}
