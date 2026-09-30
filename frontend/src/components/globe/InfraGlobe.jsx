import React, {
  useState, useEffect, useRef, useCallback, useMemo, memo, Component, Suspense,
} from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity } from 'lucide-react';
import api, { WS_URL } from '../../config/api';
import { useSystem } from '../../context/SystemContext';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const GLOBE_RADIUS  = 1;
const DOT_RADIUS    = 0.028;
const GRID_COLOR    = '#0D3A5E';
const ATMO_COLOR    = '#00D4FF';

const HEALTH_COLORS = {
  healthy:   '#22C55E',
  degraded:  '#FF9500',
  unhealthy: '#FF3B5C',
};
const ARC_COLORS = {
  critical: '#FF3B5C',
  high:     '#FF9500',
  medium:   '#00D4FF',
  low:      '#22C55E',
};

const MOCK_SERVICES = {
  'payment-service':  { health: 'unhealthy', cpu_pct: 94, disk_pct: 62, error_rate: 0.087 },
  'auth-service':     { health: 'degraded',  cpu_pct: 71, disk_pct: 45, error_rate: 0.021 },
  'api-gateway':      { health: 'healthy',   cpu_pct: 38, disk_pct: 31, error_rate: 0.003 },
  'db-primary':       { health: 'degraded',  cpu_pct: 82, disk_pct: 97, error_rate: 0.019 },
  'notification-svc': { health: 'healthy',   cpu_pct: 22, disk_pct: 18, error_rate: 0.001 },
  'order-service':    { health: 'healthy',   cpu_pct: 45, disk_pct: 52, error_rate: 0.004 },
  'cache-layer':      { health: 'unhealthy', cpu_pct: 88, disk_pct: 74, error_rate: 0.052 },
  'ml-inference':     { health: 'healthy',   cpu_pct: 61, disk_pct: 40, error_rate: 0.006 },
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const str = (v) => (v != null ? String(v) : '');

function serviceHash(name) {
  let hash = 0;
  const s = str(name);
  for (let i = 0; i < s.length; i++) {
    hash = Math.imul(31, hash) + s.charCodeAt(i) | 0;
  }
  return Math.abs(hash);
}

function serviceToLatLng(name) {
  const h = serviceHash(name);
  const lat = ((h & 0xFF) / 255) * 140 - 70;
  const lng = (((h >> 8) & 0xFF) / 255) * 340 - 170;
  return { lat, lng };
}

function latLngToVec3(lat, lng, r = GLOBE_RADIUS + 0.002) {
  const phi   = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  );
}

function makeArcPoints(from, to, steps = 48) {
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const len = from.distanceTo(to);
  mid.normalize().multiplyScalar(GLOBE_RADIUS + 0.35 + len * 0.3);
  const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
  return curve.getPoints(steps);
}

function webGlSupported() {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch { return false; }
}

// ─── GLOBE SPHERE + GRID ──────────────────────────────────────────────────────
const GlobeMesh = memo(function GlobeMesh() {
  const sphereGeo = useMemo(() => new THREE.SphereGeometry(GLOBE_RADIUS, 48, 48), []);
  const sphereMat = useMemo(() => new THREE.MeshPhongMaterial({
    color:    0x060D1A,
    emissive: 0x020810,
    shininess: 5,
    transparent: true, opacity: 0.95,
  }), []);

  // Build lat/lon grid as line segments
  const gridGeo = useMemo(() => {
    const pts = [];
    const R = GLOBE_RADIUS + 0.0015;

    // Longitude lines every 30°
    for (let lng = -180; lng < 180; lng += 30) {
      for (let lat = -88; lat < 88; lat += 4) {
        pts.push(latLngToVec3(lat, lng, R));
        pts.push(latLngToVec3(lat + 4, lng, R));
      }
    }
    // Latitude lines every 30°
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lng = -180; lng < 180; lng += 4) {
        pts.push(latLngToVec3(lat, lng, R));
        pts.push(latLngToVec3(lat, lng + 4, R));
      }
    }

    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    return geo;
  }, []);

  const gridMat = useMemo(() => new THREE.LineBasicMaterial({
    color: 0x0D3A5E, transparent: true, opacity: 0.55,
  }), []);

  useEffect(() => {
    return () => {
      sphereGeo.dispose(); sphereMat.dispose();
      gridGeo.dispose(); gridMat.dispose();
    };
  }, [sphereGeo, sphereMat, gridGeo, gridMat]);

  return (
    <group>
      <mesh geometry={sphereGeo} material={sphereMat} />
      <lineSegments geometry={gridGeo} material={gridMat} />
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 3, 3]} intensity={0.8} color="#AACFFF" />
    </group>
  );
});

// ─── ATMOSPHERE GLOW ─────────────────────────────────────────────────────────
const Atmosphere = memo(function Atmosphere() {
  const geo = useMemo(() => new THREE.SphereGeometry(GLOBE_RADIUS * 1.12, 32, 32), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0x00D4FF, transparent: true, opacity: 0.06,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
  }), []);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} />;
});

// ─── PULSING RING ─────────────────────────────────────────────────────────────
function PulseRing({ position, color }) {
  const meshRef = useRef();
  const matRef  = useRef();
  const tRef    = useRef(Math.random()); // stagger phase

  const geo = useMemo(() => new THREE.RingGeometry(0.0, DOT_RADIUS * 1.5, 20), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    color: new THREE.Color(color), transparent: true, opacity: 0.7,
    side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
  }), [color]);

  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);

  // Orient ring to face outward from sphere centre
  const quaternion = useMemo(() => {
    const normal = position.clone().normalize();
    const zAxis  = new THREE.Vector3(0, 0, 1);
    return new THREE.Quaternion().setFromUnitVectors(zAxis, normal);
  }, [position]);

  useFrame((_, delta) => {
    tRef.current += delta * 0.8;
    const t = tRef.current % 1.8 / 1.8; // 0–1 cycle
    if (meshRef.current) {
      const s = 1 + t * 4;
      meshRef.current.scale.setScalar(s);
    }
    if (matRef.current) {
      matRef.current.opacity = Math.max(0, 0.6 * (1 - t));
    }
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geo}
      material={mat}
      position={position}
      quaternion={quaternion}
      ref2={matRef}
    >
      <primitive object={mat} ref={matRef} attach="material" />
    </mesh>
  );
}

// ─── SERVICE DOT ──────────────────────────────────────────────────────────────
const SERVICE_GEO = new THREE.SphereGeometry(DOT_RADIUS, 10, 10);

function ServiceDot({ name, data, onSelect }) {
  const dotRef   = useRef();
  const matRef   = useRef();
  const health   = (data?.health ?? 'healthy').toLowerCase();
  const hexColor = HEALTH_COLORS[health] ?? '#22C55E';
  const color    = useMemo(() => new THREE.Color(hexColor), [hexColor]);
  const position = useMemo(() => {
    const { lat, lng } = serviceToLatLng(name);
    return latLngToVec3(lat, lng, GLOBE_RADIUS + DOT_RADIUS);
  }, [name]);

  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    color, transparent: false,
  }), [color]);

  useEffect(() => () => { mat.dispose(); }, [mat]);

  return (
    <group position={position}>
      <mesh
        ref={dotRef}
        geometry={SERVICE_GEO}
        material={mat}
        onClick={(e) => { e.stopPropagation(); onSelect?.({ name, data, position }); }}
      />
      <PulseRing position={new THREE.Vector3(0, 0, 0)} color={hexColor} />
    </group>
  );
}

// ─── INCIDENT ARC ─────────────────────────────────────────────────────────────
function IncidentArc({ id, fromPos, toPos, color, onExpire }) {
  const lineRef    = useRef();
  const ageRef     = useRef(0);
  const expiredRef = useRef(false);

  const points = useMemo(() => makeArcPoints(fromPos, toPos), [fromPos, toPos]);
  const geo    = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  const mat    = useMemo(() => new THREE.LineBasicMaterial({
    color: new THREE.Color(color), transparent: true, opacity: 1,
  }), [color]);

  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);

  useFrame((_, delta) => {
    if (expiredRef.current) return;
    ageRef.current += delta;
    if (ageRef.current > 3) {
      expiredRef.current = true;
      onExpire(id);
      return;
    }
    if (mat) {
      mat.opacity = ageRef.current < 2 ? 1 : Math.max(0, 1 - (ageRef.current - 2));
    }
  });

  return <line ref={lineRef} geometry={geo} material={mat} />;
}

// ─── GLOBE SCENE (R3F orchestrator) ───────────────────────────────────────────
function GlobeScene({ services, arcs, onArcExpire, onServiceSelect }) {
  const groupRef = useRef();

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += 0.0008 * Math.min(delta * 60, 2);
    }
  });

  const serviceEntries = useMemo(
    () => Object.entries(services ?? {}),
    [services],
  );

  // Fixed origin for incoming arcs
  const originVec = useMemo(() => latLngToVec3(40.71, -74.01, GLOBE_RADIUS + 0.01), []);

  return (
    <>
      <Stars radius={5} depth={2} count={1200} factor={0.6} fade speed={0.3} />
      <OrbitControls
        enableZoom={false} enablePan={false}
        minPolarAngle={Math.PI * 0.2} maxPolarAngle={Math.PI * 0.8}
        rotateSpeed={0.4} dampingFactor={0.1} enableDamping
      />

      <group ref={groupRef}>
        <GlobeMesh />
        <Atmosphere />

        {serviceEntries.map(([name, data]) => (
          <ServiceDot
            key={name} name={name} data={data}
            onSelect={onServiceSelect}
          />
        ))}

        {arcs.map((arc) => {
          const { lat, lng } = serviceToLatLng(arc.service ?? '');
          const toPos = latLngToVec3(lat, lng, GLOBE_RADIUS + 0.01);
          return (
            <IncidentArc
              key={arc.id}
              id={arc.id}
              fromPos={originVec}
              toPos={toPos}
              color={ARC_COLORS[arc.severity] ?? '#00D4FF'}
              onExpire={onArcExpire}
            />
          );
        })}
      </group>
    </>
  );
}

// ─── 2D FALLBACK ──────────────────────────────────────────────────────────────
function GlobeFallback2D({ services }) {
  const entries = Object.entries(services ?? {});
  const count   = entries.length || 1;
  const CX = 160, CY = 160, R = 115;

  return (
    <div className="relative" style={{ width: 320, height: 320 }}>
      {/* Background circles */}
      <motion.div className="absolute inset-0 rounded-full"
        style={{ border: '1px solid rgba(0,212,255,0.12)', backgroundColor: '#060D1A' }}
        animate={{ boxShadow: ['0 0 20px rgba(0,212,255,0.05)', '0 0 40px rgba(0,212,255,0.12)', '0 0 20px rgba(0,212,255,0.05)'] }}
        transition={{ duration: 3, repeat: Infinity }} />
      <div className="absolute inset-4 rounded-full" style={{ border: '1px solid rgba(0,212,255,0.06)' }} />
      <div className="absolute inset-10 rounded-full" style={{ border: '1px solid rgba(0,212,255,0.04)' }} />

      {/* Service dots */}
      {entries.map(([name, data], i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        const x = CX + R * Math.cos(angle);
        const y = CY + R * Math.sin(angle);
        const health  = (data?.health ?? 'healthy').toLowerCase();
        const color   = HEALTH_COLORS[health] ?? '#22C55E';
        const initials = name.slice(0, 2).toUpperCase();

        return (
          <motion.div key={name}
            className="absolute flex items-center justify-center rounded-full font-mono text-[8px] font-black"
            style={{ width: 28, height: 28, left: x - 14, top: y - 14, backgroundColor: `${color}20`, border: `1.5px solid ${color}`, color, boxShadow: `0 0 8px ${color}50` }}
            animate={{ scale: [1, 1.1, 1], boxShadow: [`0 0 6px ${color}40`, `0 0 14px ${color}70`, `0 0 6px ${color}40`] }}
            transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.3 }}
            title={`${name}: ${health}`}>
            {initials}
          </motion.div>
        );
      })}

      {/* Center label */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <p className="font-mono text-[9px] text-[#00D4FF] font-bold tracking-[0.2em]">INFRA</p>
          <p className="font-mono text-[7px] text-gray-700">{entries.length} services</p>
        </div>
      </div>
    </div>
  );
}

// ─── TOOLTIP ──────────────────────────────────────────────────────────────────
function ServiceTooltip({ info, onClose }) {
  if (!info) return null;
  const { name, data } = info;
  const health  = (data?.health ?? 'healthy').toLowerCase();
  const color   = HEALTH_COLORS[health] ?? '#22C55E';
  const cpu     = data?.cpu_pct    ?? 0;
  const disk    = data?.disk_pct   ?? 0;
  const err     = data?.error_rate ?? 0;

  return (
    <AnimatePresence>
      <motion.div
        key={name}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-xl border px-4 py-3 shadow-2xl z-20 min-w-[180px]"
        style={{ backgroundColor: '#0D1117', borderColor: `${color}50` }}
        initial={{ opacity: 0, y: 8, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 4, scale: 0.97 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      >
        <div className="flex items-center gap-2 mb-2">
          <motion.div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }}
            animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
          <p className="font-mono text-[11px] font-bold text-white truncate">{name}</p>
          <span className="ml-auto text-[9px] font-mono font-bold uppercase" style={{ color }}>{health}</span>
        </div>
        <div className="space-y-1">
          {[['CPU', `${cpu.toFixed(1)}%`], ['Disk', `${disk.toFixed(1)}%`], ['Err', `${(err * 100).toFixed(2)}%`]].map(([l, v]) => (
            <div key={l} className="flex justify-between gap-4">
              <span className="text-gray-600 text-[9px] font-mono">{l}</span>
              <span className="text-gray-300 text-[9px] font-mono tabular-nums">{v}</span>
            </div>
          ))}
        </div>
        <p className="text-gray-700 text-[8px] font-mono text-center mt-2">click to dismiss</p>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── ERROR BOUNDARY ───────────────────────────────────────────────────────────
class GlobeErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { errored: false }; }
  static getDerivedStateFromError() { return { errored: true }; }
  componentDidCatch(e) { console.warn('[InfraGlobe] WebGL error, falling back to 2D', e); }
  render() {
    if (this.state.errored) {
      return <GlobeFallback2D services={this.props.services ?? {}} />;
    }
    return this.props.children;
  }
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────
const InfraGlobe = memo(function InfraGlobe() {
  const [services, setServices] = useState({});
  const [arcs, setArcs]         = useState([]);
  const [tooltip, setTooltip]   = useState(null);
  const [webGL]                 = useState(() => webGlSupported());
  const abortRef                = useRef(null);
  const wsRef                   = useRef(null);
  const arcIdRef                = useRef(0);
  const { subscribe }           = useSystem();

  // Fetch services
  const fetchServices = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    api.get('/api/services/state', { signal: abortRef.current.signal })
      .then(({ data }) => { setServices(data && typeof data === 'object' ? data : {}); })
      .catch((e) => {
        if (e.name === 'CanceledError' || e.name === 'AbortError') return;
        console.warn('[InfraGlobe] services API unavailable, using mock', e);
        setServices(MOCK_SERVICES);
      });
  }, []);

  useEffect(() => {
    fetchServices();
    const t = setInterval(fetchServices, 30000);
    return () => { clearInterval(t); abortRef.current?.abort(); };
  }, [fetchServices]);

  // WebSocket — listen for INCIDENT_CREATED and SERVICE_STATE_UPDATED
  useEffect(() => {
    return subscribe('*', (msg) => {
      const type = msg?.type ?? msg?.event_type;
      const d    = msg?.data ?? msg?.payload ?? {};

      if (type === 'INCIDENT_CREATED') {
        const arcId = ++arcIdRef.current;
        setArcs(prev => [...prev, {
          id:       arcId,
          service:  d?.service ?? d?.service_name ?? 'api-gateway',
          severity: d?.severity ?? 'low',
        }]);
      }
      if (type === 'SERVICE_STATE_UPDATED') {
        const svc = d?.service ?? d?.service_name;
        if (svc) setServices(p => ({ ...p, [svc]: { ...(p[svc] ?? {}), ...d } }));
        else fetchServices();
      }
    });
  }, [fetchServices, subscribe]);

  const handleArcExpire = useCallback((id) => {
    setArcs(prev => prev.filter(a => a.id !== id));
  }, []);

  const has2DFallback = !webGL;

  return (
    <div
      className="relative w-full overflow-hidden rounded-2xl border border-[#1C2333]"
      style={{ backgroundColor: '#060D1A', aspectRatio: '1 / 1', maxWidth: 400 }}
    >
      {/* Header overlay */}
      <div className="absolute top-3 left-4 z-10 flex items-center gap-1.5">
        <motion.div className="w-1.5 h-1.5 rounded-full bg-[#00D4FF]"
          animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.8, repeat: Infinity }} />
        <span className="font-mono text-[9px] text-[#00D4FF] tracking-[0.2em] uppercase">
          Global Infra · {Object.keys(services).length} services
        </span>
      </div>

      {has2DFallback ? (
        <div className="flex items-center justify-center w-full h-full">
          <GlobeFallback2D services={services} />
        </div>
      ) : (
        <GlobeErrorBoundary services={services}>
          <Canvas
            camera={{ position: [0, 0, 2.8], fov: 40 }}
            gl={{ antialias: true, alpha: true, powerPreference: 'default' }}
            dpr={[1, 1.5]}
            style={{ width: '100%', height: '100%' }}
            onCreated={({ gl }) => {
              gl.domElement.addEventListener('webglcontextlost', (e) => {
                e.preventDefault();
                console.warn('WebGL context lost — suspending render loop');
                gl.setAnimationLoop(null);
              });
              gl.domElement.addEventListener('webglcontextrestored', () => {
                console.log('WebGL context restored — reinitializing');
                // Fiber automatically handles some recovery, but we log the restoration
              });
            }}
          >
            <Suspense fallback={null}>
              <GlobeScene
                services={services}
                arcs={arcs}
                onArcExpire={handleArcExpire}
                onServiceSelect={setTooltip}
              />
            </Suspense>
          </Canvas>
        </GlobeErrorBoundary>
      )}

      {/* Service tooltip */}
      <ServiceTooltip info={tooltip} onClose={() => setTooltip(null)} />

      {/* Live arc count badge */}
      <AnimatePresence>
        {arcs.length > 0 && (
          <motion.div
            className="absolute top-3 right-3 z-10 px-2 py-0.5 rounded-full font-mono text-[9px] font-bold"
            style={{ backgroundColor: 'rgba(255,59,92,0.2)', color: '#FF3B5C', border: '1px solid rgba(255,59,92,0.4)' }}
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            {arcs.length} incident{arcs.length > 1 ? 's' : ''}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Health legend */}
      <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1">
        {[['Healthy', '#22C55E'], ['Degraded', '#FF9500'], ['Unhealthy', '#FF3B5C']].map(([l, c]) => (
          <div key={l} className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
            <span className="font-mono text-[8px] text-gray-600">{l}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

export default InfraGlobe;
