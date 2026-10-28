import { useState, useEffect } from 'react';

export default function useIsUsersEvent(userid, eventid) {
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userid || !eventid) {
      setLoading(false);
      return;
    }

    const checkOwnership = async () => {
      try {
        const res = await fetch(
          `https://service.example.invalid/production/Group-2/${eventid}`
        );
        if (res.ok) {
          const event = await res.json();
          setIsOwner(userid === event.user_id || userid === event.event_creator);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    checkOwnership();
  }, [userid, eventid]);

  return { isOwner, loading };
}