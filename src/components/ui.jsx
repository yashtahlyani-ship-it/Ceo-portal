// Shared UI primitives, all built from the gx- design system so they match the
// Marketing Portal exactly. No new colours, no new fonts.
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { PRIORITY, STATUS, TONE } from '../lib/styles.js';
import { initials, colorFor } from '../lib/format.js';

export function Avatar({ name, color, size = 26 }) {
  const bg = color || colorFor(name || '');
  return (
    <span className="gx-avatar" style={{ width: size, height: size, background: bg, fontSize: size * 0.4 }}
      title={name}>{initials(name)}</span>
  );
}

export function PriorityBadge({ value }) {
  const p = PRIORITY[value] || PRIORITY.medium;
  return (
    <span className="gx-chip" style={{ background: p.bg, color: p.fg, cursor: 'default' }}>
      <span className="gx-dot" style={{ background: p.dot }} /> {p.label}
    </span>
  );
}

export function StatusBadge({ value, short = false }) {
  const s = STATUS[value] || STATUS.todo;
  return (
    <span className="gx-chip" style={{ background: s.bg, color: s.fg, cursor: 'default' }}>
      <span className="gx-dot" style={{ background: s.dot }} /> {short ? s.short : s.label}
    </span>
  );
}

export function DueChip({ meta }) {
  const c = TONE[meta.tier] || TONE.none;
  return <span className="gx-chip" style={{ background: c.bg, color: c.fg, cursor: 'default' }}>{meta.label}</span>;
}

export function Metric({ n, label, tone = 'ink', onClick, active = false }) {
  const ink = { ink: 'var(--ink)', done: 'var(--pop-deep)' };
  const color = ink[tone] || TONE[tone]?.fg || 'var(--ink)';
  return (
    <button className="gx-metric gx-focusable" onClick={onClick} disabled={!onClick}
      aria-pressed={onClick ? active : undefined}
      style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default', width: '100%',
        borderColor: active ? 'var(--pop)' : undefined,
        boxShadow: active ? '0 0 0 3px var(--pop-soft)' : undefined }}>
      <div className="gx-metric-n gx-disp" style={{ color }}>{n}</div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 600, marginTop: 6 }}>{label}</div>
    </button>
  );
}

export function Empty({ title, hint, icon: Icon }) {
  return (
    <div className="gx-empty">
      {Icon && <Icon size={30} strokeWidth={1.6} style={{ color: '#b9c9be', marginBottom: 10 }} />}
      <div className="gx-disp" style={{ fontSize: 16, color: 'var(--ink)', fontWeight: 700 }}>{title}</div>
      {hint && <div style={{ fontSize: 13, marginTop: 5, maxWidth: 320 }}>{hint}</div>}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', style }) {
  return <div className="gx-skel" style={{ height: h, width: w, ...style }} />;
}

export function Modal({ title, onClose, children, width = 560 }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="gx-scrim" onMouseDown={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(21,36,27,.28)', display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center', padding: '7vh 16px', zIndex: 60 }}>
      <div className="gx-card gx-fade" onMouseDown={(e) => e.stopPropagation()}
        style={{ width, maxWidth: '100%', maxHeight: '86vh', overflow: 'auto', padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, background: 'var(--surface)' }}>
          <div className="gx-disp" style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
          <button className="gx-btn gx-btn-ghost gx-focusable" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

/* A labelled form group.
   Deliberately NOT a <label>: several fields wrap more than one control (the
   priority chips, the assignee grid). A <label> may only be associated with a
   single form control — wrapping three buttons bound the caption to the first
   one, so clicking the word "Priority" silently selected High, and screen
   readers announced the group's caption as that button's name.
   role="group" + aria-label is the correct construct for a set of controls and
   still announces the caption. */
export function Field({ label, children, required }) {
  const caption = required ? `${label} (required)` : label;
  return (
    <div role="group" aria-label={caption} style={{ display: 'block', marginBottom: 15 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.03em' }}>
        {label}{required && <span style={{ color: '#C42424' }} aria-hidden="true"> *</span>}
      </div>
      {children}
    </div>
  );
}
