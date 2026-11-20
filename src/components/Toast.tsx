import { useEffect, useState } from 'react';
import { subscribeNotices, type Notice } from '../notifications';
import './Toast.css';

/** Fixed-position banner stack for backend/audio errors. */
export default function Toast() {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => {
    const timers = new Set<number>();

    const unsubscribe = subscribeNotices((notice) => {
      // Keep the newest three so a burst of errors cannot cover the UI.
      setNotices((prev) => [...prev.slice(-2), notice]);
      const timer = window.setTimeout(() => {
        setNotices((prev) => prev.filter((n) => n.id !== notice.id));
        timers.delete(timer);
      }, 8000);
      timers.add(timer);
    });

    return () => {
      unsubscribe();
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  if (notices.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {notices.map((notice) => (
        <div key={notice.id} className={`toast ${notice.kind}`}>
          <span className={`toast-icon ${notice.kind}`}>
            {notice.kind === 'success' ? '✓' : '!'}
          </span>
          <span className="toast-message">{notice.message}</span>
          <button
            className="toast-close"
            onClick={() => setNotices((prev) => prev.filter((n) => n.id !== notice.id))}
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
