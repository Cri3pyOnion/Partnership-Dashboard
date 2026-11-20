import type { Repo } from './repo';

/**
 * A Repo that builds the real one on the first method call and reuses it afterwards.
 * Construction errors surface as a rejection of that call, never when the proxy is made.
 */
export function lazyRepo(make: () => Repo): Repo {
  let real: Repo | undefined;
  return new Proxy({} as Repo, {
    get(_target, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      return async (...args: unknown[]) => {
        real ??= make();
        const fn = (real as unknown as Record<string, (...a: unknown[]) => unknown>)[prop];
        return fn.apply(real, args);
      };
    },
  });
}
