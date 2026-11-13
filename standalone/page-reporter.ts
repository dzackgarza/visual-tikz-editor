/**
 * Sends the uncaught errors, rejected promises, `console.error`, and `console.warn` of
 * one page frame to the file host's `/api/log`, which writes them to the launch log
 * (FR-066). The file host serves this function's source as a classic script at the top
 * of every HTML page, so it must reference nothing outside its own body, as a function
 * passed to Playwright's `page.evaluate` must.
 */
export function reportPageErrors(): void {
  const frame = location.pathname;
  // WebKit's Error.stack holds only the frames, so the name and message go first.
  const text = (value: unknown): string =>
    value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ""}` : String(value);
  const send = (level: string, message: string): void => {
    navigator.sendBeacon("/api/log", JSON.stringify({ level, frame, message }));
  };
  window.addEventListener("error", (event: ErrorEvent) => {
    send("error", event.error instanceof Error
      ? text(event.error)
      : `${event.message} (${event.filename}:${event.lineno}:${event.colno})`);
  });
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => send("error", `Unhandled rejection: ${text(event.reason)}`));
  for (const level of ["error", "warn"] as const) {
    const original = console[level];
    console[level] = (...values: unknown[]) => {
      send(level, values.map(text).join(" "));
      original.apply(console, values);
    };
  }
}
