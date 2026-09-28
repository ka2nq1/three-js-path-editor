export type Listener<T> = (payload: T) => void;

/** Minimal typed event emitter. `on()` returns an unsubscribe function. */
export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();

  on<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(type, listener);
  }

  once<K extends keyof Events>(type: K, listener: Listener<Events[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, listener: Listener<Events[K]>): void {
    this.listeners.get(type)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) (listener as Listener<Events[K]>)(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}
