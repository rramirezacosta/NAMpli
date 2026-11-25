/** True when running inside the Tauri webview (native APIs/events available). */
export const isTauri = (): boolean => '__TAURI_INTERNALS__' in window;

/** Extract the file name from a path reported by a dialog or a native drop event. */
export const fileNameFromPath = (path: string): string =>
  path.split(/[\\/]/).pop() ?? path;
