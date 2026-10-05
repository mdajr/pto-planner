// Core pure logic extracted for testing

export const DEFAULT_CONFIG = {
  standard: {
    firstYearRate: 6.67,
    years1to5Rate: 10,
    years6plusRate: 13.34,
    firstYearBiweeklyRate: 3.08,
    years1to5BiweeklyRate: 4.62,
    years6plusBiweeklyRate: 6.16,
    cap: 160
  },
  flex: {
    janMonthly: 10,
    otherMonthly: 8,
    biweeklyRate: 3.7,
    annualAccrualCap: 48,
    carryoverCap: 48,
    balanceCap: 96
  },
  workdayHours: 8,
  payPeriod: 'monthly' // 'monthly' | 'biweekly'
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

// Format decimal hours as "X hrs Y mins"
export function formatHoursMinutes(decimalHours) {
  const negative = decimalHours < 0;
  const totalMins = Math.round(Math.abs(decimalHours) * 60);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${negative ? '-' : ''}${hrs} hrs ${mins} mins`;
}

export function decimalToHrsMins(decimalHours) {
  const negative = decimalHours < 0;
  const totalMins = Math.round(Math.abs(decimalHours) * 60);
  return {
    hrs: negative ? -Math.floor(totalMins / 60) : Math.floor(totalMins / 60),
    mins: totalMins % 60
  };
}

export function hrsMinsToDecimal(hrs, mins) {
  return (Number(hrs) || 0) + (Number(mins) || 0) / 60;
}

// --- Holidays (US common set) ---
export function getHolidaysForYear(year) {
  const holidays = new Map();

  const setObservedIfWeekend = (date, name) => {
    const dt = toLocalMidnight(date);
    const day = dt.getDay();
    if (day === 6) dt.setDate(dt.getDate() + 2);
    else if (day === 0) dt.setDate(dt.getDate() + 1);
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
  nthDow(year, 0, 1, 3, 'MLK Day');
  lastDow(year, 4, 1, 'Memorial Day');
  setObservedIfWeekend(new Date(year, 6, 4), 'Independence Day');
  nthDow(year, 8, 1, 1, 'Labor Day');
  nthDow(year, 10, 4, 4, 'Thanksgiving');
  setObservedIfWeekend(new Date(year, 11, 25), 'Christmas Day');

  return holidays;
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
    if (dow === 0 || dow === 6) { weekendDays++; continue; }
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

// Returns all biweekly paydays on or after startDate up to endDate, anchored to lastPaycheckDate
function getBiweeklyPaydays(lastPaycheckDate, startDate, endDate) {
  const ref = toLocalMidnight(lastPaycheckDate);
  const start = toLocalMidnight(startDate);
  const end = toLocalMidnight(endDate);

  const diffDays = Math.round((start.getTime() - ref.getTime()) / 86400000);
  let periods = Math.floor(diffDays / 14);
  let current = new Date(ref);
  current.setDate(current.getDate() + periods * 14);
  while (current < start) current.setDate(current.getDate() + 14);

  const paydays = [];
  while (current <= end) {
    paydays.push(new Date(current));
    current.setDate(current.getDate() + 14);
  }
  return paydays;
}

// How much flex was credited this year before asOfDate (biweekly mode)
export function getInitialFlexAccruedThisYearBiweekly(asOfDate, config, lastPaycheckDate) {
  const date = toLocalMidnight(asOfDate);
  const jan1 = new Date(date.getFullYear(), 0, 1);
  let accrued = 0;

  if (jan1 <= date) {
    accrued = Math.min(config.flex.janMonthly, config.flex.annualAccrualCap);
  }

  if (lastPaycheckDate) {
    const paydays = getBiweeklyPaydays(lastPaycheckDate, jan1, date);
    for (const pd of paydays) {
      if (pd <= jan1) continue;
      if (pd >= date) break;
      const room = config.flex.annualAccrualCap - accrued;
      if (room <= 0) break;
      accrued += Math.min(config.flex.biweeklyRate, room);
    }
  }

  return Math.min(accrued, config.flex.annualAccrualCap);
}

export function completedYearsOfService(hireDate, onDate) {
  if (!hireDate || !(hireDate instanceof Date) || isNaN(hireDate)) return 0;
  const h = toLocalMidnight(hireDate);
  const d = toLocalMidnight(onDate);
  let years = d.getFullYear() - h.getFullYear();
  const anniv = new Date(d.getFullYear(), h.getMonth(), h.getDate());
  if (d < anniv) years -= 1;
  return Math.max(0, years);
}

export function standardMonthlyRateForDate(hireDate, accrualDate, config = DEFAULT_CONFIG) {
  if (!hireDate) return config.standard.years6plusRate;
  const years = completedYearsOfService(hireDate, accrualDate);
  if (years < 1) return config.standard.firstYearRate;
  if (years < 6) return config.standard.years1to5Rate;
  return config.standard.years6plusRate;
}

export function standardBiweeklyRateForDate(hireDate, accrualDate, config = DEFAULT_CONFIG) {
  if (!hireDate) return config.standard.years6plusBiweeklyRate;
  const years = completedYearsOfService(hireDate, accrualDate);
  if (years < 1) return config.standard.firstYearBiweeklyRate;
  if (years < 6) return config.standard.years1to5BiweeklyRate;
  return config.standard.years6plusBiweeklyRate;
}

export function generateAccrualEvents(baseDate, yearsAhead = 2, config = DEFAULT_CONFIG, hireDate = null, lastPaycheckDate = null) {
  const today = toLocalMidnight(baseDate);
  const endDate = new Date(today.getFullYear() + yearsAhead, 11, 31);

  if (config.payPeriod === 'biweekly') {
    return _generateBiweeklyAccrualEvents(today, endDate, config, hireDate, lastPaycheckDate);
  }
  return _generateMonthlyAccrualEvents(today, endDate, config, hireDate);
}

function _generateMonthlyAccrualEvents(today, endDate, config, hireDate) {
  const events = [];
  let current = new Date(today.getFullYear(), today.getMonth(), 1);
  if (today.getDate() > 1) current.setMonth(current.getMonth() + 1);

  while (current <= endDate) {
    const standardAmount = standardMonthlyRateForDate(hireDate, current, config);
    const flexAmount = current.getMonth() === 0 ? config.flex.janMonthly : config.flex.otherMonthly;
    events.push({ date: new Date(current), type: 'accrual', standardAmount, flexAmount });
    current.setMonth(current.getMonth() + 1);
  }
  return events;
}

function _generateBiweeklyAccrualEvents(today, endDate, config, hireDate, lastPaycheckDate) {
  const events = [];

  // Jan 1 grant for each future year in range
  for (let y = today.getFullYear(); y <= endDate.getFullYear(); y++) {
    const jan1 = new Date(y, 0, 1);
    if (jan1 > today) {
      events.push({ date: jan1, type: 'accrual', standardAmount: 0, flexAmount: config.flex.janMonthly });
    }
  }

  if (lastPaycheckDate) {
    const paydays = getBiweeklyPaydays(lastPaycheckDate, today, endDate);
    for (const pd of paydays) {
      if (pd <= today) continue;
      const standardAmount = standardBiweeklyRateForDate(hireDate, pd, config);
      events.push({ date: new Date(pd), type: 'accrual', standardAmount, flexAmount: config.flex.biweeklyRate });
    }
  }

  return events.sort((a, b) => a.date - b.date);
}

// --- Accrual and rollover simulation with caps ---
// initialFlexAccruedThisYear: optional override; if null, computed from startDate
export function applyEventsWithCaps(initialStandard, initialFlex, events, startDate, config = DEFAULT_CONFIG, initialFlexAccruedThisYear = null) {
  let standard = initialStandard;
  let flex = initialFlex;
  let flexAccruedThisYear = initialFlexAccruedThisYear !== null
    ? initialFlexAccruedThisYear
    : getInitialFlexAccruedThisYear(startDate, config);
  let lastYear = startDate.getFullYear();

  for (const event of events.sort((a, b) => a.date - b.date)) {
    if (event.date.getFullYear() > lastYear) {
      standard = Math.min(standard, config.standard.cap);
      flex = Math.min(flex, config.flex.carryoverCap);
      flexAccruedThisYear = 0;
      lastYear = event.date.getFullYear();
    }

    if (event.type === 'accrual') {
      standard += event.standardAmount ?? config.standard.years6plusRate;
      if (standard > config.standard.cap) standard = config.standard.cap;

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

export function expandVacationDays(vacation, config = DEFAULT_CONFIG) {
  const start = toLocalMidnight(vacation.startDate);
  const end = toLocalMidnight(vacation.endDate || vacation.startDate);
  const holidays = getHolidaysForRange(start, end);

  const days = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const key = ymd(d);
    if (holidays.has(key)) continue;
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

export function generateTimelineLedger(today, initialStandard, initialFlex, vacations, yearsAhead = 2, config = DEFAULT_CONFIG, hireDate = null, lastPaycheckDate = null) {
  const t0 = toLocalMidnight(today);
  const accruals = generateAccrualEvents(t0, yearsAhead, config, hireDate, lastPaycheckDate);

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

  const allProcessEvents = [...accruals, ...vacationDailyEvents].sort((a, b) => (a.date - b.date) || (a.type === 'accrual' ? -1 : 1));

  let standard = Number(initialStandard) || 0;
  let flex = Number(initialFlex) || 0;

  let flexAccruedThisYear;
  if (config.payPeriod === 'biweekly' && lastPaycheckDate) {
    flexAccruedThisYear = getInitialFlexAccruedThisYearBiweekly(t0, config, lastPaycheckDate);
  } else {
    flexAccruedThisYear = getInitialFlexAccruedThisYear(t0, config);
  }
  let lastYear = t0.getFullYear();

  const accrualLabel = config.payPeriod === 'biweekly' ? 'Biweekly Accrual' : 'Monthly Accrual';

  const events = [{
    type: 'initial',
    date: t0,
    description: 'Current Balance',
    standardChange: 0,
    flexChange: 0,
    runningStandard: standard,
    runningFlex: flex
  }];

  const shortageByVacationId = new Set();
  let pendingYearEnd = null;

  for (const ev of allProcessEvents) {
    if (ev.date.getFullYear() > lastYear) {
      const beforeStd = standard; const beforeFlex = flex;
      standard = Math.min(standard, config.standard.cap);
      flex = Math.min(flex, config.flex.carryoverCap);
      pendingYearEnd = {
        fromYear: lastYear,
        toYear: ev.date.getFullYear(),
        lostStandard: beforeStd - standard,
        lostFlex: beforeFlex - flex
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
        description: accrualLabel,
        standardChange: stdDelta,
        flexChange: flexDelta,
        runningStandard: standard,
        runningFlex: flex
      };
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
    displayEvents.push({
      type: 'vacation',
      id: v.id,
      date: v.date,
      startDate: v.startDate,
      endDate: v.endDate,
      name: v.name || '',
      description: v.description,
      standardChange: stdDelta,
      flexChange: flexDelta,
      runningStandard: lastBalanceStd,
      runningFlex: lastBalanceFlex,
      causesShortage: shortageByVacationId.has(v.id)
    });
  }

  const rank = { initial: 0, accrual: 2, vacation: 3 };
  displayEvents.sort((a, b) => (a.date - b.date) || ((rank[a.type] ?? 99) - (rank[b.type] ?? 99)));

  const hasAnyShortage = displayEvents.some(e => e.type === 'vacation' && e.causesShortage);
  const available = computeAvailableToSpend(events);
  return { events: displayEvents, hasAnyShortage, available };
}

// How much combined (standard + flex) PTO can still be spent without any future
// point in the timeline going negative: the lowest combined balance after today.
// This can exceed today's balance, since it counts upcoming accruals.
export function computeAvailableToSpend(ledgerEvents) {
  const initial = ledgerEvents.find(e => e.type === 'initial');
  const currentTotal = initial ? initial.runningStandard + initial.runningFlex : 0;
  const future = ledgerEvents.filter(e => e.type !== 'initial');
  const points = future.length ? future : (initial ? [initial] : []);

  let lowest = null;
  for (const e of points) {
    const total = e.runningStandard + e.runningFlex;
    if (lowest === null || total < lowest.total - 1e-9) lowest = { total, date: e.date };
  }
  const hours = lowest ? Math.max(0, lowest.total) : 0;
  const exceedsCurrent = hours > currentTotal + 1e-9;

  // Spending X on date d lowers every balance from d onward, so it's safe once
  // the balance as of d reaches X (later points are all >= X by definition).
  let availableFromDate = null;
  if (exceedsCurrent) {
    const firstEnough = points.find(e => e.runningStandard + e.runningFlex >= hours - 1e-9);
    availableFromDate = firstEnough ? firstEnough.date : null;
  }

  return {
    hours,
    lowPointDate: lowest ? lowest.date : null,
    currentTotal,
    exceedsCurrent,
    availableFromDate
  };
}

// --- Import/Export helpers ---
export function serializeDateYMD(d) {
  return ymd(d);
}

export function parseYMD(s) {
  const [y, m, d] = s.split('-').map(Number);
  return fromYMD(y, m, d);
}

export function exportState(now, currentStandard, currentFlex, vacations, hireDate = null, payPeriod = 'monthly', lastPaycheckDate = null) {
  return {
    exportDate: serializeDateYMD(now),
    currentStandardPto: currentStandard,
    currentFlexPto: currentFlex,
    hireDate: hireDate ? serializeDateYMD(hireDate) : null,
    payPeriod,
    lastPaycheckDate: lastPaycheckDate ? serializeDateYMD(lastPaycheckDate) : null,
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
  const hireDate = data.hireDate ? parseYMD(data.hireDate) : null;
  const payPeriod = data.payPeriod || 'monthly';
  const lastPaycheckDate = data.lastPaycheckDate ? parseYMD(data.lastPaycheckDate) : null;
  const mergedConfig = { ...config, payPeriod };

  const importedVacations = (data.vacations || []).map(v => ({
    ...v,
    startDate: parseYMD(v.startDate),
    endDate: parseYMD(v.endDate)
  }));

  const events = [];

  if (payPeriod === 'biweekly' && lastPaycheckDate) {
    // Jan 1 grants for years that crossed since export
    for (let y = exportDate.getFullYear(); y <= t.getFullYear(); y++) {
      const jan1 = new Date(y, 0, 1);
      if (jan1 > exportDate && jan1 < t) {
        events.push({ date: jan1, type: 'accrual', standardAmount: 0, flexAmount: config.flex.janMonthly });
      }
    }
    // Biweekly paydays strictly between exportDate and today
    const paydays = getBiweeklyPaydays(lastPaycheckDate, exportDate, t);
    for (const pd of paydays) {
      if (pd <= exportDate || pd >= t) continue;
      events.push({
        date: pd,
        type: 'accrual',
        standardAmount: standardBiweeklyRateForDate(hireDate, pd, mergedConfig),
        flexAmount: config.flex.biweeklyRate
      });
    }
  } else {
    let accrualDate = new Date(exportDate.getFullYear(), exportDate.getMonth(), 1);
    if (exportDate.getDate() >= 1) accrualDate.setMonth(accrualDate.getMonth() + 1);
    while (accrualDate < t) {
      const standardAmount = standardMonthlyRateForDate(hireDate, accrualDate, config);
      const flexAmount = accrualDate.getMonth() === 0 ? config.flex.janMonthly : config.flex.otherMonthly;
      events.push({ date: new Date(accrualDate), type: 'accrual', standardAmount, flexAmount });
      accrualDate.setMonth(accrualDate.getMonth() + 1);
    }
  }

  // Past vacations: start on or after exportDate and before today
  importedVacations.forEach(v => {
    if (v.startDate >= exportDate && v.startDate < t) {
      events.push({ date: v.startDate, type: 'vacation', standardHours: v.standardHours, flexHours: v.flexHours });
    }
  });

  const flexAccruedAtExport = (payPeriod === 'biweekly' && lastPaycheckDate)
    ? getInitialFlexAccruedThisYearBiweekly(exportDate, mergedConfig, lastPaycheckDate)
    : getInitialFlexAccruedThisYear(exportDate, config);

  const { standard, flex } = applyEventsWithCaps(currentStandard, currentFlex, events, exportDate, mergedConfig, flexAccruedAtExport);
  const futureVacations = importedVacations.filter(v => v.startDate >= t);

  return { currentStandard: standard, currentFlex: flex, futureVacations, payPeriod, lastPaycheckDate };
}
