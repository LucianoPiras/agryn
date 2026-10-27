// Versión de demostración: la misma app, con una API simulada en el navegador y un simulador de la central.
// Se compila a un solo archivo HTML con scripts/armar-demo.mjs.
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import '../src/index.css';
import { instalarApiDemo } from './api-local.js';
import PanelSimulador from './panel.jsx';

// Las notificaciones del navegador se muestran también dentro de la página, por si el navegador
// no permite mostrarlas (por ejemplo, en Android sin service worker).
if (typeof window.Notification !== 'undefined') {
  const Original = window.Notification;
  window.Notification = new Proxy(Original, {
    construct(destino, args) {
      const [titulo, opciones = {}] = args;
      if (window.__agrynAviso) window.__agrynAviso(titulo, opciones.body || '');
      try { return new destino(titulo, opciones); } catch (e) { return { close() {} }; }
    }
  });
}

instalarApiDemo();
createRoot(document.getElementById('root')).render(
  <>
    <App />
    <PanelSimulador />
  </>
);
