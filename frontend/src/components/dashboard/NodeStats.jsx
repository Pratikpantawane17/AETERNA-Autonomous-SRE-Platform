import { useEffect, useState } from 'react';
import { Server, Cpu, MemoryStick, AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

export default function NodeStats() {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchNodes = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/dashboard/nodes`, {
          headers: { 'X-API-Key': import.meta.env.VITE_AETERNA_API_KEY || 'cummins-demo-key' }
        });
        if (!response.ok) throw new Error('Failed to fetch node metrics');
        const data = await response.json();
        setMetrics(data.metrics || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchNodes();
    const interval = setInterval(fetchNodes, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="text-gray-500 text-sm font-mono p-4">Loading node stats...</div>;
  }

  if (error) {
    return (
      <div className="text-[#FF3B5C] text-sm font-mono p-4 flex items-center gap-2">
        <AlertCircle size={14} /> Failed to load node stats: {error}
      </div>
    );
  }

  if (!metrics || metrics.length === 0) {
    return <div className="text-gray-500 text-sm font-mono p-4">No node stats available. Ensure metrics-server is running.</div>;
  }

  return (
    <div className="bg-[#0D1117] border border-[#1C2333] rounded-xl p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2 text-gray-400 font-mono text-xs uppercase tracking-wider">
        <Server size={14} /> Kubernetes Nodes
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {metrics.map((node, i) => (
          <motion.div 
            key={i} 
            className="bg-[#161B22] border border-[#21262D] rounded-lg p-3 flex flex-col gap-2"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <div className="text-white font-mono text-sm">{node.node_name}</div>
            
            <div className="flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-1 text-[#00D4FF]"><Cpu size={12} /> CPU Usage</div>
              <span className="text-gray-300">{node.cpu_usage_cores || 'N/A'} cores</span>
            </div>
            
            <div className="flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-1 text-[#7C3AED]"><MemoryStick size={12} /> Memory</div>
              <span className="text-gray-300">{node.memory_usage_bytes ? (node.memory_usage_bytes / 1024 / 1024).toFixed(0) + ' MB' : 'N/A'}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
