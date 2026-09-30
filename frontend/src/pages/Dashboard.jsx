import { motion } from 'framer-motion';
import { AlertCircle, RefreshCw, BarChart3 } from 'lucide-react';
import useDashboardStats from '../hooks/useDashboardStats';
import StatsGrid from '../components/dashboard/StatsGrid';
import SeverityChart from '../components/dashboard/SeverityChart';
import AlertTypeBreakdown from '../components/dashboard/AlertTypeBreakdown';
import ChronicServices from '../components/dashboard/ChronicServices';
import LiveIncidentFeed from '../components/dashboard/LiveIncidentFeed';
import LearningLoopIndicator from '../components/dashboard/LearningLoopIndicator';
import KillSwitch from '../components/controls/KillSwitch';
// import InfraGlobe from '../components/globe/InfraGlobe';

const EASE = [0.25, 0.46, 0.45, 0.94];

function PageHeader() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative">
        <BarChart3 size={20} className="text-[#00D4FF]" />
        <motion.div
          className="absolute inset-0 text-[#00D4FF]"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
          style={{ filter: 'blur(6px)' }}
        >
          <BarChart3 size={20} />
        </motion.div>
      </div>
      <div>
        <h2 className="text-white font-semibold text-sm">System Overview</h2>
        <p className="text-gray-600 text-[11px] font-mono">
          Live metrics · refreshes every 30s
        </p>
      </div>
    </div>
  );
}

function ErrorBanner({ message, onRetry }) {
  return (
    <motion.div
      className="flex items-center gap-3 bg-[#FF3B5C]/10 border border-[#FF3B5C]/25 rounded-xl px-4 py-3"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ ease: EASE, duration: 0.25 }}
    >
      <AlertCircle size={15} className="text-[#FF3B5C] flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-[#FF3B5C] text-xs font-mono">
          Showing cached data — {message ?? 'Could not reach backend'}
        </span>
      </div>
      <motion.button
        onClick={onRetry}
        className="flex items-center gap-1.5 text-[11px] font-mono text-gray-400 hover:text-white transition-colors px-2 py-1 rounded border border-[#1C2333] hover:border-[#00D4FF]/30 flex-shrink-0"
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        transition={{ ease: EASE, duration: 0.15 }}
      >
        <RefreshCw size={11} />
        Retry
      </motion.button>
    </motion.div>
  );
}

export default function Dashboard() {
  const { stats, loading, error, refetch } = useDashboardStats();

  return (
    <motion.div
      className="p-6 space-y-6 min-h-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ ease: EASE, duration: 0.3 }}
    >
      <PageHeader />

      {error && !loading && (
        <ErrorBanner message={error} onRetry={refetch} />
      )}

      {/* Row 1: 6-up stat cards */}
      <StatsGrid
        stats={stats}
        loading={loading}
        error={error}
        onRetry={refetch}
      />

      {/* Row 2: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Severity donut — 4 cols */}
        <div className="lg:col-span-4">
          <SeverityChart
            data={stats?.alerts_by_severity ?? null}
            loading={loading}
          />
        </div>

        {/* Alert type bars — 5 cols */}
        <div className="lg:col-span-5">
          <AlertTypeBreakdown
            data={stats?.alerts_by_type ?? null}
            loading={loading}
          />
        </div>

        {/* Chronic services — 3 cols */}
        <div className="lg:col-span-3">
          <ChronicServices
            data={stats?.chronic_services ?? null}
            loading={loading}
          />
        </div>
      </div>
      {/* Row 3: Live feed (left 7 cols) + Learning loop (right 5 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <div className="xl:col-span-7">
          <LiveIncidentFeed />
        </div>
        <div className="xl:col-span-5">
          <LearningLoopIndicator />
        </div>
      </div>

      {/* Row 4: Globe (left 7) + Kill Switch (right 5) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-7 flex justify-center">
          {/* <InfraGlobe /> */}
        </div>
        <div className="xl:col-span-5">
          <KillSwitch variant="expanded" />
        </div>
      </div>
    </motion.div>
  );
}
