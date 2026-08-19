import { AVATAR_COLORS } from './styles.js';

export const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';

// Deterministic avatar colour from a string, so a person keeps one colour.
export const colorFor = (key = '') => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const fmtDate = (d) => {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')) : new Date(d);
  if (isNaN(dt)) return '—';
  return `${dt.getDate()} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
};

export const fmtDateTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  const h = dt.getHours(), m = String(dt.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am', hh = ((h + 11) % 12) + 1;
  return `${fmtDate(d)}, ${hh}:${m}${ap}`;
};

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const daysUntil = (dateStr) => {
  if (!dateStr) return null;
  const t = startOfDay(new Date(dateStr + 'T00:00:00'));
  const now = startOfDay(new Date());
  return Math.round((t - now) / 86400000);
};

// Relative, human due-date label + urgency tier for colouring.
export const dueMeta = (dateStr) => {
  const n = daysUntil(dateStr);
  if (n === null) return { label: 'No date', tier: 'none' };
  if (n < 0) return { label: `${-n}d overdue`, tier: 'overdue' };
  if (n === 0) return { label: 'Due today', tier: 'today' };
  if (n <= 7) return { label: `Due in ${n}d`, tier: 'soon' };
  return { label: fmtDate(dateStr), tier: 'later' };
};

export const roleLabel = (r) => ({ ea: 'Executive Assistant', ceo: 'CEO', stakeholder: 'Stakeholder' }[r] || r);
export const isExecutiveRole = (r) => r === 'ea' || r === 'ceo';
