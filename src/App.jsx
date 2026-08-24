import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, KanbanSquare, RotateCcw, Users, Bookmark, Archive as ArchiveIcon,
  Search, Plus, LogOut, Loader2, X, CalendarClock,
} from 'lucide-react';
import { useAuth } from './hooks/useAuth.jsx';
import { api } from './lib/api.js';
import { isExecutiveRole, roleLabel } from './lib/format.js';
import { canCreateTask, createsForSelfOnly, EMPTY_FILTERS } from './lib/rules.js';
import { GyftrLogo } from './components/GyftrLogo.jsx';
import Login from './components/Login.jsx';
import { Avatar } from './components/ui.jsx';
import Dashboard from './views/Dashboard.jsx';
import StakeholderHome from './views/StakeholderHome.jsx';
import Board from './views/Board.jsx';
import Reopened from './views/Reopened.jsx';
import Archive from './views/Archive.jsx';
import Stakeholders from './views/Stakeholders.jsx';
import SavedViews from './views/SavedViews.jsx';
import Followups from './views/Followups.jsx';
import TaskDrawer from './components/TaskDrawer.jsx';
import CreateTaskModal from './components/CreateTaskModal.jsx';

// The Marketing Portal keeps navigation in the header, not a sidebar. Same here,
// with the CEO Office's own information architecture in place of Marketing's.
const EXEC_NAV = [
  ['overview',     'Overview',     LayoutDashboard],
  ['board',        'Kanban',       KanbanSquare],
  ['followups',    'Follow-ups',   CalendarClock],
  ['reopened',     'Re-opened',    RotateCcw],
  ['views',        'Saved Views',  Bookmark],
  ['stakeholders', 'Stakeholders', Users],
  ['archive',      'Archive',      ArchiveIcon],
];
const STAKE_NAV = [
  ['overview', 'My Tasks', LayoutDashboard],
  ['board',    'My Board', KanbanSquare],
];

export default function App() {
  const { session, profile, signOut, mustSetPassword } = useAuth();
  const [view, setView]           = useState('overview');
  const [tasks, setTasks]         = useState(null);
  const [loadError, setLoadError] = useState('');
  const [q, setQ]                 = useState('');
  const [filters, setFilters]     = useState(EMPTY_FILTERS);
  const [openTaskId, setOpenTaskId] = useState(null);
  const [creating, setCreating]   = useState(false);
  const [menuOpen, setMenuOpen]   = useState(false);

  const isExec = isExecutiveRole(profile?.role);

  const refresh = useCallback(async () => {
    if (!profile) return;
    try { setTasks(await api.tasks()); setLoadError(''); }
    catch (e) { console.error(e); setLoadError(e.message || 'Could not load tasks.'); setTasks([]); }
  }, [profile]);

  useEffect(() => { refresh(); }, [refresh]);

  // Refetch when the tab regains focus — same behaviour as the Marketing Portal,
  // which is how an EA watching the board sees a stakeholder's move appear.
  useEffect(() => {
    if (!profile) return;
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [profile, refresh]);

  // A stakeholder must never land on an executive-only view, even via stale state.
  useEffect(() => {
    if (!isExec && !STAKE_NAV.some(([k]) => k === view)) setView('overview');
  }, [isExec, view]);

  const openTask = useMemo(
    () => (tasks || []).find((t) => t.id === openTaskId) || null,
    [tasks, openTaskId]
  );

  // Deep-linking: mirror the open task in the URL hash (#task/<id>) so a task can
  // be shared or reloaded straight into its drawer. RLS still applies — a hash to
  // a task the viewer can't see simply resolves to nothing.
  const openTaskById = useCallback((id) => {
    setOpenTaskId(id);
    const url = id ? `#task/${id}` : window.location.pathname + window.location.search;
    window.history.replaceState(null, '', url);
  }, []);
  useEffect(() => {
    const sync = () => {
      const m = window.location.hash.match(/^#task\/(\d+)/);
      setOpenTaskId(m ? Number(m[1]) : null);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const filtered = useMemo(() => searchTasks(tasks, q), [tasks, q]);

  if (session === undefined) return <BootScreen />;
  // mustSetPassword has to be checked HERE, not only inside Login. A first-time
  // account signs in successfully, so it has both a session and a profile — and
  // without this clause the app would render the board and the "set a new
  // password" step could never appear, because Login is not mounted once signed
  // in. Login renders that step itself when the flag is set.
  if (!session || !profile || mustSetPassword) return <Login />;

  const nav = isExec ? EXEC_NAV : STAKE_NAV;
  const shared = {
    tasks: filtered, allTasks: tasks, role: profile.role, me: profile,
    onOpen: openTaskById, refresh, setView, filters, setFilters,
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {loadError && (
        <div style={{ flex: 'none', padding: '7px 24px', background: '#FBE0EC', color: '#B01457', fontSize: 12.5, fontWeight: 600 }}>
          Could not load tasks ({loadError}). Reload, or contact the CEO&apos;s Office.
        </div>
      )}

      {/* ── Header — the Marketing Portal's exact shell ── */}
      <header className="gx-hdr" style={{ flex: 'none', height: 58, borderBottom: '1px solid var(--line)',
        background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 18, padding: '0 24px' }}>
        <GyftrLogo fs={20} />
        <span style={{ width: 1, height: 24, background: 'var(--line)', margin: '0 2px' }} />

        <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {nav.map(([k, label, Icon]) => (
            <button key={k} className={`gx-navitem gx-focusable${view === k ? ' on' : ''}`}
              aria-current={view === k ? 'page' : undefined}
              // The accessible name stays the full label even when the text is
              // hidden at narrow widths, so the icon-only state is not mute.
              aria-label={label} title={label}
              style={{ border: 'none', whiteSpace: 'nowrap', padding: '8px 11px',
                background: view === k ? undefined : 'transparent' }}
              onClick={() => setView(k)}>
              <Icon size={16} /> <span className="gx-navlabel">{label}</span>
            </button>
          ))}
        </nav>

        {/* The search box is the only element allowed to shrink. Everything else
            in the header is flex:none, so as nav items are added this absorbs
            the pressure instead of pushing the user chip off-screen. */}
        <div style={{ position: 'relative', marginLeft: 'auto',
          flex: '0 1 230px', minWidth: 130 }}>
          <Search size={14} aria-hidden="true"
            style={{ position: 'absolute', left: 11, top: 10, color: '#94a59b', pointerEvents: 'none' }} />
          <input className="gx-input" style={{ paddingLeft: 31, paddingRight: q ? 28 : 12 }}
            placeholder="Search tasks, people…" aria-label="Search tasks"
            value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQ('')} />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear search"
              style={{ position: 'absolute', right: 6, top: 7, background: 'none', border: 'none', cursor: 'pointer', color: '#94a59b', padding: 2 }}>
              <X size={14} />
            </button>
          )}
        </div>

        {/* CR-01 #6: everyone may now raise a task. A stakeholder's lands on
            their own board only — the label says so, and the modal has no
            assignee picker at all in that mode. */}
        {canCreateTask(profile.role) && (
          <button className="gx-btn gx-btn-dark gx-focusable" onClick={() => setCreating(true)}
            style={{ whiteSpace: 'nowrap', flex: 'none' }}>
            <Plus size={16} /> {createsForSelfOnly(profile.role) ? 'New task' : 'Create task'}
          </button>
        )}

        <span style={{ width: 1, height: 24, background: 'var(--line)', flex: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, position: 'relative', flex: 'none' }}>
          <Avatar name={profile.name} color={profile.color} size={30} />
          {/* Hidden below 1360px — the avatar and the account menu still carry
              the identity, so nothing becomes unreachable. */}
          <div className="gx-hdr-user" style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.1, whiteSpace: 'nowrap' }}>{profile.name}</div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{roleLabel(profile.role)}</div>
          </div>
          <button onClick={() => setMenuOpen((v) => !v)} aria-label="Account menu" aria-expanded={menuOpen}
            className="gx-focusable"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a59b', display: 'flex', padding: 2, marginLeft: 2 }}>
            <LogOut size={16} />
          </button>
          {menuOpen && (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div className="gx-card gx-fade" style={{ position: 'absolute', top: '115%', right: 0, zIndex: 50, padding: 6, width: 170,
                boxShadow: '0 18px 50px -12px rgba(0,0,0,.3)' }}>
                <div className="gx-menuitem" onClick={() => { setMenuOpen(false); signOut(); }}>
                  <LogOut size={15} /> Sign out
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {/* ── Main ── */}
      <main style={{ flex: 1, overflowY: 'auto', background: 'var(--paper)' }}>
        <div style={{ padding: 24 }}>
          {tasks === null ? <LoadingView /> : (
            <>
              {view === 'overview'     && (isExec ? <Dashboard {...shared} /> : <StakeholderHome {...shared} />)}
              {view === 'board'        && <Board {...shared} />}
              {view === 'followups'    && isExec && <Followups {...shared} />}
              {view === 'reopened'     && isExec && <Reopened {...shared} />}
              {view === 'archive'      && isExec && <Archive {...shared} />}
              {view === 'stakeholders' && isExec && <Stakeholders />}
              {view === 'views'        && isExec && <SavedViews {...shared} />}
            </>
          )}
        </div>
      </main>

      {openTask && (
        <TaskDrawer task={openTask} me={profile} onClose={() => openTaskById(null)} refresh={refresh} />
      )}
      {creating && (
        <CreateTaskModal me={profile} onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); refresh().then(() => setOpenTaskId(id)); }} />
      )}
    </div>
  );
}

function BootScreen() {
  return (
    <div style={{ height: '100vh', display: 'grid', placeItems: 'center' }}>
      <Loader2 size={22} style={{ animation: 'spin 1s linear infinite', color: 'var(--pop)' }} />
    </div>
  );
}

function LoadingView() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', padding: 80 }}>
      <div style={{ textAlign: 'center', fontSize: 15, fontWeight: 600, color: 'var(--ink-soft)' }}>
        Loading tasks…
      </div>
    </div>
  );
}

// Search across title, description, task id and assignee name. Deliberately
// simple — the dataset is small and an executive wants an instant answer.
// Note this searches only what the server already returned, so a stakeholder
// can never surface another stakeholder's task through it.
export function searchTasks(tasks, q) {
  if (!tasks) return tasks;
  const s = q.trim().toLowerCase();
  if (!s) return tasks;
  return tasks.filter((t) =>
    t.title.toLowerCase().includes(s) ||
    (t.description || '').toLowerCase().includes(s) ||
    String(t.id) === s.replace(/^#/, '') ||
    (t.assignments || []).some((a) => a.stakeholder?.name?.toLowerCase().includes(s))
  );
}
