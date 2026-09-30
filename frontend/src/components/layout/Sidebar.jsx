import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Zap,
  Activity,
  Brain,
  Shield,
  FileText,
  GitBranch,
} from 'lucide-react';
import { useSystem } from '../../context/SystemContext';
import KillSwitch from '../controls/KillSwitch';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, live: false },
  { path: '/incidents', label: 'Live Incidents', icon: Zap, live: true },
  { path: '/services', label: 'Services', icon: Activity, live: true },
  { path: '/intelligence', label: 'AI Intelligence', icon: Brain, live: true },
  { path: '/override', label: 'Human Override', icon: Shield, live: false },
  { path: '/reports', label: 'Reports & Audit', icon: FileText, live: false },
  { path: '/workflows', label: 'Workflow Rules', icon: GitBranch, live: false },
];

const EASE = [0.25, 0.46, 0.45, 0.94];

function AeternaLogo() {
  return (
    <div className="flex items-center gap-3 px-6 py-5 border-b border-[#1C2333]">
      <div className="relative flex-shrink-0">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <defs>
            <filter id="logo-glow">
              <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <polygon
            points="16,2 30,28 2,28"
            fill="none"
            stroke="#00D4FF"
            strokeWidth="2"
            strokeLinejoin="round"
            filter="url(#logo-glow)"
          />
          <line
            x1="9" y1="22" x2="23" y2="22"
            stroke="#00D4FF"
            strokeWidth="2"
            strokeLinecap="round"
            filter="url(#logo-glow)"
          />
          <line
            x1="13" y1="16" x2="19" y2="16"
            stroke="#00D4FF"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.6"
            filter="url(#logo-glow)"
          />
        </svg>
        <motion.div
          className="absolute inset-0 rounded-full"
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          style={{ boxShadow: '0 0 16px 4px rgba(0,212,255,0.35)' }}
        />
      </div>
      <div className="flex flex-col">
        <span
          className="text-white font-mono text-lg leading-none"
          style={{ letterSpacing: '0.3em' }}
        >
          AETERNA
        </span>
        <span
          className="text-[#00D4FF] font-mono leading-none mt-0.5"
          style={{ fontSize: '10px', letterSpacing: '0.5em' }}
        >
          SOVEREIGN SRE
        </span>
      </div>
    </div>
  );
}

function NavItem({ item, isActive }) {
  const Icon = item.icon;
  return (
    <motion.div
      whileHover={{ x: 4 }}
      transition={{ ease: EASE, duration: 0.2 }}
      className="relative"
    >
      <NavLink
        to={item.path}
        end={item.path === '/'}
        className={`flex items-center gap-3 px-5 py-2.5 text-sm transition-colors duration-200 relative ${isActive
            ? 'text-[#00D4FF] bg-cyan-400/5 border-l-2 border-[#00D4FF]'
            : 'text-gray-400 hover:text-white border-l-2 border-transparent'
          }`}
      >
        <Icon size={17} strokeWidth={isActive ? 2 : 1.5} />
        <span className="font-ui flex-1">{item.label}</span>
        {item.live && (
          <motion.span
            className="w-1.5 h-1.5 rounded-full bg-[#00D4FF]"
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </NavLink>
    </motion.div>
  );
}

function WsIndicator({ wsConnected, reconnecting, reconnectIn }) {
  const color = reconnecting ? '#FF9500' : wsConnected ? '#22C55E' : '#FF3B5C';
  const label = reconnecting
    ? `Reconnecting${reconnectIn > 0 ? ` in ${reconnectIn}s` : '...'}`
    : wsConnected
      ? 'Live'
      : 'Disconnected';

  return (
    <div className="flex items-center gap-2 px-4 py-2">
      <div className="relative flex-shrink-0">
        <motion.div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: color }}
          animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div
          className="absolute inset-0 w-2 h-2 rounded-full"
          style={{ backgroundColor: color, opacity: 0.3, filter: 'blur(3px)' }}
        />
      </div>
      <span className="font-mono text-[11px]" style={{ color }}>
        {label}
      </span>
    </div>
  );
}


function HealthBadge({ systemHealth }) {
  const status = systemHealth?.status ?? null;
  const isOnline = status === 'healthy' || status === 'ok';
  const isDegraded = status === 'degraded';

  const color = !status
    ? '#9CA3AF'
    : isOnline
      ? '#22C55E'
      : isDegraded
        ? '#FF9500'
        : '#FF3B5C';

  const label = !status
    ? 'CHECKING'
    : isOnline
      ? 'ONLINE'
      : isDegraded
        ? 'DEGRADED'
        : 'OFFLINE';

  return (
    <div className="flex items-center gap-2 px-4 py-1.5">
      <div
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="font-mono text-[10px] text-gray-500">
        SYSTEM{' '}
        <span style={{ color }} className="font-semibold">
          {label}
        </span>
      </span>
    </div>
  );
}

export default function Sidebar() {
  const location = useLocation();
  const { wsConnected, systemHealth, reconnecting, reconnectIn } = useSystem();

  return (
    <motion.aside
      className="flex flex-col h-full border-r border-[#1C2333] flex-shrink-0"
      style={{ width: 256, backgroundColor: '#080B14' }}
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ ease: EASE, duration: 0.35 }}
    >
      <AeternaLogo />

      <nav className="flex-1 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.path === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.path);
          return <NavItem key={item.path} item={item} isActive={isActive} />;
        })}
      </nav>

      <div className="border-t border-[#1C2333] pt-3 pb-3 space-y-2">
        <WsIndicator
          wsConnected={wsConnected}
          reconnecting={reconnecting ?? false}
          reconnectIn={reconnectIn ?? 0}
        />
        {/* Compact kill switch — confirm-gated */}
        <KillSwitch variant="compact" />
        <HealthBadge systemHealth={systemHealth} />
      </div>
    </motion.aside>
  );
}
