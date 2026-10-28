import { useState, useEffect } from 'react';

export default function GetEventUsers({ event_id }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch(
          `https://service.example.invalid/production/Group-3/tickets/geteventsales?event_id=${event_id}`
        );
        if (res.ok) {
          const data = await res.json();
          setUsers(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (event_id) fetchUsers();
  }, [event_id]);

  return (
    <div>
      <h3>Users Who Purchased This Event</h3>
      {loading ? (
        <p>Loading...</p>
      ) : users.length === 0 ? (
        <p>No users found.</p>
      ) : (
        <ul>
          {users.map((user, i) => (
            <li key={i}>{user.email || user.name || user}</li>
          ))}
        </ul>
      )}
    </div>
  );
}