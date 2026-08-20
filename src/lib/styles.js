/* ─── lib/styles.js ───
   The Gyftr design system, carried over verbatim from the Marketing Portal
   (gyftr-portal/frontend/src/lib/styles.js) so the CEO Office platform reads
   as the same internal product. Everything below the "CEO OFFICE ADDITIONS"
   marker is new, but uses only the existing tokens — no new palette, no new
   fonts, no gradients. Light theme only, exactly like the sibling tools. */
export const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
*{box-sizing:border-box}
.gx-root{
  --paper:#F3F6F2; --surface:#FFFFFF; --ink:#15241B; --ink-soft:#586860;
  --line:#E1EAE3; --line-soft:#EEF4EF; --pop:#62A92A; --pop-deep:#4C8A1E; --pop-soft:#EDF6D9;
  --font-d:'Bricolage Grotesque',sans-serif; --font-b:'Hanken Grotesk',sans-serif; --font-m:'JetBrains Mono',monospace;
  font-family:var(--font-b); color:var(--ink); background:var(--paper);
  -webkit-font-smoothing:antialiased; letter-spacing:-0.005em;
}
.gx-root *::-webkit-scrollbar{width:10px;height:10px}
.gx-root *::-webkit-scrollbar-thumb{background:#cbd6cd;border-radius:9px;border:2px solid transparent;background-clip:content-box}
.gx-root *::-webkit-scrollbar-track{background:transparent}
.gx-disp{font-family:var(--font-d);letter-spacing:-0.02em}
.gx-mono{font-family:var(--font-m);font-feature-settings:"tnum"}
.gx-btn{font-family:var(--font-b);font-weight:600;border:none;cursor:pointer;border-radius:10px;transition:transform .12s,box-shadow .12s,background .12s}
.gx-btn:active{transform:translateY(1px)}
.gx-btn:disabled{opacity:.5;cursor:not-allowed}
.gx-btn-dark{background:var(--pop);color:#fff;padding:9px 15px;display:inline-flex;align-items:center;gap:7px;font-size:13.5px}
.gx-btn-dark:hover:not(:disabled){background:var(--pop-deep);box-shadow:0 6px 18px -6px rgba(76,138,30,.55)}
.gx-btn-ghost{background:transparent;color:var(--ink-soft);padding:8px 12px;display:inline-flex;align-items:center;gap:7px;font-size:13.5px;border-radius:9px}
.gx-btn-ghost:hover:not(:disabled){background:#E6EFE7;color:var(--ink)}
.gx-btn-line{background:var(--surface);color:var(--ink);border:1px solid var(--line);padding:8px 13px;display:inline-flex;align-items:center;gap:7px;font-size:13.5px}
.gx-btn-line:hover:not(:disabled){border-color:var(--pop);color:var(--pop-deep)}
.gx-chip{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:12px;padding:5px 11px;border-radius:999px;white-space:nowrap;border:none;cursor:pointer;font-family:var(--font-b)}
.gx-card{background:var(--surface);border:1px solid var(--line);border-radius:16px}
.gx-row:hover{background:#F4F8F4}
.gx-navitem{display:flex;align-items:center;gap:11px;padding:8px 14px;border-radius:11px;color:var(--ink-soft);font-weight:600;font-size:13.5px;cursor:pointer;transition:.12s}
.gx-navitem:hover{background:#E6EFE7;color:var(--ink)}
.gx-navitem.on{background:var(--pop);color:#fff}
.gx-navitem.on svg{color:#fff}
.gx-input{font-family:var(--font-b);font-size:13.5px;color:var(--ink);background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:9px 12px;outline:none;width:100%}
.gx-input:focus{border-color:var(--pop);box-shadow:0 0 0 3px var(--pop-soft)}
.gx-input::placeholder{color:#9fb0a6}
.gx-cellinput{font-family:var(--font-b);font-size:13px;color:var(--ink);background:transparent;border:1px solid transparent;border-radius:7px;padding:6px 8px;outline:none;width:100%}
.gx-cellinput:hover{background:#F1F6F1}
.gx-cellinput:focus{background:#fff;border-color:var(--pop);box-shadow:0 0 0 3px var(--pop-soft)}
.gx-sel{font-family:var(--font-b);font-size:12.5px;color:var(--ink);background:transparent;border:1px solid transparent;border-radius:7px;padding:6px 20px 6px 7px;outline:none;width:100%;appearance:none;cursor:pointer}
.gx-sel:hover{background:#F1F6F1}
.gx-sel:focus{background:#fff;border-color:var(--pop)}
.gx-th{font-family:var(--font-b);font-weight:700;font-size:10px;letter-spacing:.03em;text-transform:uppercase;color:var(--ink-soft);text-align:left;padding:9px 8px;white-space:nowrap;background:#EEF4EF}
.gx-td{padding:5px 7px;font-size:12.5px;vertical-align:middle;border-top:1px solid var(--line-soft);border-right:1px solid var(--line-soft)}
.gx-board .gx-th{padding:12px 9px}
.gx-board .gx-td{padding:11px 8px}
.gx-fade{animation:gxf .4s cubic-bezier(.2,.7,.2,1) both}
@keyframes gxf{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.gx-stagger>*{animation:gxf .45s cubic-bezier(.2,.7,.2,1) both}
.gx-stagger>*:nth-child(1){animation-delay:.02s}.gx-stagger>*:nth-child(2){animation-delay:.06s}
.gx-stagger>*:nth-child(3){animation-delay:.10s}.gx-stagger>*:nth-child(4){animation-delay:.14s}
.gx-stagger>*:nth-child(5){animation-delay:.18s}.gx-stagger>*:nth-child(6){animation-delay:.22s}
.gx-drawer{animation:gxd .32s cubic-bezier(.2,.8,.2,1) both}
@keyframes gxd{from{transform:translateX(40px);opacity:0}to{transform:none;opacity:1}}
.gx-scrim{animation:gxs .25s ease both}@keyframes gxs{from{opacity:0}to{opacity:1}}
.gx-avatar{border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-family:var(--font-b);font-weight:700;color:#fff;flex:none}
.gx-tab{font-family:var(--font-b);font-weight:600;font-size:13px;padding:9px 2px;color:var(--ink-soft);cursor:pointer;border-bottom:2px solid transparent;margin-right:20px}
.gx-tab.on{color:var(--ink);border-bottom-color:var(--pop)}
.gx-menuitem{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600}
.gx-menuitem:hover{background:#F1F6F1}

/* ─── CEO OFFICE ADDITIONS (same tokens only) ─────────────────────────────── */
/* Kanban column + card language, built from the existing card/chip system. */
.gx-col{background:var(--line-soft);border:1px solid var(--line);border-radius:14px;display:flex;flex-direction:column;min-height:120px}
.gx-col-head{display:flex;align-items:center;justify-content:space-between;padding:11px 13px;position:sticky;top:0}
.gx-kcard{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px;cursor:pointer;transition:box-shadow .14s,transform .14s,border-color .14s}
.gx-kcard:hover{box-shadow:0 8px 22px -14px rgba(21,36,27,.4);border-color:#d3e0d6;transform:translateY(-1px)}
.gx-metric{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
.gx-metric-n{font-family:var(--font-d);font-size:30px;font-weight:700;line-height:1;letter-spacing:-0.02em}
.gx-dot{width:7px;height:7px;border-radius:999px;flex:none}
.gx-lock{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;color:var(--pop-deep);background:var(--pop-soft);padding:3px 8px;border-radius:999px}
.gx-skel{background:linear-gradient(90deg,#EEF4EF 25%,#E1EAE3 37%,#EEF4EF 63%);background-size:400% 100%;animation:gxsk 1.3s ease infinite;border-radius:8px}
@keyframes gxsk{from{background-position:100% 0}to{background-position:0 0}}
.gx-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:44px 20px;color:var(--ink-soft)}
.gx-focusable:focus-visible{outline:2px solid var(--pop);outline-offset:2px;border-radius:8px}
@keyframes spin{to{transform:rotate(360deg)}}

/* ─── Header width behaviour ───────────────────────────────────────────────
   This is a desktop tool, but "desktop" spans 1280 → 1920. The header carries
   a logo, seven nav items, search, a primary action and the user chip, which
   does not fit at the low end. Rather than let the user chip slide off-screen,
   the header sheds the least important things first, in this order:

     ≤1440  tighter gaps
     ≤1400  the user's name and role text (avatar + menu remain)
     ≤1340  nav labels, leaving icons (aria-label and title keep them named)

   Nav labels go before the search box on purpose: an icon-only nav item is
   still reachable and still announced, whereas hiding search would remove a
   capability outright.

   !important is needed because the header sets gap inline.
   If you add another nav item, re-check this at 1280. */
@media (max-width:1440px){ .gx-hdr{gap:10px !important} }
@media (max-width:1400px){ .gx-hdr-user{display:none} }
@media (max-width:1340px){
  .gx-navlabel{display:none}
  .gx-hdr .gx-navitem{padding:8px 9px !important}
}
`;

// ── Semantic colour maps ─────────────────────────────────────────────────────
// Colour is never the only signal — every chip carries its label as text too.
//
// These values are lifted VERBATIM from the Marketing Portal's constants/index.js
// so a High chip or a Review chip is pixel-identical across the two products.
// Nothing here is invented; where the CEO Office needs a status the Marketing
// Portal does not have, it borrows the closest existing Marketing swatch rather
// than adding a new hue:
//
//   CEO status      →  Marketing STATUS entry it reuses
//   ─────────────────────────────────────────────────────
//   To-Do           →  Deferred            (neutral stone)
//   In Progress     →  Execution           (violet)
//   Under Review    →  Review              (amber)
//   Done            →  Completed           (green)
//   Re-opened       →  Hold Due To Clarity (magenta — reads as "needs attention")

export const PRIORITY = {
  high:   { label: 'High',   bg: '#EDE4FF', fg: '#5B21B6', dot: '#7C3AED', rank: 3 },
  medium: { label: 'Medium', bg: '#DBEAFE', fg: '#1D4ED8', dot: '#2563EB', rank: 2 },
  low:    { label: 'Low',    bg: '#E0F2FE', fg: '#0369A1', dot: '#38BDF8', rank: 1 },
};

export const STATUS = {
  todo:         { label: 'To-Do',        short: 'To-Do',    bg: '#ECEAE3', fg: '#605E55', dot: '#94918A', order: 0 },
  in_progress:  { label: 'In Progress',  short: 'In Prog',  bg: '#EFE7FF', fg: '#6A3BD1', dot: '#8B5CF6', order: 1 },
  under_review: { label: 'Under Review', short: 'Review',   bg: '#FFEFD6', fg: '#9A5B00', dot: '#F5A623', order: 2 },
  done:         { label: 'Done',         short: 'Done',     bg: '#CDEBD6', fg: '#0F6B33', dot: '#15803D', order: 3 },
  reopened:     { label: 'Re-opened',    short: 'Reopened', bg: '#FBE0EC', fg: '#B01457', dot: '#E11D74', order: 4 },
};

// Urgency tones for due-date chips and metric numerals. Danger red is the
// Marketing Portal's own alert pair (#FDE2E2 / #C42424 — see its Drawer and
// TimerCell); the rest reuse the STATUS swatches above.
export const TONE = {
  overdue: { bg: '#FDE2E2', fg: '#C42424' },
  today:   { bg: '#FFEFD6', fg: '#9A5B00' },
  soon:    { bg: '#D6F4F7', fg: '#067A8C' },
  later:   { bg: '#EEF4EF', fg: '#586860' },
  none:    { bg: '#EEF4EF', fg: '#8CA096' },
  done:    { bg: '#CDEBD6', fg: '#0F6B33' },
};

// Avatar palette — the Marketing Portal's TYPE_PALETTE, so the same person is
// the same colour if they appear in both tools.
export const AVATAR_COLORS = [
  '#62A92A', '#2D7FF9', '#8B5CF6', '#F5A623', '#06B6D4', '#E11D74', '#15803D', '#FF8A4C',
  '#A855F7', '#0EA5E9', '#84CC16', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#EC4899',
  '#6366F1', '#14B8A6', '#F97316', '#22C55E', '#A78BFA', '#FB7185', '#0891B2',
];
