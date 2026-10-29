/** Observers are diagnostics and must never change a remote operation's outcome. */
export function emit<T>(observer: ((event: T) => void) | undefined, event: T) {
  try {
    void Promise.resolve(observer?.(event)).catch(() => {})
  } catch {
    // A broken observer must not cause a successful write to look unsuccessful.
  }
}
