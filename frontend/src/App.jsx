import { lazy, Suspense, useEffect, useCallback, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { SystemProvider, useSystem } from './context/SystemContext';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import useDashboardStats from './hooks/useDashboardStats';
import { ToastProvider } from './components/ui/ToastSystem';
const Dashboard    = lazy(() => import('./pages/Dashboard'));
const Incidents    = lazy(() => import('./pages/Incidents'));
const Services     = lazy(() => import('./pages/Services'));
const Intelligence = lazy(() => import('./pages/Intelligence'));
const PredictiveAlertViz = lazy(() => import('./components/intelligence/PredictiveAlertViz'));
const Override     = lazy(() => import('./pages/Override'));
const Reports      = lazy(() => import('./pages/Reports'));
const Workflows    = lazy(() => import('./pages/Workflows'));

const ROUTES = [
  { path: '/',             label: 'Dashboard'     },
  { path: '/incidents',   label: 'Live Incidents' },
  { path: '/services',    label: 'Services'       },
  { path: '/intelligence',label: 'AI Intelligence'},
  { path: '/override',    label: 'Human Override' },
  { path: '/reports',     label: 'Reports & Audit'},
  { path: '/workflows',   label: 'Workflow Rules' },
];

const EASE = [0.25, 0.46, 0.45, 0.94];

function PageSkeleton() {
  return (
    <div className="flex-1 p-6 space-y-4 overflow-hidden">
      <div className="skeleton h-8 w-48 rounded-lg" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="skeleton h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 skeleton h-64 rounded-xl" />
        <div className="skeleton h-64 rounded-xl" />
      </div>
      <div className="skeleton h-48 rounded-xl" />
    </div>
  );
}

// ── Page transition wrapper ────────────────────────────────────────────────────
function AnimatedPage({ children, routeKey }) {
  return (
    <motion.div
      key={routeKey}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ ease: EASE, duration: 0.22 }}
      className="h-full"
    >
      {children}
    </motion.div>
  );
}

// ── Document title + pending count ────────────────────────────────────────────
function DocumentTitleManager({ incidentsPending = 0 }) {
  const location = useLocation();
  const route    = ROUTES.find((r) =>
    r.path === '/' ? location.pathname === '/' : location.pathname.startsWith(r.path)
  );
  const label   = route?.label ?? 'Aeterna';
  const pending = incidentsPending > 0 ? `(${incidentsPending}) ` : '';
  useEffect(() => {
    document.title = `${pending}${label} — Aeterna Sovereign SRE`;
  }, [label, pending]);
  return null;
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
function KeyboardShortcuts() {
  const navigate       = useNavigate();
  const { toggleKillSwitch, killSwitchActive } = useSystem();
  const [ksConfirm, setKsConfirm] = useState(false);
  const ksTimer = useRef(null);

  // expose ref inside closure
  const ksConfirmRef = { current: ksConfirm };
  ksConfirmRef.current = ksConfirm;

  const handleKey = useCallback((e) => {
    // Ignore if typing in an input/textarea
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case '1': navigate('/');             break;
      case '2': navigate('/incidents');    break;
      case '3': navigate('/services');     break;
      case '4': navigate('/intelligence'); break;
      case '5': navigate('/override');     break;
      case '6': navigate('/reports');      break;
      case '7': navigate('/workflows');    break;
      case 'n':
      case 'N':
        e.preventDefault();
        document.getElementById('submit-alert-btn')?.click();
        break;
      case 'k':
      case 'K':
        e.preventDefault();
        if (!ksConfirmRef.current) {
          setKsConfirm(true);
          clearTimeout(ksTimer.current);
          ksTimer.current = setTimeout(() => setKsConfirm(false), 4000);
        } else {
          clearTimeout(ksTimer.current);
          setKsConfirm(false);
          toggleKillSwitch();
        }
        break;
      case 'Escape':
        document.dispatchEvent(new KeyboardEvent('keydown-esc-propagate', { bubbles: true }));
        break;
      default:
        break;
    }
  }, [navigate, toggleKillSwitch]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('keydown', handleKey); clearTimeout(ksTimer.current); };
  }, [handleKey]);

  // KS confirm toast
  return ksConfirm ? (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9998] px-5 py-2.5 rounded-xl border font-mono text-sm font-bold text-white"
      style={{ backgroundColor: 'rgba(255,59,92,0.15)', borderColor: 'rgba(255,59,92,0.5)' }}
    >
      Press <kbd className="bg-white/10 px-1.5 py-0.5 rounded text-[#FF3B5C] mx-1">K</kbd> again to{' '}
      {killSwitchActive ? 'RESUME' : 'PAUSE'} automation
    </div>
  ) : null;
}
// eslint-disable-next-line react-hooks/exhaustive-deps -- need ref trick
import { useRef } from 'react';

// ── aria-live WS announcer ─────────────────────────────────────────────────────
function WsAnnouncer() {
  const { lastWsEvent } = useSystem();
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (!lastWsEvent) return;
    const type = lastWsEvent.type ?? '';
    const d    = lastWsEvent.data ?? {};
    const msgs = {
      INCIDENT_CREATED:    `New incident on ${d.service ?? 'service'}`,
      INCIDENT_RESOLVED:   `Incident resolved: ${d.incident_id ?? ''}`,
      KILL_SWITCH_TOGGLED: `Automation ${d.kill_switch_active ? 'paused' : 'resumed'}`,
      PREDICTIVE_ALERT:    `Predictive alert for ${d.service ?? 'service'}`,
    };
    if (msgs[type]) setAnnouncement(msgs[type]);
  }, [lastWsEvent]);

  return (
    <div aria-live="polite" aria-atomic="true"
      className="sr-only" role="status">
      {announcement}
    </div>
  );
}

// ── Inner shell ────────────────────────────────────────────────────────────────
function AppShell() {
  const { stats }  = useDashboardStats();
  const location   = useLocation();
  const pending    = stats?.incidents_last_hour ?? 0;

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ backgroundColor: '#080B14' }}>
      <DocumentTitleManager incidentsPending={pending} />
      <WsAnnouncer />
      <KeyboardShortcuts />

      {/* Global predictive alert banner */}
      <Suspense fallback={null}>
        <PredictiveAlertViz />
      </Suspense>

      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <TopBar incidentsLastHour={stats?.incidents_last_hour ?? null} />

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <Suspense fallback={<PageSkeleton />}>
            <AnimatePresence mode="wait" initial={false}>
              <Routes location={location}>
                <Route path="/"             element={<AnimatedPage routeKey="/"><Dashboard /></AnimatedPage>}    />
                <Route path="/incidents"    element={<AnimatedPage routeKey="/incidents"><Incidents /></AnimatedPage>}    />
                <Route path="/services"     element={<AnimatedPage routeKey="/services"><Services /></AnimatedPage>}     />
                <Route path="/intelligence" element={<AnimatedPage routeKey="/intelligence"><Intelligence /></AnimatedPage>} />
                <Route path="/override"     element={<AnimatedPage routeKey="/override"><Override /></AnimatedPage>}     />
                <Route path="/reports"      element={<AnimatedPage routeKey="/reports"><Reports /></AnimatedPage>}      />
                <Route path="/workflows"    element={<AnimatedPage routeKey="/workflows"><Workflows /></AnimatedPage>}    />
              </Routes>
            </AnimatePresence>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <SystemProvider>
        <ToastProvider>
          <AppShell />
        </ToastProvider>
      </SystemProvider>
    </BrowserRouter>
  );
}
