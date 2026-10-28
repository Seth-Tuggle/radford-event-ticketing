/**
 * Displays summary analytics charts for tickets, attendance, event type, and venue trends.
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import Plotly from "plotly.js-dist-min";
/**
 * Renders the overview analytics dashboard.
 *
 * @returns {JSX.Element} The analytics overview view.
 */
  const TICKETS_URL = import.meta.env.VITE_TEAM3_GET_SALES_BY_DATE
  const ATTENDANCE_URL = import.meta.env.VITE_TEAM3_GET_ATTENDANCE_BY_DATE
  const EVENT_URL = import.meta.env.VITE_TEAM2_GET_EVENTS_BY_ID

export default function AnalyticsOverview() {
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState(null); // store data separately

  const chartBlue = "#0d1b2a";
  const chartRed = "#c2011b";

  // initialize references to the plots
  const monthlyTicketRef = useRef(null);
  const monthlyAttendanceRef = useRef(null);
  const eventTypeRef = useRef(null);
  const venueTypeRef = useRef(null);

/**
 * Loads monthly ticket or attendance totals for the trailing year.
 *
 * @param {string} type - The dataset type to retrieve.
 * @returns {Promise<Array<{month: string, data: number}>|undefined>} Monthly aggregate values.
 */
  const ticketData = useCallback(
    async (type) => {
      try {

        //calculate the current date, the current month, and the starting point of 1 y4ear ago
        const now = new Date();
        const startMonth = now.getMonth();
        const lastYear = now.getFullYear() - 1;

        const monthlyData = await Promise.all(
          Array.from({ length: 12 }, (_, i) => {
            const curMonth = startMonth + i;
            const cleanDate = new Date(lastYear, curMonth, 1);
            const startDate = cleanDate.toISOString().slice(0, 10);
            const endDate = new Date(lastYear, curMonth + 1, 0).toISOString().slice(0, 10);

            const url = type === 'attendance'
              ? `${ATTENDANCE_URL}?dateFrom=${startDate}&dateTo=${endDate}`
              : `${TICKETS_URL}?dateFrom=${startDate}&dateTo=${endDate}`;

            return fetch(url).then(r => r.json()).then(response => ({
              month: cleanDate.toLocaleString("default", { month: "short" }),
              data: response.statusCode !== 404 ? response[type === 'attendance' ? 'totalTicketsUsed' : 'totalTicketsSold'] : 0
            }));

          })
        );
        return monthlyData;
      } catch (err) {
        console.error("Error fetching ticket data", err);
      }
    },
    [TICKETS_URL, ATTENDANCE_URL]
  );

  //helper function to get ecvents from the event url
  const getEvents = async (eventIds) => {

    //only promise 5 at a time to prevent rate limiting
    const chunkSize = 5;
    let results = [];

    for (let i = 0; i < eventIds.length; i += chunkSize) {
      // each time through, grab the next 5 values if they exist
      const chunk = eventIds.slice(i, i + chunkSize)

      //query with all 5 values, using promise to speed up the process, only wait on slowest load
      const events = await Promise.all(
        chunk.map(id =>
          //have to jsonify it, comes in as a cors header otherwise
          fetch(`${EVENT_URL}${id}`).then(res => res.json())
        )
      );
      //pushes all objects from events to the end of the array results
      results.push(...events)
    }
    return results;
  }

/**
 * Loads annual grouped totals by event type or venue.
 *
 * @param {string} type - The grouping to request.
 * @returns {Promise<Array<{type: string, data: number}>|undefined>} Annual grouped totals.
 */
  const eventData = useCallback(
    async () => {
      try {
        const now = new Date();
        const startMonth = now.getMonth();
        const lastYear = now.getFullYear() - 1;

        const startDate = new Date(lastYear, startMonth, 1).toISOString().slice(0, 10);
        const monthStart = new Date(now.getFullYear(), startMonth, 0);
        const endDate = monthStart.toISOString().slice(0, 10);

        let url = `${ATTENDANCE_URL}?dateFrom=${startDate}&dateTo=${endDate}`;

        const response = await (await fetch(url)).json();

        if (!response || typeof response !== "object") {
          console.error("Unexpected Lambda body");
          return [];
        }

        //get all aggregate the totals for each event. 
        let results = new Map();
        response.sales.forEach(sale => {
          if (results.has(sale.eventId)) {
            results.set(sale.eventId, (results.get(sale.eventId)) + 1)
          }
          else { results.set(sale.eventId, 1) }
        });
        //getEvents returns a map where each row is the eventid and then the entire value from the table for that event id. 
        const events = await getEvents(Array.from(results.keys()));
        //at this point I will have the totals for each event in the results map, and the event data in the events object. I now need to compile all of that. 

        events.forEach(eventItem => {
          //iterate over the events, for each event get its id, fetch the total from the map. 
          let storedTotal = results.get(eventItem.event_id);
          //iterate update the results to store the total, the category, the venue name;
          results.set(eventItem.event_id, [storedTotal, eventItem.categories, eventItem.venue_name]);
        })

        //have put all the data in to one map. Now I need to do aggregation 

        const venueMap = new Map();
        const categoryMap = new Map();

        results.forEach(row => {
          //if the venue is in the map, update the value, if its not add it with the value. 
          if (venueMap.has(row[2])) { venueMap.set(row[2], (venueMap.get(row[2]) + row[0])) }
          else (venueMap.set(row[2], row[0]));

          //for each category in the category array, if its in the map increase it, if not, add it
          row[1].forEach(category => {
            if (categoryMap.has(category)) {
              categoryMap.set(category, categoryMap.get(category) + row[0])
            }
            else (categoryMap.set(category, row[0]))
          })
        })

        const eventData = {
          eventType: categoryMap,
          venues: venueMap
        };
        return eventData;
      } catch (err) {
        console.error("Error fetching data", err);
      }
    }, [ATTENDANCE_URL, EVENT_URL]);

  useEffect(() => {
    if (loading || !chartData) return;
    if (!monthlyTicketRef.current) return;

    const { data, attendance, event } = chartData;
    monthlyTickets(data);
    monthlyAttendance(attendance);
    eventTypePopularity(event);
    venuePopularity(event);
  }, [loading, chartData]); // triggers after loading flips to false

  useEffect(() => {
    const loadCharts = async () => {
      try {
        const data = await ticketData('tickets');
        const attendance = await ticketData('attendance');
        const event = await eventData();
        setChartData({ data, attendance, event }); // store, don't draw yet
      } catch (err) {
        console.error("Error loading charts", err);
      } finally {
        setLoading(false); // now reveal the divs
      }
    };
    loadCharts();
  }, [ticketData, eventData]);

  // Resize Plotly on window resize
  useEffect(() => {
    const observers = [];

    const refs = [monthlyTicketRef, monthlyAttendanceRef, eventTypeRef, venueTypeRef];

    refs.forEach(ref => {
      if (!ref.current) return;
      const observer = new ResizeObserver(() => {
        Plotly.Plots.resize(ref.current);
      });
      observer.observe(ref.current);
      observers.push(observer);
    });

    return () => observers.forEach(o => o.disconnect());
  }, []);

  /**
   * Draws the monthly ticket sales chart.
   *
   * @returns {Promise<void>}
   */
  const monthlyTickets = async (ticketData) => {
    if (!ticketData || !monthlyTicketRef.current) return;

    const x = ticketData.map((result) => result.month);
    const y = ticketData.map((result) => result.data);

    const plotData = [{ x, y, type: "bar", marker: { color: chartBlue } }];

    const layout = {
      height: monthlyTicketRef.current.offsetWidth * 0.6,

      yaxis: { title: "Tickets Sold", rangemode: "tozero", automargin: true },
      xaxis: { automargin: true, tickangle: -45 },
      plot_bgcolor: "rgba(255,255,255,0.92)",
      paper_bgcolor: "rgba(255,255,255,0.92)",
      margin: { t: 70, r: 30, l: 60, b: 90 },
    };

    Plotly.react(monthlyTicketRef.current, plotData, layout, {
      displayModeBar: false,
      responsive: true,
    });
  };

  /**
   * Draws the monthly attendance chart.
   *
   * @returns {Promise<void>}
   */
  const monthlyAttendance = async (attendanceData) => {
    if (!attendanceData || !monthlyAttendanceRef.current) return;

    const x = attendanceData.map((result) => result.month);
    const y = attendanceData.map((result) => result.data);

    const plotData = [{ x, y, type: "bar", marker: { color: chartBlue } }];

    const layout = {
      height: monthlyTicketRef.current.offsetWidth * 0.6,
      yaxis: { title: "Attendance", rangemode: "tozero", automargin: true },
      xaxis: { automargin: true, tickangle: -45 },
      plot_bgcolor: "rgba(255,255,255,0.92)",
      paper_bgcolor: "rgba(255,255,255,0.92)",
      margin: { t: 70, r: 30, l: 60, b: 90 },
    };

    Plotly.react(monthlyAttendanceRef.current, plotData, layout, {
      displayModeBar: false,
      responsive: true,
    });
  };

  /**
   * Draws the annual attendance-by-type chart.
   *
   * @returns {Promise<void>}
   */
  const eventTypePopularity = async (attendanceData) => {
    if (!attendanceData || !eventTypeRef.current) return;

    const x = [...attendanceData.eventType.keys()];
    const y = [...attendanceData.eventType.values()];

    const plotData = [{ x, y, type: "bar", marker: { color: chartBlue } }];

    const layout = {
      height: monthlyTicketRef.current.offsetWidth * 0.6,

      yaxis: { title: "Attendance", rangemode: "tozero", automargin: true },
      xaxis: { automargin: true, tickangle: -45 },
      plot_bgcolor: "rgba(255,255,255,0.92)",
      paper_bgcolor: "rgba(255,255,255,0.92)",
      margin: { t: 70, r: 30, l: 60, b: 90 },
    };

    Plotly.react(eventTypeRef.current, plotData, layout, {
      displayModeBar: false,
      responsive: true,
    });
  };

  /**
   * Draws the annual attendance-by-venue chart.
   *
   * @returns {Promise<void>}
   */
  const venuePopularity = async (venueData) => {
    if (!venueData || !venueTypeRef.current) return;

    //converst the returned maps to arrays, then maps the keys and values of them to x and y. 
    const x = [...venueData.venues.keys()];
    const y = [...venueData.venues.values()].map(Number);

    const plotData = [{ x, y, type: "bar", marker: { color: chartBlue } }];

    const layout = {
      height: monthlyTicketRef.current.offsetWidth * 0.6,

      yaxis: { title: "Attendance", rangemode: "tozero", automargin: true },
      xaxis: { automargin: true, tickangle: -45 },
      plot_bgcolor: "rgba(255,255,255,0.92)",
      paper_bgcolor: "rgba(255,255,255,0.92)",
      margin: { t: 70, r: 30, l: 60, b: 90 },
    };

    Plotly.react(venueTypeRef.current, plotData, layout, {
      displayModeBar: false,
      responsive: true,
    });
  };

  return (
    <>
      {loading && (
        <div className="loading-state">⏳ Loading analytics...</div>
      )}
      {!loading && (
        <div className="analytics-overview-grid">
          <div className="analytics-overview-card">
            <h3>Monthly Ticket Sales</h3>
            <div ref={monthlyTicketRef}></div>
          </div>
          <div className="analytics-overview-card">
            <h3>Monthly Attendance</h3>
            <div ref={monthlyAttendanceRef}></div>
          </div>
          <div className="analytics-overview-card">
            <h3>Attendance by Event Type</h3>
            <div ref={eventTypeRef}></div>
          </div>
          <div className="analytics-overview-card">
            <h3>Attendance by Venue</h3>
            <div ref={venueTypeRef}></div>
          </div>
        </div>
      )}
    </>
  );
}

