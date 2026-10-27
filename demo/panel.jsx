// Panel de la demostración: simula la central y muestra las notificaciones que llegan.
import React, { useEffect, useState } from 'react';
import { simularAnomalia } from './api-local.js';

const colores = { fondo: '#FAF6E9', borde: '#005A36', texto: '#0F2A1F', muted: '#4F6459', esmeralda: '#005A36', crit: '#8F2113' };

const botonBase = { minHeight: 44, padding: '8px 14px', borderRadius: 10, font: "600 14px 'Inter', sans-serif", cursor: 'pointer' };

export default function PanelSimulador() {
  const [registro, setRegistro] = useState([]);
  const [permiso, setPermiso] = useState(typeof Notification === 'undefined' ? 'no-disponible' : Notification.permission);
  const [abierto, setAbierto] = useState(true);

  useEffect(() => {
    window.__agrynAviso = (titulo, detalle) => {
      setRegistro((r) => [{ hora: new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), titulo, detalle }, ...r].slice(0, 8));
    };
    return () => { delete window.__agrynAviso; };
  }, []);

  const pedirPermiso = async () => {
    if (typeof Notification === 'undefined') return;
    const r = await Notification.requestPermission();
    setPermiso(r);
  };

  const simular = (tipo) => {
    const r = simularAnomalia(tipo);
    if (!r.ok) return window.__agrynAviso('Sin alarma nueva', r.mensaje);
    window.__agrynAviso(r.titulo, r.silo + ' · ' + r.nodo + ' (la central lo mandó)');
  };

  const estadoPermiso = { granted: 'Permitidas', denied: 'Bloqueadas en el navegador', default: 'Sin pedir', 'no-disponible': 'No disponibles en este navegador' }[permiso];

  if (!abierto) {
    return <button type="button" onClick={() => setAbierto(true)} style={{ ...botonBase, position: 'fixed', right: 16, bottom: 16, background: colores.esmeralda, color: colores.fondo, border: 0, zIndex: 50 }}>Simulador</button>;
  }

  return (
    <aside aria-label="Simulador de la central" style={{ position: 'fixed', right: 16, bottom: 16, width: 'min(340px, calc(100vw - 32px))', maxHeight: '80vh', overflow: 'auto', background: colores.fondo, color: colores.texto, border: `2px solid ${colores.borde}`, borderRadius: 14, padding: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', zIndex: 50, font: "400 14px/1.45 'Montserrat', sans-serif" }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <strong style={{ font: "700 16px 'Inter', sans-serif" }}>Simulador de la central</strong>
        <button type="button" onClick={() => setAbierto(false)} style={{ ...botonBase, minHeight: 44, minWidth: 44, padding: 0, background: 'transparent', color: colores.texto, border: `1px solid ${colores.muted}` }} aria-label="Minimizar simulador">–</button>
      </div>
      <p style={{ margin: '8px 0', color: colores.muted }}>Así llegarían las alarmas desde la central. Elegí una y mirá la notificación y el diagnóstico en la app.</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={() => simular('rotura')} style={{ ...botonBase, background: colores.crit, color: colores.fondo, border: 0 }}>Simular rotura</button>
        <button type="button" onClick={() => simular('fermentacion')} style={{ ...botonBase, background: colores.esmeralda, color: colores.fondo, border: 0 }}>Simular fermentación</button>
        {permiso !== 'granted' && permiso !== 'no-disponible' && permiso !== 'denied' && (
          <button type="button" onClick={pedirPermiso} style={{ ...botonBase, background: 'transparent', color: colores.esmeralda, border: `2px solid ${colores.esmeralda}` }}>Activar notificaciones</button>
        )}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: colores.muted }}>Notificaciones: {estadoPermiso}</p>

      <h3 style={{ margin: '12px 0 6px', font: "700 14px 'Inter', sans-serif" }}>Notificaciones recibidas</h3>
      {registro.length === 0 && <p style={{ margin: 0, color: colores.muted }}>Todavía no llegó ninguna.</p>}
      <ul role="log" aria-live="polite" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {registro.map((n, i) => (
          <li key={i} style={{ background: '#F1F6F3', border: '1px solid #DCE5E0', borderRadius: 10, padding: '8px 10px' }}>
            <div style={{ fontSize: 12, color: colores.muted }}>{n.hora}</div>
            <strong>{n.titulo}</strong>
            <div>{n.detalle}</div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
