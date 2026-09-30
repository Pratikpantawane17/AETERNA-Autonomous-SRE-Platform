import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const WS_BASE  = import.meta.env.VITE_WS_URL       || 'ws://localhost:8000';

export const API_KEY = import.meta.env.VITE_AETERNA_API_KEY || import.meta.env.VITE_GROQ_API_KEY || 'cummins-demo-key';
export const WS_URL  = `${WS_BASE}/ws?api_key=${API_KEY}`;

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'X-Api-Key': API_KEY,
    'Content-Type': 'application/json',
  },
});

export { api };
export default api;
