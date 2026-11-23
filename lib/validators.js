import { toKopecks } from "./money";
import { enumerateDates } from "./vacation";

function integerValue(val) {
  if (typeof val !== "string" && typeof val !== "number") return null;
  if (typeof val === "string" && val.trim() === "") return null;
  const number = Number(val);
  return Number.isInteger(number) ? number : null;
}

export function validateMonth(val) {
  const month = integerValue(val);
  return month !== null && month >= 0 && month <= 11 ? month : null;
}

export function validateDay(val) {
  const day = integerValue(val);
  return day !== null && day >= 1 && day <= 31 ? day : null;
}

export function validateDayForMonth(year, month, val) {
  const day = validateDay(val);
  if (day === null || !Number.isInteger(year) || !Number.isInteger(month)) return null;
  return day <= new Date(year, month + 1, 0).getDate() ? day : null;
}

export function validateYear(val) {
  const year = integerValue(val);
  return year !== null && year >= 2020 && year <= 2100 ? year : null;
}

export function validateTimeBalance(val) {
  if (typeof val === "string" && val.trim() === "") return null;
  const hours = Number(val);
  return Number.isFinite(hours) && hours >= -8 && hours <= 24 ? hours : null;
}

export function validateActualHours(val) {
  if (typeof val === "string" && val.trim() === "") return null;
  const hours = Number(val);
  return Number.isFinite(hours) && hours >= 0 && hours <= 24 ? hours : null;
}

// Backward-compatible export name for callers that have not yet been renamed.
export const validateHours = validateTimeBalance;

// --- Vacation absence validation ---------------------------------------------
// The production calendar is only published for 2026, so a vacation outside it
// cannot be priced. Reject it instead of guessing a neighbouring year's holidays.

export const SUPPORTED_VACATION_YEARS = new Set([2026]);

function serialDate({ year, month, day }) {
  return Date.UTC(year, month, day) / 86_400_000;
}

export function validateVacationDate(value) {
  if (value === null || typeof value !== "object") return null;
  const { year, month, day } = value;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (!SUPPORTED_VACATION_YEARS.has(year)) return null;
  if (month < 0 || month > 11) return null;
  if (day < 1 || day > new Date(Date.UTC(year, month + 1, 0)).getUTCDate()) return null;
  return { year, month, day };
}

export function validateVacationRange(startValue, endValue) {
  const start = validateVacationDate(startValue);
  const end = validateVacationDate(endValue);
  if (start === null || end === null) return null;
  if (serialDate(start) > serialDate(end)) return null;
  return { start, end };
}

export function validateVacationNet(value) {
  const kopecks = toKopecks(value);
  return kopecks !== null && kopecks > 0 ? kopecks : null;
}

export function findOverlappingVacation(existing, candidate) {
  if (!Array.isArray(existing) || candidate === null || typeof candidate !== "object") return null;
  const candidateStart = serialDate(candidate.start);
  const candidateEnd = serialDate(candidate.end);
  for (const record of existing) {
    if (!record || !record.start || !record.end) continue;
    const start = serialDate(record.start);
    const end = serialDate(record.end);
    if (start <= candidateEnd && candidateStart <= end) return record;
  }
  return null;
}

// Explicit daily work records that fall inside a vacation are reported back to
// the caller as "mm-dd" keys so the UI can warn. They are never deleted here.
export function findWorkHourConflicts(range, workHours) {
  if (range === null || typeof range !== "object" || workHours === null || typeof workHours !== "object") return [];
  const conflicts = [];
  for (const { year, month, day } of enumerateDates(range.start, range.end)) {
    const key = `${month}-${day}`;
    if (!Object.hasOwn(workHours, key)) continue;
    const hours = Number(workHours[key]);
    if (Number.isFinite(hours) && hours !== 0 && year === 2026) conflicts.push(key);
  }
  return conflicts;
}
