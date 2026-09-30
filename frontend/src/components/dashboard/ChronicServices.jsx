import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, CheckCircle, ExternalLink } from 'lucide-react';

const EASE = [0.25, 0.46, 0.45, 0.94];

const MOCK_DATA = [
  {
    service_name: 'payment-service',
    error_rate: 0.34,
    incident_count: 12,
    trend: 'up',
  },
  {
    service_name: 'auth-service',
    error_rate: 0.18,
    incident_count: 7,
    trend: 'stable',
  },
  {
    service_name: 'data-pipeline',
    error_rate: 0.09,
    incident_count: 4,
    trend: 'down',
  },
];

function healthColor(errorRate) {
  const r = typeof errorRate === 'number' ? errorRate : 0;
  if (r > 0.05) return '#FF3B5C';
  if (r >= 0.02) return '#FF9500';
  return '#22C55E';
}

function TrendIcon({ trend }) {
  if (trend === 'up')
    return <TrendingUp size={13} className="text-[#FF3B5C]" />;
  if (trend === 'down')
    return <TrendingDown size={13} className="text-[#22C55E]" />;
  return <Minus size={13} className="text-gray-500" />;
}

function AllHealthyEmpty() {
  return (
    <motion.div
      className="flex flex-col items-center justify-center py-8 gap-3"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ ease: EASE, duration: 0.4 }}
    >
      <div className="relative">
        <CheckCircle size={32} className="text-[#22C55E]" />
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          animate={{ scale: [1, 1.6, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          <CheckCircle size={32} className="text-[#22C55E]" />
        </motion.div>
      </div>
      <div className="text-center space-y-0.5">
        <p className="text-[#22C55E] text-sm font-semibold">All services healthy</p>
      </div>
    </motion.div>
  );
}

function SkeletonService() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-[#1C2333]">
      <div className="skeleton w-2 h-2 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="skeleton h-3 w-32 rounded" />
        <div className="skeleton h-2.5 w-20 rounded" />
      </div>
      <div className="skeleton h-3 w-10 rounded" />
    </div>
  );
}

function ServiceCard({ service, index }) {
  const navigate = useNavigate();
  const name       = service?.service ?? 'Unknown Service';
  const errorRate  = typeof service?.error_rate === 'number' ? service.error_rate : 0;
  const trend      = service?.trend ?? 'stable';
  const dotColor   = healthColor(errorRate);
  const pctDisplay = `${(errorRate * 100).toFixed(1)}%`;

  function handleClick() {
    navigate(`/services?service=${encodeURIComponent(name)}`);
  }

  return (
    <motion.div
      className="flex items-center gap-3 p-3 rounded-lg border border-[#1C2333] cursor-pointer group relative overflow-hidden"
      style={{ backgroundColor: 'transparent' }}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, ease: EASE, duration: 0.35 }}
      whileHover={{
        borderColor: `${dotColor}40`,
        backgroundColor: `${dotColor}06`,
        scale: 1.015,
        transition: { ease: EASE, duration: 0.18 },
      }}
      whileTap={{ scale: 0.99 }}
      onClick={handleClick}
    >
      {/* Glow accent on hover */}
      <motion.div
        className="absolute left-0 top-0 bottom-0 w-0.5 rounded-full"
        style={{ backgroundColor: dotColor }}
        initial={{ opacity: 0 }}
        whileHover={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
      />

      {/* Health dot */}
      <div className="relative flex-shrink-0 ml-1">
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
        {errorRate > 0.05 && (
          <motion.div
            className="absolute inset-0 w-2 h-2 rounded-full"
            style={{ backgroundColor: dotColor }}
            animate={{ scale: [1, 2, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </div>

      {/* Service info */}
      <div className="flex-1 min-w-0">
        <p className="text-white text-xs font-mono truncate group-hover:text-white transition-colors">
          {name}
        </p>
        <p className="text-gray-600 text-[10px] font-mono mt-0.5">
          Error rate: {pctDisplay}
        </p>
      </div>

      {/* Error rate + trend */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span
          className="font-mono text-xs font-semibold"
          style={{ color: dotColor }}
        >
          {pctDisplay}
        </span>
        <TrendIcon trend={trend} />
      </div>

      {/* Navigation arrow */}
      <motion.div
        className="opacity-0 group-hover:opacity-100 transition-opacity duration-150"
      >
        <ExternalLink size={11} className="text-gray-500" />
      </motion.div>
    </motion.div>
  );
}

export default function ChronicServices({ data, loading }) {
  const safeData = Array.isArray(data) ? data : [];
  const useMock  = safeData.length === 0 && !loading;
  // Only use mock for rendering preview; real empty state triggers AllHealthyEmpty below
  // Per mock rule: mock only activates when API throws (handled in hook), not when real empty

  const displayData = safeData.slice(0, 3);
  const isEmpty     = displayData.length === 0;

  if (loading) {
    return (
      <div className="bg-[#0D1117] border border-[#1C2333] rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <div className="skeleton h-4 w-36 rounded" />
          <div className="skeleton h-3 w-12 rounded" />
        </div>
        {[...Array(3)].map((_, i) => <SkeletonService key={i} />)}
      </div>
    );
  }

  return (
    <div className="bg-[#0D1117] border border-[#1C2333] rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-white font-semibold text-sm">Chronic Services</span>
        <span className="text-gray-600 text-[11px] font-mono">
          {isEmpty ? 'clear' : `top ${displayData.length}`}
        </span>
      </div>

      <AnimatePresence mode="wait">
        {isEmpty ? (
          <motion.div
            key="healthy"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ ease: EASE, duration: 0.25 }}
          >
            <AllHealthyEmpty />
          </motion.div>
        ) : (
          <motion.div
            key="list"
            className="space-y-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ ease: EASE, duration: 0.25 }}
          >
            {displayData.map((service, i) => (
              <ServiceCard
                key={service?.service ?? i}
                service={service}
                index={i}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export { MOCK_DATA as CHRONIC_MOCK };
