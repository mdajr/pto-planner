import test from 'node:test';
import assert from 'node:assert/strict';

function closeTo(actual, expected, eps = 1e-2) {
  assert.ok(Math.abs(actual - expected) < eps, `Expected ${actual} ≈ ${expected} (±${eps})`);
}
import {
  DEFAULT_CONFIG,
  formatDate,
  formatHoursMinutes,
  decimalToHrsMins,
  hrsMinsToDecimal,
  getHolidaysForYear,
  countWorkdaysAndHolidays,
  suggestPtoHours,
  getInitialFlexAccruedThisYear,
  getInitialFlexAccruedThisYearBiweekly,
  generateAccrualEvents,
  standardBiweeklyRateForDate,
  applyEventsWithCaps,
  expandVacationDays,
  generateTimelineLedger,
  exportState,
  importAndRecalc,
  fromYMD
} from '../src/pto-core.js';

test('formatDate formats valid dates as M/D/YYYY', () => {
  const d = new Date(2023, 10, 5); // Nov 5, 2023
  assert.equal(formatDate(d), '11/5/2023');
});

test('formatDate returns empty string for invalid dates', () => {
  assert.equal(formatDate(new Date('invalid')), '');
});

test('getHolidaysForYear includes observed holidays for 2023 (US set used)', () => {
  const h = getHolidaysForYear(2023);
  assert.equal(h.has('2023-01-02'), true); // New Year observed
  assert.equal(h.has('2023-01-16'), true); // MLK
  assert.equal(h.has('2023-05-29'), true); // Memorial Day
  assert.equal(h.has('2023-07-04'), true); // Independence Day
  assert.equal(h.has('2023-09-04'), true); // Labor Day
  assert.equal(h.has('2023-11-23'), true); // Thanksgiving
  assert.equal(h.has('2023-12-25'), true); // Christmas
});

test('counts workdays excluding weekends and holidays', () => {
  const start = fromYMD(2023, 11, 22); // Wed
  const end = fromYMD(2023, 11, 24);   // Fri (Thanksgiving 11/23)
  const h = new Map([...getHolidaysForYear(2023)]);
  const { workdays, weekendDays, holidaysFound } = countWorkdaysAndHolidays(start, end, h);
  assert.equal(weekendDays, 0);
  assert.equal(holidaysFound.length, 1);
  assert.equal(workdays, 2); // 22 and 24 are workdays
});

test('suggests 8 hours per workday by default', () => {
  const start = fromYMD(2023, 11, 22);
  const end = fromYMD(2023, 11, 24);
  const { hours, workdays } = suggestPtoHours(start, end, DEFAULT_CONFIG);
  assert.equal(workdays, 2);
  assert.equal(hours, 16);
});

test('caps credited flex to annual 48h', () => {
  const june = fromYMD(2023, 6, 15);
  const accrued = getInitialFlexAccruedThisYear(june, DEFAULT_CONFIG);
  assert.equal(accrued, 48); // Jan=10 + Feb-Jun=8*5 => 50 but cap 48
});

test('generates monthly accrual events on the 1st with constant 13.34 standard', () => {
  const base = fromYMD(2025, 9, 15); // Sept 15, 2025
  const events = generateAccrualEvents(base, 0, DEFAULT_CONFIG); // only remainder of year
  const first = events[0];
  assert.equal(first.date.getFullYear(), 2025);
  assert.equal(first.date.getMonth(), 9); // October
  assert.equal(first.date.getDate(), 1);
  closeTo(first.standardAmount, 13.34);
  const second = events[1];
  assert.equal(second.date.getMonth(), 10); // November
  closeTo(second.standardAmount, 13.34);
});

test('standard accrual caps at 160 balance', () => {
  const start = fromYMD(2026, 1, 1);
  const events = [
    { date: fromYMD(2026, 2, 1), type: 'accrual' },
    { date: fromYMD(2026, 3, 1), type: 'accrual' }
  ];
  const { standard } = applyEventsWithCaps(159, 0, events, start, DEFAULT_CONFIG);
  assert.equal(standard, 160);
});

test('flex annual credited accrual caps at 48 and balance caps at 96', () => {
  const start = fromYMD(2026, 1, 1);
  const evts = [];
  // Simulate accruals Feb to Dec (Jan grant occurs at Jan 1 if processing from prev year; here we just add months to exceed 48)
  for (let m = 2; m <= 12; m++) evts.push({ date: fromYMD(2026, m, 1), type: 'accrual' });
  const res = applyEventsWithCaps(0, 10, evts, start, DEFAULT_CONFIG);
  // Starting balance includes Jan grant (10), credited space remaining is 38, so final balance is 48
  assert.equal(res.flex, 48);
});

test('year-end rollover: standard->160, flex->48 carryover, then accrual continues', () => {
  const start = fromYMD(2026, 12, 15);
  const events = [
    { date: fromYMD(2027, 1, 1), type: 'accrual' },
    { date: fromYMD(2027, 2, 1), type: 'accrual' }
  ];
  const { standard, flex } = applyEventsWithCaps(200, 90, events, start, DEFAULT_CONFIG);
  // At year boundary, standard clamps to 160; flex clamps to 48 carryover, then Jan adds 10 (but annual cap resets)
  // After Jan accrual: flex 58 but balance cap 96 not hit; Feb adds 8 -> 66
  assert.equal(standard, 160); // accruals keep it at cap
  assert.equal(flex, 66);
});

test('import/export reconciliation applies accruals and vacations with caps and returns future vacations', () => {
  const now = fromYMD(2026, 6, 15); // export mid-year
  const exported = exportState(now, 120, 20, [
    { id: 1, startDate: fromYMD(2026, 6, 20), endDate: fromYMD(2026, 6, 24), standardHours: 16, flexHours: 0 }, // in future relative to export
    { id: 2, startDate: fromYMD(2026, 5, 10), endDate: fromYMD(2026, 5, 10), standardHours: 8, flexHours: 0 } // already happened
  ]);

  const today = fromYMD(2026, 8, 2); // later in the year
  const { currentStandard, currentFlex, futureVacations } = importAndRecalc(exported, today, DEFAULT_CONFIG);

  // From Jun 15 to Aug 2 -> accruals on Jul 1 and Aug 1, and the June 20 vacation applies.
  // Standard: 120 - 16 + 13.34 + 13.34 = 130.68
  closeTo(currentStandard, 130.68);

  // Flex: annual credited cap is reached by mid-June per baseline; no further accrual posts.
  assert.equal(currentFlex, 20);

  // Future vacation remains (start 2026-06-20 is before today 2026-08-02, so it should have been applied if between export and today).
  // Our export future (relative to export) but past relative to today; it should have been processed, so future list should be empty.
  assert.equal(futureVacations.length, 0);
});

test('import applies vacations since export and accruals since export', () => {
  // Export mid-March with 80h standard, 0 flex; vacation of 40h on Mar 20; import on Apr 2
  const exportDate = '2025-03-10';
  const data = {
    exportDate,
    currentStandardPto: 80,
    currentFlexPto: 0,
    vacations: [
      { id: 1, startDate: '2025-03-20', endDate: '2025-03-20', standardHours: 40, flexHours: 0 }
    ]
  };
  const today = fromYMD(2025, 4, 2); // Apr 2, 2025
  const { currentStandard, currentFlex, futureVacations } = importAndRecalc(data, today, DEFAULT_CONFIG);
  // Expect: 80 - 40 (vacation Mar 20) + 13.34 (accrual Apr 1) = 53.34
  closeTo(currentStandard, 53.34);
  // Flex accrues 8 on Apr 1
  assert.equal(currentFlex, 8);
  // No future vacations left (Mar 20 is in the past relative to today)
  assert.equal(futureVacations.length, 0);
});

test('import reconciliation respects tenure accrual rate (first year 6.67)', () => {
  // Export mid-March with 80h standard and a 40h vacation; import on Apr 2 with hire date in Feb (first-year rate)
  const data = {
    exportDate: '2025-03-10',
    currentStandardPto: 80,
    currentFlexPto: 0,
    hireDate: '2025-02-15', // < 1 year as of Apr 1, so 6.67 accrual
    vacations: [
      { id: 1, startDate: '2025-03-20', endDate: '2025-03-20', standardHours: 40, flexHours: 0 }
    ]
  };
  const today = fromYMD(2025, 4, 2); // Apr 2, 2025
  const { currentStandard, currentFlex, futureVacations } = importAndRecalc(data, today, DEFAULT_CONFIG);
  // Expect: 80 - 40 + 6.67 (first-year accrual on Apr 1) = 46.67
  closeTo(currentStandard, 46.67);
  assert.equal(currentFlex, 8);
  assert.equal(futureVacations.length, 0);
});

test('import reconciliation applies rate change when crossing tenure anniversary', () => {
  // Export: Mar 10, 2025; Today: May 20, 2025
  // Hire Date: Apr 15, 2024 -> Apr 1 accrual uses first-year 6.67; May 1 uses 10.00
  const data = {
    exportDate: '2025-03-10',
    currentStandardPto: 0,
    currentFlexPto: 0,
    hireDate: '2024-04-15',
    vacations: []
  };
  const today = fromYMD(2025, 5, 20);
  const { currentStandard, currentFlex } = importAndRecalc(data, today, DEFAULT_CONFIG);
  // Apr 1: 6.67, May 1: 10.00 -> total 16.67
  closeTo(currentStandard, (6.67 + 10));
  // Flex: Apr 1 8h + May 1 8h = 16
  assert.equal(currentFlex, 16);
});

test('expandVacationDays splits hours over workdays, skipping weekends/holidays', () => {
  const v = {
    id: 1,
    startDate: fromYMD(2023, 11, 22), // Wed
    endDate: fromYMD(2023, 11, 24),   // Fri (11/23 Thanksgiving)
    standardHours: 16,
    flexHours: 0
  };
  const perDays = expandVacationDays(v, DEFAULT_CONFIG);
  // Expect 2 workdays (22,24), 8h each standard
  assert.equal(perDays.length, 2);
  assert.equal(perDays[0].standardHours, 8);
  assert.equal(perDays[1].standardHours, 8);
  // Ensure no holiday/weekend included
  const dates = perDays.map(d => d.date.getDate());
  assert.deepEqual(dates.sort((a,b)=>a-b), [22,24]);
});

test('ledger attaches rollover info to Jan 1 accrual, no separate yearEnd event', () => {
  const today = fromYMD(2026, 12, 20);
  // Start above caps to force rollover losses
  const ledger = generateTimelineLedger(today, 200, 90, [], 1, DEFAULT_CONFIG);
  const jan1 = ledger.events.find(e => e.type === 'accrual' && e.date.getFullYear() === 2027 && e.date.getMonth() === 0 && e.date.getDate() === 1);
  assert.ok(jan1, 'Jan 1 accrual not found');
  assert.ok(jan1.yearEndInfo, 'Year-end info missing on Jan 1');
  assert.ok(jan1.yearEndInfo.lostStandard > 39.9 && jan1.yearEndInfo.lostStandard < 40.1);
  assert.ok(jan1.yearEndInfo.lostFlex > 41.9 && jan1.yearEndInfo.lostFlex < 42.1);
  // Ensure no standalone yearEnd type exists
  assert.equal(ledger.events.some(e => e.type === 'yearEnd'), false);
});

test('ledger aggregates vacation with name and flags shortage when any day dips negative', () => {
  const today = fromYMD(2025, 1, 15);
  const vacations = [{
    id: 42,
    startDate: fromYMD(2025, 2, 3), // Mon
    endDate: fromYMD(2025, 2, 5),   // Wed (3 workdays)
    standardHours: 40,              // deliberately exceed 3*8 to cause negative
    flexHours: 0,
    name: "Annie's Birthday Trip"
  }];
  const ledger = generateTimelineLedger(today, 0, 0, vacations, 0, DEFAULT_CONFIG);
  const vac = ledger.events.find(e => e.type === 'vacation' && e.id === 42);
  assert.ok(vac, 'Aggregated vacation not found');
  assert.equal(vac.name, "Annie's Birthday Trip");
  assert.equal(ledger.hasAnyShortage, true);
  assert.equal(vac.causesShortage, true);
});

test('on same day, accrual is ordered before vacation entry in ledger', () => {
  const today = fromYMD(2025, 3, 15);
  const start = fromYMD(2025, 4, 1); // First of month
  const vacations = [{ id: 7, startDate: start, endDate: start, standardHours: 8, flexHours: 0 }];
  const ledger = generateTimelineLedger(today, 0, 0, vacations, 0, DEFAULT_CONFIG);
  const sameDay = ledger.events.filter(e => e.date.getTime() === start.getTime());
  // Expect accrual (type accrual) before vacation
  const idxAccrual = sameDay.findIndex(e => e.type === 'accrual');
  const idxVacation = sameDay.findIndex(e => e.type === 'vacation');
  assert.ok(idxAccrual !== -1 && idxVacation !== -1);
  assert.ok(idxAccrual < idxVacation);
});

test('available to spend is the lowest combined future balance, low point dated', () => {
  const today = fromYMD(2025, 3, 15);
  const vacations = [{ id: 1, startDate: fromYMD(2025, 4, 7), endDate: fromYMD(2025, 4, 11), standardHours: 40, flexHours: 0 }];
  const ledger = generateTimelineLedger(today, 40, 0, vacations, 0, DEFAULT_CONFIG);
  // Apr 1: 40 + 13.34 std, +8 flex = 61.34; vacation week takes 40 -> 21.34 on Apr 11
  closeTo(ledger.available.hours, 21.34);
  assert.equal(ledger.available.lowPointDate.getTime(), fromYMD(2025, 4, 11).getTime());
  assert.equal(ledger.available.exceedsCurrent, false);
});

test('available to spend can exceed current balance via upcoming accruals', () => {
  const today = fromYMD(2025, 3, 15);
  const ledger = generateTimelineLedger(today, 20, 10, [], 0, DEFAULT_CONFIG);
  // Lowest future point is the Apr 1 accrual: 30 + 13.34 + 8
  closeTo(ledger.available.hours, 51.34);
  closeTo(ledger.available.currentTotal, 30);
  assert.equal(ledger.available.exceedsCurrent, true);
});

test('available to spend is zero when plans already cause a shortage', () => {
  const today = fromYMD(2025, 1, 15);
  const vacations = [{ id: 1, startDate: fromYMD(2025, 2, 3), endDate: fromYMD(2025, 2, 5), standardHours: 40, flexHours: 0 }];
  const ledger = generateTimelineLedger(today, 0, 0, vacations, 0, DEFAULT_CONFIG);
  assert.equal(ledger.available.hours, 0);
});

// --- New: formatHoursMinutes and hrsMins helpers ---

test('formatHoursMinutes converts whole hours', () => {
  assert.equal(formatHoursMinutes(8), '8 hrs 0 mins');
  assert.equal(formatHoursMinutes(0), '0 hrs 0 mins');
  assert.equal(formatHoursMinutes(160), '160 hrs 0 mins');
});

test('formatHoursMinutes converts decimal hours to hrs mins', () => {
  assert.equal(formatHoursMinutes(8.5), '8 hrs 30 mins');
  assert.equal(formatHoursMinutes(6.67), '6 hrs 40 mins');
  assert.equal(formatHoursMinutes(13.34), '13 hrs 20 mins');
});

test('formatHoursMinutes handles negative values', () => {
  assert.equal(formatHoursMinutes(-8), '-8 hrs 0 mins');
  assert.equal(formatHoursMinutes(-0.5), '-0 hrs 30 mins');
});

test('decimalToHrsMins round-trips with hrsMinsToDecimal', () => {
  const vals = [0, 8, 8.5, 13.34, 6.67, 40, 160];
  for (const v of vals) {
    const { hrs, mins } = decimalToHrsMins(v);
    closeTo(hrsMinsToDecimal(hrs, mins), v, 0.02);
  }
});

test('hrsMinsToDecimal converts correctly', () => {
  assert.equal(hrsMinsToDecimal(8, 0), 8);
  assert.equal(hrsMinsToDecimal(8, 30), 8.5);
  assert.equal(hrsMinsToDecimal(0, 0), 0);
  closeTo(hrsMinsToDecimal(6, 40), 6.667, 0.01);
});

// --- New: biweekly accrual rates ---

test('standardBiweeklyRateForDate returns correct rates by tenure', () => {
  const hire0yos = fromYMD(2025, 1, 1);
  const hire1yos = fromYMD(2024, 1, 1);
  const hire6yos = fromYMD(2019, 1, 1);
  const check = fromYMD(2025, 6, 1);
  closeTo(standardBiweeklyRateForDate(hire0yos, check, DEFAULT_CONFIG), 3.08);
  closeTo(standardBiweeklyRateForDate(hire1yos, check, DEFAULT_CONFIG), 4.62);
  closeTo(standardBiweeklyRateForDate(hire6yos, check, DEFAULT_CONFIG), 6.16);
});

test('biweekly accrual events are generated on Fridays every 14 days', () => {
  const base = fromYMD(2025, 5, 1); // May 1
  const lastPaycheck = fromYMD(2025, 4, 25); // Friday Apr 25
  const biweeklyConfig = { ...DEFAULT_CONFIG, payPeriod: 'biweekly' };
  const events = generateAccrualEvents(base, 0, biweeklyConfig, null, lastPaycheck);
  // Filter to non-Jan1 events (actual biweekly paydays)
  const paydays = events.filter(e => !(e.date.getMonth() === 0 && e.date.getDate() === 1));
  // First payday after May 1 from Apr 25 anchor is May 9
  assert.ok(paydays.length > 0);
  assert.equal(paydays[0].date.getDay(), 5); // Friday
  // Each subsequent payday is 14 days apart
  for (let i = 1; i < paydays.length; i++) {
    const diff = Math.round((paydays[i].date - paydays[i-1].date) / 86400000);
    assert.equal(diff, 14);
  }
});

test('biweekly accrual totals match annual amounts (6.16 × 26 ≈ 160)', () => {
  closeTo(6.16 * 26, 160, 1);
  closeTo(4.62 * 26, 120, 1);
  closeTo(3.08 * 26, 80, 1);
});

test('biweekly flex: Jan 1 events have grant of 10, balance capped at 96', () => {
  const base = fromYMD(2025, 1, 2); // Jan 2 (day after grant)
  const lastPaycheck = fromYMD(2025, 1, 10); // Jan 10 anchor
  const biweeklyConfig = { ...DEFAULT_CONFIG, payPeriod: 'biweekly' };
  const events = generateAccrualEvents(base, 1, biweeklyConfig, null, lastPaycheck);

  // Next year's Jan 1 grant event should exist
  const jan1Events = events.filter(e => e.date.getMonth() === 0 && e.date.getDate() === 1);
  assert.equal(jan1Events.length, 1);
  assert.equal(jan1Events[0].flexAmount, 10);

  // Apply events: start with 10 credited (Jan grant already applied for 2025)
  // Annual accrual cap (48) and balance cap (96) should both be respected
  const { flex } = applyEventsWithCaps(0, 0, events, base, biweeklyConfig, 10);
  assert.ok(flex <= 96, `Flex ${flex} should be ≤ balance cap 96`);

  // Simulate just one year to confirm annual accrual cap is 48
  const oneYearEvents = events.filter(e => e.date.getFullYear() === 2025);
  const { flex: flex1yr } = applyEventsWithCaps(0, 0, oneYearEvents, base, biweeklyConfig, 10);
  assert.ok(flex1yr <= 48, `Flex after 1 year ${flex1yr} should be ≤ annual accrual cap 48`);
});

test('getInitialFlexAccruedThisYearBiweekly counts Jan grant plus past paydays', () => {
  const lastPaycheck = fromYMD(2025, 1, 10); // Jan 10 anchor → paydays Jan 10, 24, Feb 7, ...
  const biweeklyConfig = { ...DEFAULT_CONFIG, payPeriod: 'biweekly' };

  // As of Jan 5: Jan 1 grant credited (10), no paydays yet (Jan 10 is after Jan 5)
  const jan5 = fromYMD(2025, 1, 5);
  closeTo(getInitialFlexAccruedThisYearBiweekly(jan5, biweeklyConfig, lastPaycheck), 10);

  // As of Jan 11: Jan 1 grant (10) + Jan 10 payday (3.7) = 13.7
  const jan11 = fromYMD(2025, 1, 11);
  closeTo(getInitialFlexAccruedThisYearBiweekly(jan11, biweeklyConfig, lastPaycheck), 13.7);
});

test('importAndRecalc handles biweekly pay period and updates balances correctly', () => {
  const lastPaycheck = fromYMD(2025, 4, 25); // Apr 25 (Friday)
  const exportDate = fromYMD(2025, 4, 26); // Apr 26
  const today = fromYMD(2025, 5, 10); // May 10 — after one payday (May 9)

  const data = {
    exportDate: '2025-04-26',
    currentStandardPto: 80,
    currentFlexPto: 20,
    payPeriod: 'biweekly',
    lastPaycheckDate: '2025-04-25',
    vacations: []
  };

  const { currentStandard, currentFlex } = importAndRecalc(data, today, DEFAULT_CONFIG);
  // One biweekly payday between Apr 26 and May 10: May 9 (6.16 for 6+ YOS default)
  closeTo(currentStandard, 80 + 6.16, 0.02);
  // Flex: at Apr 26, annual accrued would be 10 (Jan grant) + ~5 paydays (Jan10,24,Feb7,21,Mar7) × 3.7 ≈ 28.5
  // May 9 payday adds 3.7 → total accrued goes to ~32.2, flex += 3.7 = 23.7
  closeTo(currentFlex, 20 + 3.7, 0.02);
});

test('loadLocal-style persistence: importAndRecalc with same-day export returns unchanged balances', () => {
  const today = fromYMD(2025, 5, 19);
  const data = {
    exportDate: '2025-05-19',
    currentStandardPto: 45.5,
    currentFlexPto: 12.25,
    payPeriod: 'monthly',
    vacations: [
      { id: 1, startDate: '2025-06-02', endDate: '2025-06-06', standardHours: 40, flexHours: 0 }
    ]
  };
  const { currentStandard, currentFlex, futureVacations } = importAndRecalc(data, today, DEFAULT_CONFIG);
  // Same day export → no accruals applied, balance unchanged
  closeTo(currentStandard, 45.5);
  closeTo(currentFlex, 12.25);
  // Future vacation should still be present
  assert.equal(futureVacations.length, 1);
});

test('past vacations are removed and deducted on reload', () => {
  const exportDate = fromYMD(2025, 5, 1);
  const today = fromYMD(2025, 5, 19);
  const data = {
    exportDate: '2025-05-01',
    currentStandardPto: 40,
    currentFlexPto: 10,
    payPeriod: 'monthly',
    vacations: [
      { id: 1, startDate: '2025-05-10', endDate: '2025-05-10', standardHours: 8, flexHours: 0 }, // past
      { id: 2, startDate: '2025-06-15', endDate: '2025-06-15', standardHours: 8, flexHours: 0 }  // future
    ]
  };
  const { currentStandard, currentFlex, futureVacations } = importAndRecalc(data, today, DEFAULT_CONFIG);
  // May 10 vacation deducted: 40 - 8 = 32
  closeTo(currentStandard, 32);
  // Only future vacation remains
  assert.equal(futureVacations.length, 1);
  assert.equal(futureVacations[0].id, 2);
});
