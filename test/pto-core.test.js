import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  formatDate,
  getHolidaysForYear,
  countWorkdaysAndHolidays,
  suggestPtoHours,
  getInitialFlexAccruedThisYear,
  generateAccrualEvents,
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
  assert.ok(Math.abs(first.standardAmount - 13.34) < 1e-2);
  const second = events[1];
  assert.equal(second.date.getMonth(), 10); // November
  assert.ok(Math.abs(second.standardAmount - 13.34) < 1e-2);
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
  assert.ok(Math.abs(currentStandard - 130.68) < 1e-2);

  // Flex: annual credited cap is reached by mid-June per baseline; no further accrual posts.
  assert.equal(currentFlex, 20);

  // Future vacation remains (start 2026-06-20 is before today 2026-08-02, so it should have been applied if between export and today).
  // Our export future (relative to export) but past relative to today; it should have been processed, so future list should be empty.
  assert.equal(futureVacations.length, 0);
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
