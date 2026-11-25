/*
 * Calendar: acompañamiento interactivo para DatePicker y DateRangePicker
 * (inspirado en https://easyui.site/components/date-picker).
 *
 * Trabaja con fechas civiles locales sin desplazamientos de zona horaria,
 * soporta modos single y range, cambio rápido de mes/año y navegación por teclado.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

const MONTH_SHORT_FALLBACK = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function createCivilDate(year, monthIndex, day) {
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, monthIndex, day);
  return date;
}

export function startOfDay(date) {
  if (!date) return null;
  return createCivilDate(date.getFullYear(), date.getMonth(), date.getDate());
}

export function isSameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function dayKey(date) {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function isBeforeDay(a, b) {
  return dayKey(a) < dayKey(b);
}

function isAfterDay(a, b) {
  return dayKey(a) > dayKey(b);
}

function addDays(date, amount) {
  return createCivilDate(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function addMonths(year, month, delta) {
  const total = year * 12 + month + delta;
  const clamped = Math.max(12, Math.min(9999 * 12 + 11, total));
  return { year: Math.floor(clamped / 12), month: clamped % 12 };
}

function getMonthGrid(year, month, weekStartsOn) {
  const first = createCivilDate(year, month, 1);
  const offset = (first.getDay() - weekStartsOn + 7) % 7;
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const day = createCivilDate(year, month, 1 - offset + i);
    cells.push({
      date: day,
      outside: day.getMonth() !== month || day.getFullYear() !== year,
    });
  }
  return cells;
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ChevronDownSmallIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function Calendar({
  mode = 'single',
  value,
  onChange,
  locale = 'es-UY',
  weekStartsOn = 1,
  minDate,
  maxDate,
  today: todayProp,
  clearable = false,
  onClear,
}) {
  const today = useMemo(() => startOfDay(todayProp ?? new Date()), [todayProp]);
  const anchorDate = mode === 'range' ? (value?.from ?? value?.to ?? today) : (value ?? today);

  const [view, setView] = useState('days'); // 'days' | 'months' | 'years'
  const [cursor, setCursor] = useState(() => ({
    year: anchorDate.getFullYear(),
    month: anchorDate.getMonth(),
  }));
  const [slide, setSlide] = useState(null); // null | 'next' | 'prev'
  const [slideKey, setSlideKey] = useState(0);
  const [hovered, setHovered] = useState(null);
  const [focusedDate, setFocusedDate] = useState(() => startOfDay(anchorDate));
  const gridRef = useRef(null);
  const keyboardFocusRef = useRef(false);

  const min = useMemo(() => startOfDay(minDate), [minDate]);
  const max = useMemo(() => startOfDay(maxDate), [maxDate]);

  const weekdays = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
    // 2024-01-07 fue domingo (day = 0).
    return Array.from({ length: 7 }, (_, i) => {
      const sample = createCivilDate(2024, 0, 7 + ((weekStartsOn + i) % 7));
      return formatter.format(sample).replace(/\.$/, '').slice(0, 2);
    });
  }, [locale, weekStartsOn]);

  const monthNames = useMemo(() => {
    try {
      const formatter = new Intl.DateTimeFormat(locale, { month: 'short' });
      return Array.from({ length: 12 }, (_, m) => formatter.format(createCivilDate(2024, m, 1)).replace(/\.$/, ''));
    } catch {
      return MONTH_SHORT_FALLBACK;
    }
  }, [locale]);

  const headingLabel = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
    return formatter.format(createCivilDate(cursor.year, cursor.month, 1));
  }, [cursor.month, cursor.year, locale]);

  const cells = useMemo(() => getMonthGrid(cursor.year, cursor.month, weekStartsOn), [cursor.year, cursor.month, weekStartsOn]);

  const isDisabled = (date) => {
    if (date.getFullYear() < 1 || date.getFullYear() > 9999) return true;
    if (min && isBeforeDay(date, min)) return true;
    if (max && isAfterDay(date, max)) return true;
    return false;
  };

  useEffect(() => {
    if (!keyboardFocusRef.current || view !== 'days') return;
    keyboardFocusRef.current = false;
    const key = String(dayKey(focusedDate));
    const target = gridRef.current?.querySelector(`button[data-day-key="${key}"]`);
    target?.focus();
  }, [focusedDate, view]);

  const stepMonth = (delta) => {
    setSlide(delta > 0 ? 'next' : 'prev');
    setSlideKey((k) => k + 1);
    setCursor((prev) => addMonths(prev.year, prev.month, delta));
  };

  const selectDate = (date) => {
    if (isDisabled(date)) return;
    const clean = startOfDay(date);
    if (mode === 'range') {
      const from = value?.from ? startOfDay(value.from) : null;
      const to = value?.to ? startOfDay(value.to) : null;
      if (!from || (from && to)) {
        onChange?.({ from: clean, to: null });
      } else if (isBeforeDay(clean, from)) {
        onChange?.({ from: clean, to: from });
      } else {
        onChange?.({ from, to: clean });
      }
    } else {
      onChange?.(clean);
    }
  };

  const handleDayKeyDown = (event, date) => {
    let next = null;
    if (event.key === 'ArrowLeft') next = addDays(date, -1);
    else if (event.key === 'ArrowRight') next = addDays(date, 1);
    else if (event.key === 'ArrowUp') next = addDays(date, -7);
    else if (event.key === 'ArrowDown') next = addDays(date, 7);
    else if (event.key === 'PageUp') {
      const shifted = addMonths(date.getFullYear(), date.getMonth(), -1);
      const lastDay = createCivilDate(shifted.year, shifted.month + 1, 0).getDate();
      next = createCivilDate(shifted.year, shifted.month, Math.min(date.getDate(), lastDay));
    } else if (event.key === 'PageDown') {
      const shifted = addMonths(date.getFullYear(), date.getMonth(), 1);
      const lastDay = createCivilDate(shifted.year, shifted.month + 1, 0).getDate();
      next = createCivilDate(shifted.year, shifted.month, Math.min(date.getDate(), lastDay));
    } else if (event.key === 'Home') {
      const offset = (date.getDay() - weekStartsOn + 7) % 7;
      next = addDays(date, -offset);
    } else if (event.key === 'End') {
      const offset = (date.getDay() - weekStartsOn + 7) % 7;
      next = addDays(date, 6 - offset);
    }
    if (!next) return;
    event.preventDefault();
    if (next.getFullYear() < 1 || next.getFullYear() > 9999) return;
    if (next.getFullYear() !== cursor.year || next.getMonth() !== cursor.month) {
      setSlide(isAfterDay(next, date) ? 'next' : 'prev');
      setSlideKey((k) => k + 1);
      setCursor({ year: next.getFullYear(), month: next.getMonth() });
    }
    keyboardFocusRef.current = true;
    setFocusedDate(next);
  };

  const decadeStart = Math.max(1, Math.floor(cursor.year / 12) * 12);
  const years = Array.from({ length: 12 }, (_, i) => decadeStart + i).filter((y) => y >= 1 && y <= 9999);

  const rangeFrom = mode === 'range' ? startOfDay(value?.from) : null;
  const rangeTo = mode === 'range' ? startOfDay(value?.to) : null;
  const previewEnd = mode === 'range' && rangeFrom && !rangeTo ? hovered : rangeTo;
  const [spanStart, spanEnd] = rangeFrom && previewEnd
    ? (isBeforeDay(previewEnd, rangeFrom) ? [previewEnd, rangeFrom] : [rangeFrom, previewEnd])
    : [rangeFrom, rangeTo];

  const hasValue = mode === 'range' ? Boolean(value?.from || value?.to) : Boolean(value);

  return (
    <div className="calendar">
      {view === 'days' && (
        <>
          <div className="calendar__header">
            <button
              type="button"
              className="calendar__nav"
              aria-label="Mes anterior"
              disabled={cursor.year <= 1 && cursor.month <= 0}
              onClick={() => stepMonth(-1)}
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              className="calendar__heading-btn"
              aria-label={`Cambiar mes o año (${headingLabel})`}
              onClick={() => setView('months')}
            >
              <span>{headingLabel}</span>
              <ChevronDownSmallIcon />
            </button>
            <button
              type="button"
              className="calendar__nav"
              aria-label="Mes siguiente"
              disabled={cursor.year >= 9999 && cursor.month >= 11}
              onClick={() => stepMonth(1)}
            >
              <ChevronRightIcon />
            </button>
          </div>

          <div className="calendar__weekdays" aria-hidden="true">
            {weekdays.map((day) => (
              <span key={day} className="calendar__weekday">{day}</span>
            ))}
          </div>

          <div
            key={slideKey}
            ref={gridRef}
            role="grid"
            aria-label={headingLabel}
            data-slide={slide ?? undefined}
            className="calendar__days"
          >
            {cells.map(({ date, outside }) => {
              const disabled = isDisabled(date);
              const isToday = isSameDay(date, today);
              const selectedSingle = mode === 'single' && isSameDay(date, value);
              const isStart = mode === 'range' && isSameDay(date, spanStart);
              const isEnd = mode === 'range' && isSameDay(date, spanEnd);
              const selected = selectedSingle || isStart || isEnd;
              const inRange = mode === 'range' && spanStart && spanEnd && isAfterDay(date, spanStart) && isBeforeDay(date, spanEnd);
              const singlePointRange = isStart && isEnd;
              const isTabStop = isSameDay(date, focusedDate) || (!cells.some((c) => isSameDay(c.date, focusedDate)) && !outside && date.getDate() === 1);

              const cellClass = [
                'calendar__cell',
                inRange && 'calendar__cell--in-range',
                isStart && spanEnd && !singlePointRange && 'calendar__cell--range-start',
                isEnd && spanStart && !singlePointRange && 'calendar__cell--range-end',
                singlePointRange && 'calendar__cell--range-single',
              ].filter(Boolean).join(' ');

              const btnClass = [
                'calendar__day',
                outside && 'calendar__day--outside',
                isToday && 'calendar__day--today',
                selected && 'calendar__day--selected',
                disabled && 'calendar__day--disabled',
              ].filter(Boolean).join(' ');

              const iso = `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
              const fullLabel = new Intl.DateTimeFormat(locale, { dateStyle: 'full' }).format(date);

              return (
                <div key={iso} className={cellClass}>
                  <button
                    type="button"
                    tabIndex={isTabStop ? 0 : -1}
                    disabled={disabled}
                    aria-label={fullLabel}
                    aria-pressed={selected}
                    data-day-key={dayKey(date)}
                    data-iso={iso}
                    className={btnClass}
                    onMouseEnter={() => { if (mode === 'range' && rangeFrom && !rangeTo) setHovered(date); }}
                    onClick={() => selectDate(date)}
                    onKeyDown={(event) => handleDayKeyDown(event, date)}
                  >
                    {date.getDate()}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {view === 'months' && (
        <>
          <div className="calendar__header">
            <button
              type="button"
              className="calendar__nav"
              aria-label="Año anterior"
              disabled={cursor.year <= 1}
              onClick={() => setCursor((prev) => ({ ...prev, year: Math.max(1, prev.year - 1) }))}
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              className="calendar__heading-btn"
              aria-label={`Elegir año (${cursor.year})`}
              onClick={() => setView('years')}
            >
              <span>{cursor.year}</span>
              <ChevronDownSmallIcon />
            </button>
            <button
              type="button"
              className="calendar__nav"
              aria-label="Año siguiente"
              disabled={cursor.year >= 9999}
              onClick={() => setCursor((prev) => ({ ...prev, year: Math.min(9999, prev.year + 1) }))}
            >
              <ChevronRightIcon />
            </button>
          </div>
          <div className="calendar__grid-12">
            {monthNames.map((label, monthIndex) => {
              const isSelected = value && mode === 'single' && value.getFullYear() === cursor.year && value.getMonth() === monthIndex;
              const isCurrent = today.getFullYear() === cursor.year && today.getMonth() === monthIndex;
              return (
                <button
                  key={label}
                  type="button"
                  className={[
                    'calendar__pill-option',
                    isSelected && 'calendar__pill-option--selected',
                    isCurrent && 'calendar__pill-option--current',
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    setSlide(null);
                    setCursor((prev) => ({ ...prev, month: monthIndex }));
                    setFocusedDate(createCivilDate(cursor.year, monthIndex, 1));
                    setView('days');
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {view === 'years' && (
        <>
          <div className="calendar__header">
            <button
              type="button"
              className="calendar__nav"
              aria-label="Años anteriores"
              disabled={decadeStart <= 1}
              onClick={() => setCursor((prev) => ({ ...prev, year: Math.max(1, prev.year - 12) }))}
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              className="calendar__heading-btn"
              onClick={() => setView('months')}
            >
              <span>{years[0]} – {years[years.length - 1]}</span>
            </button>
            <button
              type="button"
              className="calendar__nav"
              aria-label="Años siguientes"
              disabled={decadeStart + 12 > 9999}
              onClick={() => setCursor((prev) => ({ ...prev, year: Math.min(9999, prev.year + 12) }))}
            >
              <ChevronRightIcon />
            </button>
          </div>
          <div className="calendar__grid-12">
            {years.map((year) => {
              const isSelected = value && mode === 'single' && value.getFullYear() === year;
              const isCurrent = today.getFullYear() === year;
              return (
                <button
                  key={year}
                  type="button"
                  className={[
                    'calendar__pill-option',
                    isSelected && 'calendar__pill-option--selected',
                    isCurrent && 'calendar__pill-option--current',
                  ].filter(Boolean).join(' ')}
                  onClick={() => {
                    setCursor((prev) => ({ ...prev, year }));
                    setView('months');
                  }}
                >
                  {year}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="calendar__footer">
        <button
          type="button"
          className="calendar__footer-btn"
          disabled={isDisabled(today)}
          onClick={() => {
            setSlide(null);
            setCursor({ year: today.getFullYear(), month: today.getMonth() });
            setFocusedDate(today);
            setView('days');
            if (mode === 'single') selectDate(today);
          }}
        >
          Hoy
        </button>
        {clearable && hasValue && (
          <button
            type="button"
            className="calendar__footer-btn calendar__footer-btn--clear"
            onClick={() => {
              onClear?.();
            }}
          >
            Limpiar
          </button>
        )}
      </div>
    </div>
  );
}
