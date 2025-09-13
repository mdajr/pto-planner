// Core pure logic extracted for testing

export const DEFAULT_CONFIG = {
  // Standard PTO
  standard: {
    monthlyRate: 13.34, // hours per month, deposited on the 1st
    cap: 160 // rollover and balance cap
  },
  // Flex PTO
  flex: {
    janMonthly: 10,      // Jan 1 grant
    otherMonthly: 8,     // Feb-Dec monthly accrual
    annualAccrualCap: 48, // total credited per year
    carryoverCap: 48,     // rollover cap at year-end
    balanceCap: 96        // hard balance maximum
  },
  workdayHours: 8
};

// --- Date helpers ---
export function toLocalMidnight(d) {
  const nd = new Date(d);
  nd.setHours(0, 0, 0, 0);
  return nd;
}

export function ymd(d) {
  const dt = toLocalMidnight(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const da = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

export function fromYMD(y, m, d) {
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function formatDate(date) {
  if (!(date instanceof Date) || isNaN(date)) return '';
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

// --- Holidays (US common set used in page) ---
export function getHolidaysForYear(year) {
  const holidays = new Map(); // key: ymd, val: name

  const setObservedIfWeekend = (date, name) => {
    const dt = toLocalMidnight(date);
    const day = dt.getDay();
    if (day === 6) dt.setDate(dt.getDate() + 2); // Saturday -> Monday
    else if (day === 0) dt.setDate(dt.getDate() + 1); // Sunday -> Monday
    holidays.set(ymd(dt), name);
  };

  const nthDow = (y, month, dayOfWeek, n, name) => {
    let count = 0;
    const date = new Date(y, month, 1);
    while (count < n) {
      if (date.getDay() === dayOfWeek) count++;
      if (count < n) date.setDate(date.getDate() + 1);
    }
    holidays.set(ymd(date), name);
  };

  const lastDow = (y, month, dayOfWeek, name) => {
    const date = new Date(y, month + 1, 0);
    while (date.getDay() !== dayOfWeek) date.setDate(date.getDate() - 1);
    holidays.set(ymd(date), name);
  };

  setObservedIfWeekend(new Date(year, 0, 1), "New Year's Day");
  nthDow(year, 0, 1, 3, 'MLK Day'); // 3rd Monday in Jan
  lastDow(year, 4, 1, 'Memorial Day'); // last Monday in May
  setObservedIfWeekend(new Date(year, 6, 4), 'Independence Day');
  nthDow(year, 8, 1, 1, 'Labor Day'); // 1st Monday in Sept
  nthDow(year, 10, 4, 4, 'Thanksgiving'); // 4th Thursday in Nov
  setObservedIfWeekend(new Date(year, 11, 25), 'Christmas Day');

  return holidays; // Map<ymd, name>
}

function getHolidaysForRange(start, end) {
  const years = new Set([start.getFullYear(), end.getFullYear()]);
  const holidays = new Map();
  for (const y of years) {
    for (const [k, v] of getHolidaysForYear(y)) holidays.set(k, v);
  }
  return holidays;
}

export function countWorkdaysAndHolidays(start, end, holidayNamesByYmd) {
  const s = toLocalMidnight(start);
  const e = toLocalMidnight(end);
  let workdays = 0;
  let weekendDays = 0;
  const holidaysFound = [];

  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) {
      weekendDays++;
      continue;
    }
    const key = ymd(d);
    if (holidayNamesByYmd.has(key)) {
      holidaysFound.push(holidayNamesByYmd.get(key));
    } else {
      workdays++;
    }
  }
  return { workdays, weekendDays, holidaysFound };
}

export function suggestPtoHours(start, end, config = DEFAULT_CONFIG) {
  const holidays = getHolidaysForRange(start, end);
  const { workdays, weekendDays, holidaysFound } = countWorkdaysAndHolidays(start, end, holidays);
  const hours = workdays * config.workdayHours;
  return { hours, workdays, weekendDays, holidaysFound };
}

export function getInitialFlexAccruedThisYear(today, config = DEFAULT_CONFIG) {
  const date = toLocalMidnight(today);
  let accrued = 0;
  for (let month = 0; month <= date.getMonth(); month++) {
    if (month < date.getMonth() || (month === date.getMonth() && date.getDate() >= 1)) {
      const amount = month === 0 ? config.flex.janMonthly : config.flex.otherMonthly;
      const remaining = config.flex.annualAccrualCap - accrued;
      if (remaining <= 0) break;
      accrued += Math.min(amount, remaining);
    }
  }
  return accrued;
}

export function generateAccrualEvents(baseDate, yearsAhead = 2, config = DEFAULT_CONFIG) {
  const today = toLocalMidnight(baseDate);
  const endDate = new Date(today.getFullYear() + yearsAhead, 11, 31);
  const events = [];
  let current = new Date(today.getFullYear(), today.getMonth(), 1);
  if (today.getDate() > 1) current.setMonth(current.getMonth() + 1);

  while (current <= endDate) {
    const standardAmount = config.standard.monthlyRate;
    const flexAmount = current.getMonth() === 0 ? config.flex.janMonthly : config.flex.otherMonthly;
    events.push({
      date: new Date(current),
      type: 'accrual',
      standardAmount,
      flexAmount
    });
    current.setMonth(current.getMonth() + 1);
  }

  return events;
}

// --- Accrual and rollover simulation with caps ---
export function applyEventsWithCaps(initialStandard, initialFlex, events, startDate, config = DEFAULT_CONFIG) {
  let standard = initialStandard;
  let flex = initialFlex;
  let flexAccruedThisYear = getInitialFlexAccruedThisYear(startDate, config);
  let lastYear = startDate.getFullYear();

  for (const event of events.sort((a, b) => a.date - b.date)) {
    if (event.date.getFullYear() > lastYear) {
      // Year-end rollover
      standard = Math.min(standard, config.standard.cap);
      flex = Math.min(flex, config.flex.carryoverCap);
      flexAccruedThisYear = 0;
      lastYear = event.date.getFullYear();
    }

    if (event.type === 'accrual') {
      // Standard accrual and cap
      standard += event.standardAmount ?? config.standard.monthlyRate;
      if (standard > config.standard.cap) standard = config.standard.cap;

      // Flex accrual, respect annual credited cap and balance cap
      const room = Math.max(0, config.flex.annualAccrualCap - flexAccruedThisYear);
      const requested = event.flexAmount ?? (event.date.getMonth() === 0 ? config.flex.janMonthly : config.flex.otherMonthly);
      const actual = Math.min(room, requested);
      if (actual > 0) {
        flex += actual;
        flexAccruedThisYear += actual;
      }
      if (flex > config.flex.balanceCap) flex = config.flex.balanceCap;
    } else if (event.type === 'vacation') {
      standard -= event.standardHours || 0;
      flex -= event.flexHours || 0;
    }
  }

  return { standard, flex };
}

// Expand a vacation into per-workday deduction events (skipping weekends/holidays),
// distributing the requested hours across days up to workdayHours per day, favoring Standard then Flex.
export function expandVacationDays(vacation, config = DEFAULT_CONFIG) {
  const start = toLocalMidnight(vacation.startDate);
  const end = toLocalMidnight(vacation.endDate || vacation.startDate);
  const holidays = getHolidaysForRange(start, end);

  // Collect workday dates
  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // weekend
    const key = ymd(d);
    if (holidays.has(key)) continue; // holiday
    days.push(new Date(d));
  }

  let remStd = Number(vacation.standardHours) || 0;
  let remFlex = Number(vacation.flexHours) || 0;
  const perDay = [];

  for (const d of days) {
    let remainingTarget = Math.min(config.workdayHours, remStd + remFlex);
    if (remainingTarget <= 0) break;
    const stdUse = Math.min(remStd, remainingTarget);
    remStd -= stdUse;
    remainingTarget -= stdUse;
    const flexUse = Math.min(remFlex, remainingTarget);
    remFlex -= flexUse;
    perDay.push({ date: d, type: 'vacation-day', parentId: vacation.id, standardHours: stdUse, flexHours: flexUse });
  }

  return perDay;
}

// Generate a timeline ledger: accruals, year-end rollover entries, and aggregated vacation entries for display.
export function generateTimelineLedger(today, initialStandard, initialFlex, vacations, yearsAhead = 2, config = DEFAULT_CONFIG) {
  const t0 = toLocalMidnight(today);
  const accruals = generateAccrualEvents(t0, yearsAhead, config);

  // Expand vacations into daily deduction events, but also keep aggregated display items
  const vacationDailyEvents = [];
  const vacationDisplay = [];
  for (const v of vacations) {
    const perDays = expandVacationDays(v, config);
    vacationDailyEvents.push(...perDays);
    const first = toLocalMidnight(v.startDate);
    vacationDisplay.push({
      type: 'vacation',
      id: v.id,
      date: first,
      startDate: toLocalMidnight(v.startDate),
      endDate: toLocalMidnight(v.endDate || v.startDate),
      name: v.name || '',
      standardHours: Number(v.standardHours) || 0,
      flexHours: Number(v.flexHours) || 0,
      description: 'Vacation'
    });
  }

  // Processing order: yearEnd (synthetic), accruals, vacation-day; all after initial
  const allProcessEvents = [...accruals, ...vacationDailyEvents].sort((a, b) => (a.date - b.date) || (a.type === 'accrual' ? -1 : 1));

  let standard = Number(initialStandard) || 0;
  let flex = Number(initialFlex) || 0;
  let flexAccruedThisYear = getInitialFlexAccruedThisYear(t0, config);
  let lastYear = t0.getFullYear();

  const events = [{
    type: 'initial',
    date: t0,
    description: 'Current Balance',
    standardChange: 0,
    flexChange: 0,
    runningStandard: standard,
    runningFlex: flex
  }];

  // Track shortages per vacation parent
  const shortageByVacationId = new Set();

  let pendingYearEnd = null;
  for (const ev of allProcessEvents) {
    if (ev.date.getFullYear() > lastYear) {
      // Compute year-end rollover, but attach info to Jan 1 event instead of separate entry
      const beforeStd = standard; const beforeFlex = flex;
      standard = Math.min(standard, config.standard.cap);
      flex = Math.min(flex, config.flex.carryoverCap);
      const lostStd = beforeStd - standard;
      const lostFlex = beforeFlex - flex;
      pendingYearEnd = {
        fromYear: lastYear,
        toYear: ev.date.getFullYear(),
        lostStandard: lostStd,
        lostFlex: lostFlex
      };
      flexAccruedThisYear = 0;
      lastYear = ev.date.getFullYear();
    }

    if (ev.type === 'accrual') {
      const stdBefore = standard;
      standard += ev.standardAmount ?? config.standard.monthlyRate;
      if (standard > config.standard.cap) standard = config.standard.cap;
      const stdDelta = standard - stdBefore;

      const flexBefore = flex;
      const room = Math.max(0, config.flex.annualAccrualCap - flexAccruedThisYear);
      const requested = ev.flexAmount ?? (ev.date.getMonth() === 0 ? config.flex.janMonthly : config.flex.otherMonthly);
      const actual = Math.min(room, requested);
      if (actual > 0) {
        flex += actual;
        flexAccruedThisYear += actual;
      }
      if (flex > config.flex.balanceCap) flex = config.flex.balanceCap;
      const flexDelta = flex - flexBefore;

      const entry = {
        type: 'accrual',
        date: ev.date,
        description: 'Monthly Accrual',
        standardChange: stdDelta,
        flexChange: flexDelta,
        runningStandard: standard,
        runningFlex: flex
      };
      // Attach year-end info to Jan 1 accrual entry only
      if (pendingYearEnd && ev.date.getMonth() === 0 && ev.date.getDate() === 1) {
        entry.yearEndInfo = pendingYearEnd;
        pendingYearEnd = null;
      }
      events.push(entry);
    } else if (ev.type === 'vacation-day') {
      standard -= ev.standardHours || 0;
      flex -= ev.flexHours || 0;
      if (standard < 0 || flex < 0) shortageByVacationId.add(ev.parentId);
      events.push({
        type: 'vacation-day',
        parentId: ev.parentId,
        date: ev.date,
        description: 'Vacation Day',
        standardChange: -(ev.standardHours || 0),
        flexChange: -(ev.flexHours || 0),
        runningStandard: standard,
        runningFlex: flex
      });
    }
  }

  // Fold vacation-day events into single aggregated display entries per vacation
  const displayEvents = [];
  const groupedByVacation = new Map();
  for (const e of events) {
    if (e.type === 'vacation-day') {
      if (!groupedByVacation.has(e.parentId)) groupedByVacation.set(e.parentId, []);
      groupedByVacation.get(e.parentId).push(e);
    } else {
      displayEvents.push(e);
    }
  }
  for (const v of vacationDisplay) {
    const group = groupedByVacation.get(v.id) || [];
    let stdDelta = 0, flexDelta = 0;
    let lastBalanceStd = null, lastBalanceFlex = null;
    for (const day of group) {
      stdDelta += day.standardChange;
      flexDelta += day.flexChange;
      lastBalanceStd = day.runningStandard;
      lastBalanceFlex = day.runningFlex;
    }
    // Insert aggregated entry at the correct date position
    displayEvents.push({
      type: 'vacation',
      id: v.id,
      date: v.date,
      startDate: v.startDate,
      endDate: v.endDate,
      name: v.name || '',
      description: v.description,
      standardChange: stdDelta, // negative
      flexChange: flexDelta,    // negative
      runningStandard: lastBalanceStd,
      runningFlex: lastBalanceFlex,
      causesShortage: shortageByVacationId.has(v.id)
    });
  }

  // Sort final display events by date, and within same date order: initial, yearEnd, accrual, vacation
  const rank = { initial: 0, accrual: 2, 'vacation': 3 };
  displayEvents.sort((a, b) => (a.date - b.date) || ((rank[a.type] ?? 99) - (rank[b.type] ?? 99)));

  const hasAnyShortage = displayEvents.some(e => e.type === 'vacation' && e.causesShortage);

  return { events: displayEvents, hasAnyShortage };
}

// --- Import/Export helpers using YMD dates to avoid timezone drift ---
export function serializeDateYMD(d) {
  return ymd(d);
}

export function parseYMD(s) {
  const [y, m, d] = s.split('-').map(Number);
  return fromYMD(y, m, d);
}

export function exportState(now, currentStandard, currentFlex, vacations) {
  const exportDate = serializeDateYMD(now);
  return {
    exportDate,
    currentStandardPto: currentStandard,
    currentFlexPto: currentFlex,
    vacations: vacations.map(v => ({
      ...v,
      startDate: serializeDateYMD(v.startDate),
      endDate: serializeDateYMD(v.endDate)
    }))
  };
}

export function importAndRecalc(data, today, config = DEFAULT_CONFIG) {
  const exportDate = parseYMD(data.exportDate);
  const t = toLocalMidnight(today);
  let currentStandard = Number(data.currentStandardPto) || 0;
  let currentFlex = Number(data.currentFlexPto) || 0;

  const importedVacations = (data.vacations || []).map(v => ({
    ...v,
    startDate: parseYMD(v.startDate),
    endDate: parseYMD(v.endDate)
  }));

  const events = [];
  // Determine first accrual to process: next month from export month, or skip month if exported on the 1st (pre-accrual assumption)
  let accrualDate = new Date(exportDate.getFullYear(), exportDate.getMonth(), 1);
  if (exportDate.getDate() >= 1) {
    accrualDate.setMonth(accrualDate.getMonth() + 1);
  }
  while (accrualDate < t) {
    const standardAmount = config.standard.monthlyRate;
    const flexAmount = accrualDate.getMonth() === 0 ? config.flex.janMonthly : config.flex.otherMonthly;
    events.push({ date: new Date(accrualDate), type: 'accrual', standardAmount, flexAmount });
    accrualDate.setMonth(accrualDate.getMonth() + 1);
  }
  // Past vacations between exportDate (inclusive) and today (exclusive)
  importedVacations.forEach(v => {
    if (v.startDate >= exportDate && v.startDate < t) {
      events.push({ date: v.startDate, type: 'vacation', standardHours: v.standardHours, flexHours: v.flexHours });
    }
  });

  const { standard, flex } = applyEventsWithCaps(currentStandard, currentFlex, events, exportDate, config);
  const futureVacations = importedVacations.filter(v => v.startDate >= t);

  return { currentStandard: standard, currentFlex: flex, futureVacations };
}
