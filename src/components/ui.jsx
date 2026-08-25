// Shared UI primitives, all built from the gx- design system so they match the
// Marketing Portal exactly. No new colours, no new fonts.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

/* A dropdown anchored to a trigger button.
   Positioned FIXED, not absolute. An absolutely-positioned menu inside a Kanban
   card is laid out relative to that card, so on a card near the bottom of a long
   column the menu ran off the viewport and most of its options were unreachable.
   Fixed coordinates measured from the trigger let it flip above when there is no
   room below, and stay clamped inside the window either way.

   It is also rendered through a PORTAL to <body>. That is not cosmetic: any
   ancestor with a `transform` becomes the containing block for `position: fixed`
   descendants, and these cards carry one from the gx-stagger entrance animation
   and from :hover. Without the portal the menu was offset by the card's position
   — computed top 506px, actually painted at 991px, i.e. off the bottom of the
   screen. The portal takes it out of that subtree so viewport coordinates mean
   what they say.

   Because the anchor can move, the menu closes on scroll and on resize rather
   than drifting away from the button it belongs to. */
export function Dropdown({ label, ariaLabel, children, width = 190, disabled }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const place = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect();
    if (!b) return;
    const gap = 6;
    // Measure the menu if it is already up; otherwise estimate from the item
    // count so the first paint is not visibly wrong.
    const h = menuRef.current?.offsetHeight || 44 * React.Children.count(children) + 12;
    const below = window.innerHeight - b.bottom - gap;
    const flip = below < h && b.top > below;      // more room above than below
    const top = flip ? Math.max(8, b.top - gap - h) : b.bottom + gap;
    const left = Math.min(Math.max(8, b.left), window.innerWidth - width - 8);
    setPos({ top, left, maxHeight: flip ? b.top - gap - 8 : below });
  }, [children, width]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); } };
    // `true` — catch scrolling on any ancestor, not just the window.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button ref={btnRef} className="gx-btn gx-btn-line gx-focusable" disabled={disabled}
        aria-expanded={open} aria-haspopup="menu" aria-label={ariaLabel}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        style={{ padding: '5px 9px', fontSize: 11.5, fontWeight: 700, gap: 5 }}>
        {label}
      </button>
      {open && createPortal(
        /* .gx-root here is load-bearing, not decoration. The design tokens
           (--surface, --line, --ink…) are declared on .gx-root, and the portal
           lands on <body> — outside it. Without this wrapper every var() in the
           menu resolves to nothing and it paints transparent, with the card
           showing straight through. */
        <div className="gx-root">
          <div onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            style={{ position: 'fixed', inset: 0, zIndex: 80 }} />
          <div ref={menuRef} className="gx-card gx-fade" role="menu" onClick={(e) => e.stopPropagation()}
            style={{ position: 'fixed', zIndex: 81, padding: 6, width,
              top: pos?.top ?? -9999, left: pos?.left ?? -9999,
              maxHeight: pos?.maxHeight, overflowY: 'auto',
              boxShadow: '0 18px 50px -12px rgba(0,0,0,.35)' }}
            onKeyDown={(e) => {
              const items = [...e.currentTarget.querySelectorAll('[role="menuitem"]')];
              const i = items.indexOf(document.activeElement);
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const n = e.key === 'ArrowDown' ? (i + 1) % items.length
                  : (i <= 0 ? items.length - 1 : i - 1);
                items[n]?.focus();
              }
            }}>
            {typeof children === 'function' ? children(() => setOpen(false)) : children}
          </div>
        </div>,
        document.body
      )}
    </>
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
