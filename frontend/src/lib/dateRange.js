/**
 * Calendar-day helpers for filter date ranges.
 *
 * The date pickers hand back a Date at LOCAL midnight. `date.toISOString().split('T')[0]` converts that to UTC
 * first, which in any timezone ahead of UTC (IST is +05:30) turns "10 Sep" into "2026-09-09". These helpers keep
 * the day the person actually clicked, and the API contract is a plain YYYY-MM-DD string.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar day of a Date as 'YYYY-MM-DD' ('' for a missing / invalid date). */
export const toDateOnly = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** 'YYYY-MM-DD' -> Date at LOCAL midnight of that day (undefined when the string is not a real calendar date). */
export const fromDateOnly = (value) => {
    const m = DATE_ONLY.exec(String(value || '').trim());
    if (!m) return undefined;
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const date = new Date(y, mo - 1, d);
    // Rejects overflow such as 2026-02-31, which the Date constructor would silently roll into March.
    return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : undefined;
};

/** A date-picker `range` ({ from, to }) -> { start, end } day strings. */
export const rangeToDateStrings = (range) => ({
    start: toDateOnly(range && range.from),
    end: toDateOnly(range && range.to),
});

/**
 * Is an ISO timestamp inside [start, end] (inclusive whole days, UTC) — the same semantics the server uses for
 * `startDate` / `endDate`. A missing / unparsable timestamp is outside any bounded range.
 */
export const isWithinDays = (isoTimestamp, start, end) => {
    if (!start && !end) return true;
    const t = new Date(isoTimestamp);
    if (Number.isNaN(t.getTime())) return false;
    const day = t.toISOString().slice(0, 10);
    if (start && DATE_ONLY.test(start) && day < start) return false;
    if (end && DATE_ONLY.test(end) && day > end) return false;
    return true;
};
