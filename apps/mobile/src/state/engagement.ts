import { createStore, useSelector } from './store';

const liked = createStore<Record<string, boolean>>({});
const saved = createStore<Record<string, boolean>>({});
export const mutedStore = createStore(true);

export function useLiked(id: string, initial: boolean): [boolean, (next?: boolean) => void] {
  const value = useSelector(liked, (m) => m[id] ?? initial);
  const set = (next?: boolean) => liked.set({ ...liked.get(), [id]: next ?? !(liked.get()[id] ?? initial) });
  return [value, set];
}

export function useSaved(id: string): [boolean, () => void] {
  const value = useSelector(saved, (m) => m[id] ?? false);
  return [value, () => saved.set({ ...saved.get(), [id]: !(saved.get()[id] ?? false) })];
}

export function useMuted(): [boolean, () => void] {
  const value = useSelector(mutedStore, (m) => m);
  return [value, () => mutedStore.set(!mutedStore.get())];
}
