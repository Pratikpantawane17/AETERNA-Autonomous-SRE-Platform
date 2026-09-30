import React from 'react';
import ReactDOM from 'react-dom/client';
import { SystemProvider } from './context/SystemContext';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SystemProvider>
      <App />
    </SystemProvider>
  </React.StrictMode>
);
