import { useSyncExternalStore } from 'react';

export interface Store<T> {
  get: () => T;
  set: (next: T) => void;
  subscribe: (cb: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      subs.forEach((cb) => cb());
    },
    subscribe: (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}

export function useSelector<T, R>(store: Store<T>, select: (v: T) => R): R {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
