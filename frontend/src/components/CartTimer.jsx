/**
 * @file components/CartTimer.jsx
 * @description Drift-proof countdown timer for the Rolling Cart reservation window.
 *
 * ── Why wall-clock math instead of a decrement counter ───────────────────────
 *   A naive timer does: timeLeft -= 1 each second.
 *   Problem: when a user switches tabs on mobile, the browser throttles or
 *   pauses JavaScript — the timer stops ticking but real time keeps passing.
 *   When the user returns, the displayed time is ahead of reality.
 *
 *   Fix: on every tick, calculate remaining time directly from the wall clock:
 *     Math.max(0, new Date(expiresAt) - Date.now())
 *   No matter how long the tab was dormant, the first tick after waking shows
 *   the correct time remaining.
 *
 * ── Visual urgency ────────────────────────────────────────────────────────────
 *   The banner turns red with a 🚨 icon in the last 60 seconds to prompt
 *   the user to complete checkout before their hold expires.
 *
 * Props:
 *   expiresAt {string}   - ISO 8601 timestamp from the reserve-tickets API
 *                          (e.g. "2026-04-04T17:03:41.675Z").
 *   onExpire  {Function} - Called exactly once when remaining time hits 0:00.
 *                          Cart.jsx uses this to clear state and show the expiry modal.
 */
import { useState, useEffect, useRef } from 'react';

/**
 * CartTimer — displays a live MM:SS countdown and fires onExpire at zero.
 *
 * @param {{ expiresAt: string, onExpire: () => void }} props
 * @returns {JSX.Element}
 */
export default function CartTimer({ expiresAt, onExpire }) {
  const [msLeft, setMsLeft] = useState(() => Math.max(0, new Date(expiresAt) - Date.now()));

  // Keep a stable ref to onExpire so the interval closure never captures a
  // stale callback, even if the parent re-renders with a new function reference.
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  // Track whether we've already fired onExpire so we don't call it twice
  // if the interval fires a second time before the component unmounts.
  const firedRef = useRef(false);

  useEffect(() => {
    firedRef.current = false;

    const tick = () => {
      const remaining = Math.max(0, new Date(expiresAt) - Date.now());
      setMsLeft(remaining);
      if (remaining === 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current();
      }
    };

    // Tick immediately so there's no 1-second blank on mount.
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const totalSeconds = Math.floor(msLeft / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const formatted = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  // Turn red in the last 60 seconds to signal urgency.
  const isUrgent = totalSeconds <= 60;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      padding: '0.6rem 1.1rem',
      background: isUrgent ? '#fee2e2' : '#fef3c7',
      border: `1.5px solid ${isUrgent ? '#dc2626' : '#d97706'}`,
      borderRadius: 'var(--radius)',
      color: isUrgent ? '#dc2626' : '#92400e',
      fontWeight: '600',
      fontSize: '0.95rem',
      marginBottom: '1.5rem',
    }}>
      <span>{isUrgent ? '🚨' : '⏱'}</span>
      <span>Your cart expires in <strong>{formatted}</strong> — complete checkout before time runs out!</span>
    </div>
  );
}
