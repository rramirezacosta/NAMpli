/**
 * Tiny error/notification bus.
 *
 * The Tauri command wrappers are called from several components and hooks, and
 * the audio backend also reports stream errors asynchronously. Rather than
 * threading error state through every component, failures are published here
 * and displayed by the single `<Toast>` mounted in `App`.
 */

export interface Notice {
  id: number;
  message: string;
  kind: 'error' | 'success';
}

type Listener = (notice: Notice) => void;

let nextId = 1;
const listeners = new Set<Listener>();

function publish(message: string, kind: Notice['kind']): void {
  const notice: Notice = { id: nextId++, message, kind };
  for (const listener of listeners) {
    listener(notice);
  }
}

export function notifyError(message: string): void {
  publish(message, 'error');
}

export function notifySuccess(message: string): void {
  publish(message, 'success');
}

export function subscribeNotices(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
