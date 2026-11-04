import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react';
import { api } from '../lib/api';
import { todayISO } from './schedule';

const STORAGE_KEY = 'dk-booking';

const initialState = () => ({
  date: todayISO(),
  courtId: null,
  slot: null,
  details: { name: '', phone: '', email: '', notes: '' },
});

function reducer(state, action) {
  switch (action.type) {
    case 'date':
      return { ...state, date: action.value, slot: null };
    case 'court':
      return { ...state, courtId: action.value, slot: null };
    case 'slot':
      return { ...state, slot: action.value };
    case 'details':
      return { ...state, details: { ...state.details, ...action.value } };
    case 'reset':
      return initialState();
    default:
      return state;
  }
}

function load() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    if (saved && saved.date >= todayISO()) return { ...initialState(), ...saved };
  } catch {
    // Storage unavailable or corrupt — start fresh.
  }
  return initialState();
}

const BookingContext = createContext(null);

export function BookingProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore: persistence is a convenience only.
    }
  }, [state]);

  const value = useMemo(
    () => ({
      ...state,
      setDate: (value) => dispatch({ type: 'date', value }),
      setCourt: (value) => dispatch({ type: 'court', value }),
      setSlot: (value) => dispatch({ type: 'slot', value }),
      setDetails: (value) => dispatch({ type: 'details', value }),
      reset: () => dispatch({ type: 'reset' }),
    }),
    [state],
  );

  return <BookingContext.Provider value={value}>{children}</BookingContext.Provider>;
}

export function useBooking() {
  const ctx = useContext(BookingContext);
  if (!ctx) throw new Error('useBooking must be used inside <BookingProvider>');
  return ctx;
}

/** Live slots for one date. `reload` refetches after a slot turns out to be taken. */
export function useAvailability(date) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError('');
    api(`/availability?date=${date}`, { signal: controller.signal })
      .then(setData)
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
    return () => controller.abort();
  }, [date, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data: data?.date === date ? data : null, error, reload };
}
