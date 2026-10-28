import { useState, useEffect } from 'react';

export default function UpdateEvent({ event_id }) {
  const [event, setEvent] = useState(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  // Fetch current event data on mount
  useEffect(() => {
    const fetchEvent = async () => {
      try {
        const res = await fetch(
          `https://service.example.invalid/production/Group-2/${event_id}`
        );
        if (res.ok) {
          const data = await res.json();
          setEvent(data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    if (event_id) fetchEvent();
  }, [event_id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('');

    const formData = new FormData(e.target);
    const payload = { id: event_id, ...Object.fromEntries(formData.entries()) };

    try {
      const response = await fetch(
        'https://service.example.invalid/production/Group-2/Update-Event',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

      if (response.ok) {
        setStatus('Event updated successfully!');
      } else {
        setStatus('Failed to update event.');
      }
    } catch (err) {
      setStatus('Network error.');
      console.error(err);
    }
  };

  if (loading) return <p>Loading event...</p>;
  if (!event) return <p>Event not found.</p>;

  return (
    <div className="mountain-section">
      <h2>Update Event</h2>
      <form onSubmit={handleSubmit}>
        <label>Event Name: <input name="event_name" defaultValue={event.event_name} /></label>
        <label>Location: <input name="location" defaultValue={event.location} /></label>
        <label>Date: <input name="date_time" type="datetime-local" defaultValue={event.date_time} /></label>
        <label>Seat Count: <input name="seat_count" type="number" defaultValue={event.seat_count} /></label>
        <label>Price: <input name="price" type="number" step="0.01" defaultValue={event.price} /></label>
        <label>Description: <textarea name="description" rows={4} defaultValue={event.description} /></label>
        <label>Categories: <textarea name="categories" rows={4} defaultValue={event.categories} /></label>
        <label>Images: <textarea name="images" rows={4} defaultValue={event.images} /></label>
        <label>Documents: <textarea name="documents" rows={4} defaultValue={event.documents} /></label>

        <button type="submit" className="btn-primary">Update Event</button>
      </form>
      {status && <p>{status}</p>}
    </div>
  );
}