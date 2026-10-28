import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { clearTokens } from '../auth';

function readProfile() {
  try {
    const raw = localStorage.getItem('userProfile');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function Header() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [userProfile, setUserProfile] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const sync = () => {
      const email = localStorage.getItem('userEmail');
      setIsLoggedIn(!!email);
      setUserEmail(email || '');
      setUserProfile(readProfile());
    };
    sync();
    const onStorage = (e) => {
      if (e.key === 'token' || e.key === 'userEmail' || e.key === 'userProfile') sync();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleLogout = () => {
    clearTokens();
    window.location.href = '/login';
  };

  return (
    <header className="app-header">
      <div className="header-inner">

        <div className="header-logo">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="22" fill="white" stroke="#b11226" strokeWidth="2" />
            <text x="24" y="30" fontSize="20" fontWeight="bold" fill="#b11226" textAnchor="middle" fontFamily="serif">R</text>
          </svg>
        </div>

        <h1 className="header-title">Radford Events Ticketing</h1>

        <div className="header-actions">
          {isLoggedIn ? (
            <div ref={menuRef} className="header-user">

              {/* Avatar button — opens dropdown */}
              <button
                className="header-avatar"
                onClick={() => setMenuOpen(o => !o)}
                aria-label="User menu"
                aria-expanded={menuOpen}
              >
                {userProfile?.photoUrl ? (
                  <img
                    src={userProfile.photoUrl}
                    alt="Profile"
                    style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
                  />
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                )}
              </button>

              {/* Dropdown */}
              {menuOpen && (
                <div className="header-dropdown" onClick={() => setMenuOpen(false)}>
                  {/* Email + role — always visible here for mobile */}
                  <div className="header-dropdown-email">
                    {userEmail}
                    {userProfile?.Type && userProfile?.Role && (
                      <span style={{ display: 'block', marginTop: '4px', fontSize: '0.78rem', color: '#b11226', fontWeight: 600 }}>
                        {userProfile.Type} · {userProfile.Role}
                      </span>
                    )}
                  </div>

                  {/* Profile link */}
                  <Link
                    to="/profile"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', fontSize: '0.9rem', fontWeight: 500, color: '#1a1a1a', textDecoration: 'none', transition: 'background 0.15s ease' }}
                    onMouseOver={e => e.currentTarget.style.background = '#f5f5f5'}
                    onMouseOut={e => e.currentTarget.style.background = 'none'}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    View Profile
                  </Link>

                  {/* Logout */}
                  <button className="header-dropdown-logout" onClick={handleLogout}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    Logout
                  </button>
                </div>
              )}
            </div>
          ) : (
            <span className="user-status">Not logged in</span>
          )}
        </div>

      </div>
    </header>
  );
}
