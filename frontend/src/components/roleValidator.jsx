import { useState, useEffect } from 'react';

const API_BASE = 'https://service.example.invalid/production';

export function useUserRole(userID) {
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userID) {
      setLoading(false);
      return;
    }

    const fetchRole = async () => {
      try {
        const res = await fetch(`${API_BASE}/Team-7/${userID}`);
        if (res.ok) {
          const data = await res.json();
          setRole(data.role || data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchRole();
  }, [userID]);

  const isUser = role === 'User' || role?.includes('User');
  const isEventOrganizer = role === 'EventOrganizer' || role?.includes('EventOrganizer');
  const isAdmin = role === 'Admin' || role?.includes('Admin');

  return { role, loading, isUser, isEventOrganizer, isAdmin };
}