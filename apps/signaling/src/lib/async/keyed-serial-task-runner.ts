import { AsyncLocalStorage } from "node:async_hooks";

export class KeyedSerialTaskRunner {
  private readonly tailByKey = new Map<string, Promise<void>>();
  private readonly activeKeysByContext = new AsyncLocalStorage<Set<string>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const activeKeys = this.activeKeysByContext.getStore();

    if (activeKeys?.has(key)) {
      return await task();
    }

    const previousTail = this.tailByKey.get(key) ?? Promise.resolve();
    let releaseCurrentTail!: () => void;
    const currentTail = new Promise<void>((resolve) => {
      releaseCurrentTail = resolve;
    });
    const chainedTail = previousTail.catch(() => undefined).then(() => currentTail);

    this.tailByKey.set(key, chainedTail);

    await previousTail.catch(() => undefined);

    const nextActiveKeys = new Set(activeKeys ?? []);
    nextActiveKeys.add(key);

    try {
      return await this.activeKeysByContext.run(nextActiveKeys, task);
    } finally {
      releaseCurrentTail();

      if (this.tailByKey.get(key) === chainedTail) {
        this.tailByKey.delete(key);
      }
    }
  }
}
