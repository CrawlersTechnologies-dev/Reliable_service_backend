// Case ID format: RS-YYMMDD-NNNNN  (e.g. RS-261023-00001)
// The date is the day the case is created in India (IST); the number restarts at 00001 every day.
const IST = 'Asia/Kolkata';

/** "261023" for 23 Oct 2026 (IST). */
export function caseDay(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: IST, year: '2-digit', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(date))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}${parts.month}${parts.day}`;
}

export const caseCounterKey = (day) => `case-${day}`;
export const formatCaseNo = (day, seq) => `RS-${day}-${String(seq).padStart(5, '0')}`;
export const CASE_NO_RE = /^RS-\d{6}-\d{5}$/;
