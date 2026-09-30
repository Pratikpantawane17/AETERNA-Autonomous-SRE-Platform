import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import ServicesMonitor from '../components/services/ServicesMonitor';
import ServiceDetailModal from '../components/services/ServiceDetailModal';

export default function Services() {
  const [selected, setSelected] = useState(null); // { name, data }

  return (
    <>
      <ServicesMonitor onServiceClick={(name, data) => setSelected({ name, data })} />

      <AnimatePresence>
        {selected && (
          <ServiceDetailModal
            key={selected.name}
            serviceName={selected.name}
            serviceData={selected.data}
            onClose={() => setSelected(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}