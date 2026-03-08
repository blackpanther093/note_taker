import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { entriesAPI } from '../api/client';
import { ArrowLeft, ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, addMonths, subMonths } from 'date-fns';

export default function CalendarView() {
  const navigate = useNavigate();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [calendarData, setCalendarData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCalendar = async () => {
      setLoading(true);
      try {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth() + 1;
        const res = await entriesAPI.calendar(year, month);
        setCalendarData(res.data.calendar);
      } catch (err) {
        console.error('Failed to fetch calendar:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchCalendar();
  }, [currentMonth]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startPadding = getDay(monthStart); // 0=Sunday

  const entryDates = new Set(calendarData.map(d => d.date));
  const entryCountMap = {};
  calendarData.forEach(d => { entryCountMap[d.date] = d.count; });

  return (
    <div className="calendar-page">
      <header className="page-header">
        <button className="btn btn-icon" onClick={() => navigate('/')}>
          <ArrowLeft size={20} />
        </button>
        <h1>Calendar</h1>
      </header>

      <div className="calendar-nav">
        <button className="btn btn-icon" onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
          <ChevronLeft size={20} />
        </button>
        <h2>{format(currentMonth, 'MMMM yyyy')}</h2>
        <button className="btn btn-icon" onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
          <ChevronRight size={20} />
        </button>
      </div>

      {loading ? (
        <div className="loading-screen small">
          <div className="loading-spinner" />
        </div>
      ) : (
        <div className="calendar-grid">
          {/* Day headers */}
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="calendar-header-cell">{d}</div>
          ))}

          {/* Padding for start of month */}
          {Array.from({ length: startPadding }).map((_, i) => (
            <div key={`pad-${i}`} className="calendar-cell empty" />
          ))}

          {/* Days */}
          {days.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const hasEntry = entryDates.has(dateStr);
            const count = entryCountMap[dateStr] || 0;
            const isToday = format(new Date(), 'yyyy-MM-dd') === dateStr;

            return (
              <div
                key={dateStr}
                className={`calendar-cell ${hasEntry ? 'has-entry' : ''} ${isToday ? 'today' : ''}`}
                onClick={() => hasEntry && navigate(`/?date=${dateStr}`)}
              >
                <span className="day-number">{format(day, 'd')}</span>
                {hasEntry && (
                  <div className="entry-indicator">
                    <BookOpen size={12} />
                    {count > 1 && <span className="entry-count">{count}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
