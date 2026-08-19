import { useEffect, useState } from 'react';
import { Archive as ArchiveIcon, RotateCcw } from 'lucide-react';
import { api } from '../lib/api.js';
import { fmtDateTime } from '../lib/format.js';
import { PriorityBadge, Empty, Skeleton } from '../components/ui.jsx';

// Executive-only. Soft-deleted tasks, recoverable.
export default function Archive({ refresh }) {
  const [rows, setRows] = useState(null);
  const load = () => api.archivedTasks().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, []);

  const restore = async (id) => {
    await api.restoreTask(id);
    await load();
    refresh?.();
  };

  return (
    <div className="gx-fade">
      <h1 className="gx-disp" style={{ fontSize: 24, fontWeight: 800, margin: '0 0 3px' }}>Archive</h1>
      <p style={{ color: 'var(--ink-soft)', marginTop: 0, marginBottom: 20, fontSize: 13.5 }}>Archived tasks are hidden from the boards but never destroyed. Restore any at any time.</p>
      {rows === null
        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{[0, 1, 2].map((i) => <Skeleton key={i} h={52} />)}</div>
        : rows.length === 0
          ? <Empty icon={ArchiveIcon} title="Archive is empty" hint="Tasks you archive will appear here." />
          : (
            <div className="gx-card" style={{ padding: 0, overflow: 'hidden' }}>
              {rows.map((t) => (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderTop: '1px solid var(--line-soft)' }}>
                  <PriorityBadge value={t.priority} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{t.title}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-soft)' }}>Archived {fmtDateTime(t.archived_at)}</div>
                  </div>
                  <button className="gx-btn gx-btn-line gx-focusable" onClick={() => restore(t.id)}><RotateCcw size={14} /> Restore</button>
                </div>
              ))}
            </div>
          )}
    </div>
  );
}
