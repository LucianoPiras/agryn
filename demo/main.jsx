// Versión de demostración: la misma app, con una API simulada en el navegador.
// Se compila a un solo archivo HTML con scripts/armar-demo.mjs.
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import '../src/index.css';
import { instalarApiDemo } from './api-local.js';

instalarApiDemo();
createRoot(document.getElementById('root')).render(<App />);
