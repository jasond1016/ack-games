export function createResourceLeaseCache({ load, dispose = () => {}, retainUnused = true }) {
  const entries = new Map();

  async function acquire(key, input) {
    let entry = entries.get(key);
    if (!entry) {
      entry = { leases: 0, value: null, promise: null };
      entry.promise = Promise.resolve(load(input)).then((value) => {
        entry.value = value;
        return value;
      });
      entries.set(key, entry);
    }

    entry.leases += 1;
    let released = false;
    try {
      const value = await entry.promise;
      return Object.freeze({
        value,
        release() {
          if (released) return;
          released = true;
          entry.leases = Math.max(0, entry.leases - 1);
          if (!retainUnused && entry.leases === 0) {
            entries.delete(key);
            dispose(entry.value);
          }
        }
      });
    } catch (error) {
      entry.leases = Math.max(0, entry.leases - 1);
      if (entry.leases === 0) entries.delete(key);
      throw error;
    }
  }

  async function clear() {
    const disposable = [...entries.values()];
    entries.clear();
    await Promise.all(disposable.map(async (entry) => {
      try {
        const value = await entry.promise;
        dispose(value);
      } catch {
        // A failed load owns no resource.
      }
    }));
  }

  return Object.freeze({ acquire, clear, has: (key) => entries.has(key) });
}
