/**
 * Displays the public-facing ticketing landing page and trending event list.
 */
import React, { useState, useEffect } from 'react';


/**
 * Fetches trending ticket counts and renders the customer ticketing experience.
 *
 * @returns {JSX.Element} The customer-facing landing page.
 */
const Trending = () => {
  const [tickets, setTickets] = useState([]);
  const makeDate = new Date()
  const today = makeDate.toISOString().slice(0,10);
  const lastWeek = new Date(makeDate.setDate(makeDate.getDate() - 7)).toISOString().slice(0, 10);;
  const [startDate, setStartDate] = useState(lastWeek);
  const [endDate] = useState(today);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [active, setActive] = useState("weekly"); // ← define active state

  // fetch tickets from API
  /**
   * Retrieves ticket totals for the provided date range.
   *
   * @param {string} start - The inclusive ISO start date.
   * @param {string} finish - The inclusive ISO end date.
   * @returns {Promise<object|null>} The parsed ticket payload, or `null` on failure.
   */
  const getTickets = async (start, finish) => {
    try {
      const TICKETS_URL = import.meta.env.VITE_TEAM3_GET_SALES_BY_DATE
      const ticket_call = `${TICKETS_URL}?dateFrom=${startDate}&dateTo=${finish}`

      const response = await fetch(ticket_call);
      const outer = await response.json();
      let parsed = outer;
      while (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch (e) {
          break;
        }
      }

      if (parsed && typeof parsed.body === 'string') {
        try {
          parsed = JSON.parse(parsed.body);
        } catch (e) {}
      }
      return parsed;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  const getEvents = async(eventIds) => {
    //url for the events. if the vite variables are not available use the hardcode address, otherwise use vite. 

      const events_url = import.meta.env.VITE_TEAM2_GET_EVENTS_BY_ID 

      //only promise 5 at a time to prevent rate limiting
      const chunkSize = 5; 
      let results = [];  

      for (let i = 0; i < eventIds.length; i += chunkSize) {
        // each time through, grab the next 5 values if they exist
        const chunk = eventIds.slice(i, i+chunkSize)

        //query with all 5 values, using promise to speed up the process, only wait on slowest load
        const events = await Promise.all(
          chunk.map(id =>
          //have to jsonify it, comes in as a cors header otherwise
           fetch(`${events_url}${id}`).then(res => res.json())
          )
        );
        //pushes all objects from events to the end of the array results
        results.push(...events)
      }
      return results; 
  }

  // process and sort ticket data
  /**
   * Converts the raw ticket response into a sorted list of event totals.
   *
   * @param {object} data - The raw ticket response object.
   * @returns {Array<[string, number]>} Sorted event/count tuples.
   */
  const processTicketData = async(data) => {
    if (!data || typeof data !== 'object') {
      setError('No valid data received');
      return [];
    }

    let results = new Map(); 
    data.sales.forEach(sale => {
      if(results.has(sale.eventId)) {
        results.set(sale.eventId, (results.get(sale.eventId))+1)
    }
        else { results.set(sale.eventId, 1) }
    });

    //getEvents returns a map where each row is the eventid and then the entire value from the table for that event id. 
    const events = await getEvents(Array.from(results.keys()));
 
    //we have the events objects, we now need to iterate over them, put any that have not happened yet and any that are not cancelled into a new map. 
    //new map needs to have the id, name, number of tickets sold, the date, the time, location

    //format the events output to be returned to the front end
    const formatted = events.filter(event => event.status != "CANCELLED" &&  new Date(event.date_time) > new Date()).map(event => {
        const datetime = new Date(event.date_time);

        return {
          id: event.event_id,
          name: event.event_name,
          location: event.venue_name, 
          sold: results.get(event.event_id),
          date:  datetime.toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"}),
          time: datetime.toLocaleTimeString("en-us", {hour: "2-digit", minute: "2-digit"})
      }
    })
    
    const filtered = formatted.sort((a, b) => b.sold - a.sold).slice(0, 5);

    return filtered;
  };

  // fetch and render tickets
  /**
   * Loads the latest ticket data and stores the top trending events.
   *
   * @returns {Promise<void>}
   */
  const fetchTickets = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTickets(startDate, endDate);
      const sortedTickets = await processTicketData(data);
      const splitTickets = sortedTickets.slice(0,5); 
      setTickets(splitTickets);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  //functions for dates
  /**
   * Sets the active range to the previous day.
   */
  const toDaily = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    setStartDate(d.toISOString().slice(0,10));
  }

  /**
   * Sets the active range to the previous week.
   */
  const toWeekly = () => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    setStartDate(d.toISOString().slice(0,10));
  }

  /**
   * Sets the active range to the previous month.
   */
  const toMonthly = () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1); 
    setStartDate(d.toISOString().slice(0,10));
  }

  // initial render
  useEffect(() => {
    fetchTickets();
  }, [startDate]);

  return (
   
<>
  <h2 className="section-title">Top Events</h2>
  <div className="category-selector">
    <button className={`${active === "daily" ? "btn-primary" : "btn-accent"}`} onClick={() => {toDaily(); setActive("daily");}}>Daily</button>
    <button className={`${active === "weekly" ? "btn-primary" : "btn-accent"}`} onClick={() => {toWeekly(); setActive("weekly");}}>Weekly</button>
    <button className={`${active === "monthly" ? "btn-primary" : "btn-accent"}`}onClick={() => {toMonthly(); setActive("monthly");}}>Monthly</button>
  </div>

  {loading && (
    <div className="loading-state">⏳ Loading events...</div>
  )}

  {tickets.length === 0 && !loading && (
    <div className = "ticket-card">No {active} trending events.</div>
  )}

  {error && <p className="error">{error}</p>}
  {tickets.length > 0 && !loading && (
    tickets.map((ticket, index) => (
    <div className="ticket-card">
      <div className ="event-info">
        <div className="ticket-flex">
          <h3 key={index} className ="ticket-title">{ticket.name}</h3>
          <div className="ticket-meta">📅 {ticket.date} • {ticket.time} • 📍 {ticket.location} </div>
        </div>
      <div className = "view-event-btn">
        <button className="btn-primary" onClick={() => {window.location.href = `/venue.html?event_id=${encodeURIComponent(ticket.id)}&event_name=${encodeURIComponent(ticket.name)}`;}}>View Event</button>
      </div>
    </div>

    </div>
    )))}
</>          


);
};

export default Trending;
