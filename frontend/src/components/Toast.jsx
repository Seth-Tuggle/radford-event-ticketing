/**
 * @file components/Toast.jsx
 * @description Slide-in toast notification for the React SPA.
 *
 * Matches the visual style of venue-app.js's showToast() — dark navy cards
 * with a coloured left border that slide in from the right and auto-dismiss.
 * Positioned fixed in the bottom-right corner so it doesn't push page content.
 *
 * Usage:
 *   <Toast message="Something happened" type="error" onClose={() => set(null)} />
 *
 * Types: "error" (red border), "success" (green border), "info" (subtle border).
 */
import { useEffect, useState } from 'react';

/** @type {Object<string, React.CSSProperties>} */
const styles = {
  container: {
    position: 'fixed',
    bottom: '90px',
    right: '24px',
    zIndex: 9999,
    pointerEvents: 'none',
    maxWidth: '340px',
    width: 'calc(100% - 48px)',
  },
  toast: {
    background: '#0d1b2a',
    color: '#fff',
    padding: '14px 18px',
    borderRadius: '10px',
    borderLeft: '4px solid #0d1b2a',
    boxShadow: '0 8px 28px rgba(0,0,0,0.22)',
    fontSize: '0.9rem',
    lineHeight: 1.4,
    pointerEvents: 'all',
    cursor: 'pointer',
  },
  title: {
    fontWeight: 600,
    fontSize: '0.92rem',
    marginBottom: '2px',
  },
  msg: {
    fontSize: '0.84rem',
    opacity: 0.75,
  },
};

const borderColors = {
  error: '#b11226',
  success: '#059669',
  info: 'rgba(255,255,255,0.25)',
};

export default function Toast({ title, message, type = 'error', duration = 5000, onClose }) {
  const [phase, setPhase] = useState('in'); // 'in' | 'out'

  useEffect(() => {
    const timer = setTimeout(() => {
      setPhase('out');
      setTimeout(() => onClose?.(), 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const handleClick = () => {
    setPhase('out');
    setTimeout(() => onClose?.(), 300);
  };

  const animStyle = phase === 'in'
    ? { animation: 'toastIn 0.25s ease forwards' }
    : { animation: 'toastOut 0.3s ease forwards' };

  return (
    <>
      <style>{`
        @keyframes toastIn  { from { opacity:0; transform:translateX(16px); } to { opacity:1; transform:translateX(0); } }
        @keyframes toastOut { from { opacity:1; transform:translateX(0); } to { opacity:0; transform:translateX(16px); } }
      `}</style>
      <div style={styles.container}>
        <div
          style={{ ...styles.toast, borderLeftColor: borderColors[type] || borderColors.info, ...animStyle }}
          onClick={handleClick}
          role="alert"
        >
          {title && <div style={styles.title}>{title}</div>}
          {message && <div style={styles.msg}>{message}</div>}
        </div>
      </div>
    </>
  );
}
