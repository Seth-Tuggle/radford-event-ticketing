import { useState } from 'react';

export default function CreateEvent({ user_id }) {
  const [status, setStatus] = useState('');

  const toApiDateTime = (value) => {
  if (!value) return "";
  return `${value}:00-04:00`;
};

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('');

    const form = new FormData(e.target);

    const payload = {
      event_name: form.get('event_name')?.trim(),
      date_time: toApiDateTime(form.get('date_time')),
      end_date_time: toApiDateTime(form.get('end_date_time')),
      location: form.get('location')?.trim(),
      venue_name: form.get('venue_name')?.trim(),
      layout_name: form.get('layout_name')?.trim(),
      seat_count: Number(form.get('seat_count')),
      budget_price: Number(form.get('budget_price')),
      standard_price: Number(form.get('standard_price')),
      vip_price: Number(form.get('vip_price')),
      description: form.get('description')?.trim() || '',
      categories: form.get('categories')
        ? form.get('categories').split(',').map(s => s.trim()).filter(Boolean)
        : [],
      images: [],
      documents: [],
      event_creator: user_id,
    };

    try {
      console.log("payload:", payload);
      const response = await fetch(
        'https://service.example.invalid/production/Group-2/Create-Event',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );

     const text = await response.text();
    console.log('status:', response.status);
    console.log('response body:', text);

      if (response.ok) {
        setStatus('Event created successfully!');
        e.target.reset();
      } else {
        setStatus(`Error: ${data.message || response.statusText}`);
      }
    } catch (err) {
      console.error(err);
      setStatus('Network error. Please try again.');
    }
  };

  return (
    <div className="mountain-section">
      <h2>Create New Event</h2>
      <form onSubmit={handleSubmit}>
        <label>Event Name: <input name="event_name" required /></label>
        <label>Start Date: <input name="date_time" type="datetime-local" required /></label>
        <label>End Date: <input name="end_date_time" type="datetime-local" required /></label>
        <label>Location: <input name="location" required /></label>
        <label>Venue Name: <input name="venue_name" required /></label>
        <label>Layout Name: <input name="layout_name" required /></label>
        <label>Seat Count: <input name="seat_count" type="number" min="1" required /></label>

        <label>Budget Price: <input name="budget_price" type="number" step="0.01" required /></label>
        <label>Standard Price: <input name="standard_price" type="number" step="0.01" required /></label>
        <label>VIP Price: <input name="vip_price" type="number" step="0.01" required /></label>

        <label>Description:
          <textarea name="description" rows={4} />
        </label>

        <label>Categories:
          <input name="categories" placeholder="Concert, Student, Sports" />
        </label>

        <button type="submit" className="btn-primary">Create Event</button>
      </form>

      {status && <p>{status}</p>}
    </div>
  );
}