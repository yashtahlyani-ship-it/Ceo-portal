import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, X, CalendarClock } from 'lucide-react';
import { api } from '../lib/api.js';
import { fmtDateTime } from '../lib/format.js';
import { Empty } from './ui.jsx';

/* CR-02 #5 — in-app notifications, scoped to the promised-date workflow only.
   Not comments, not edits, not column moves: the dashboard remains the
   monitoring mechanism for everything else (PRD §10), and this stays a queue
   nudge rather than a firehose.

   Polls rather than subscribing. At ~17 users and three event types the cost of
   a 60s poll is trivial, and it avoids a realtime connection that would need
   its own reconnect and auth-refresh handling for very little gain. */
const POLL_MS = 60_000;

const COPY = {
  promised_proposed: { icon: CalendarClock, verb: 'proposed a promised date on' },
  promised_confirmed: { icon: Check, verb: 'confirmed your promised date on' },
  promised_rejected: { icon: X, verb: 'did not accept your promised date on' },
};

export default function NotificationBell({ onOpenTask }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const btnRef = useRef(null);

  const load = useCallback(() => {
    api.notifications().then(setItems).catch((e) => {
      // A dropped poll is not worth interrupting anyone over, but it must not
      // vanish either: swallowing this silently is exactly how an ambiguous
      // PostgREST embed shipped looking like "no notifications yet".
      console.warn('[notifications] poll failed:', e.message);
    });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    // Catch up immediately when the tab comes back rather than waiting out the interval.
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const unread = items.filter((n) => !n.read_at).length;

  const openPanel = async () => {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      // Opening the panel IS reading them; mark server-side, and reflect it
      // locally so the badge clears without waiting for the next poll.
      try { await api.markNotificationsRead(); } catch { /* badge will clear on next poll */ }
      setItems((cur) => cur.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })));
    }
  };

  return (
    <div style={{ position: 'relative', flex: 'none' }}>
      <button ref={btnRef} className="gx-focusable" onClick={openPanel}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open} aria-haspopup="dialog"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-soft)',
          display: 'flex', alignItems: 'center', padding: 6, borderRadius: 9, position: 'relative' }}>
        <Bell size={17} />
        {unread > 0 && (
          <span className="gx-mono" aria-hidden="true"
            style={{ position: 'absolute', top: 0, right: 0, minWidth: 15, height: 15, padding: '0 3px',
              borderRadius: 99, background: '#C42424', color: '#fff', fontSize: 9.5, fontWeight: 700,
              display: 'grid', placeItems: 'center', lineHeight: 1 }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 60 }} />
          <div ref={panelRef} className="gx-card gx-fade" role="dialog" aria-label="Notifications"
            style={{ position: 'absolute', top: '125%', right: 0, zIndex: 61, width: 340,
              maxHeight: 420, overflowY: 'auto', padding: 0,
              boxShadow: '0 18px 50px -12px rgba(0,0,0,.32)' }}>
            <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--line)',
              fontWeight: 700, fontSize: 13, position: 'sticky', top: 0, background: 'var(--surface)' }}>
              Notifications
            </div>

            {items.length === 0 ? (
              <Empty title="Nothing yet"
                hint="You'll be told here when a promised date is proposed, confirmed or rejected." />
            ) : items.map((n) => {
              const c = COPY[n.kind] || { icon: Bell, verb: 'updated' };
              const Icon = c.icon;
              return (
                <button key={n.id} className="gx-row gx-focusable"
                  onClick={() => { setOpen(false); if (n.task?.id) onOpenTask(n.task.id); }}
                  style={{ display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%',
                    textAlign: 'left', padding: '11px 14px', borderTop: '1px solid var(--line-soft)',
                    background: n.read_at ? 'transparent' : 'var(--pop-soft)',
                    border: 'none', cursor: 'pointer' }}>
                  <Icon size={15} style={{ color: 'var(--ink-soft)', marginTop: 2, flex: 'none' }} aria-hidden="true" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                      <b>{n.actor?.name || 'Someone'}</b> {c.verb}{' '}
                      <b>{n.task?.title || 'a task'}</b>
                    </div>
                    {n.body && (
                      <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 3,
                        fontStyle: 'italic' }}>“{n.body}”</div>
                    )}
                    <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 3 }}>
                      {fmtDateTime(n.created_at)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
