"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { signOut } from "next-auth/react";
import Image from "next/image";
import { dayNorm, periodStats } from "../../lib/work-hours";
import { formatKopecks } from "../../lib/money";
import { computeMonthPay } from "../../lib/vacation-pay";
import VacationPanel, { sumVacationPayByHalf, vacationDaysOfMonth } from "./vacation-panel";
import "./dashboard.css";

const YEAR = 2026;
const ANNUAL_WORK_HOURS = 1972;

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_SHORT = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const HOLIDAYS = new Set([
  "0-1", "0-2", "0-3", "0-4", "0-5", "0-6", "0-7", "0-8", "0-9",
  "1-23", "2-8", "2-9", "4-1", "4-2", "4-3", "4-9", "4-10", "4-11",
  "5-12", "5-13", "5-14", "10-4", "11-31"
]);
const PRE_HOLIDAY = new Set(["3-30", "4-8", "5-11", "10-3"]);

const MONTHLY_DATA = [
  { work: 15, off: 16 }, { work: 19, off: 9 }, { work: 21, off: 10 }, { work: 22, off: 8 },
  { work: 19, off: 12 }, { work: 21, off: 9 }, { work: 23, off: 8 }, { work: 21, off: 10 },
  { work: 22, off: 8 }, { work: 22, off: 9 }, { work: 20, off: 10 }, { work: 22, off: 9 },
];

function daysInMonth(m) { return new Date(YEAR, m + 1, 0).getDate(); }
function firstDow(m) { const d = new Date(YEAR, m, 1).getDay(); return d === 0 ? 6 : d - 1; }
function dow(m, day) { const d = new Date(YEAR, m, day).getDay(); return d === 0 ? 6 : d - 1; }
function getDayType(month, day) {
  const key = `${month}-${day}`;
  if (HOLIDAYS.has(key)) return "holiday";
  if (PRE_HOLIDAY.has(key)) return "preholiday";
  const d = new Date(YEAR, month, day).getDay();
  if (d === 0 || d === 6) return "weekend";
  return "workday";
}
function isSaturday(m, d) { return new Date(YEAR, m, d).getDay() === 6; }
function countWorkDays(m, from, to) {
  let count = 0;
  for (let d = from; d <= to; d++) {
    const t = getDayType(m, d);
    if (t === "workday" || t === "preholiday") count++;
  }
  return count;
}
function sumOTHours(overtime, m, from, to) {
  let hours = 0;
  for (let d = from; d <= to; d++) hours += overtime[`${m}-${d}`] || 0;
  return hours;
}

// Scheduled norm hours of the vacation days of `days` in month `m`. `dayNorm` is
// the single source of truth for the norm, so a pre-holiday counts 7 and a
// public holiday or weekend counts 0.
function vacationNormHours(m, days) {
  let hours = 0;
  for (const day of days.keys()) hours += dayNorm(YEAR, m, day);
  return hours;
}

function vacationLabel(info) {
  return info?.label ? ` (${info.label})` : "";
}
function fmt(n) { return n === 0 ? "0" : n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }); }
function NoteIcon() { return <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.75h6l2 2v10.5H4zM10 1.75v2h2M6 7h4M6 9.5h4M6 12h2.5" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

async function api(url, method = "GET", body = null, signal = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  if (signal) opts.signal = signal;
  try {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    if (e.name === "AbortError") return "aborted";
    console.error("API error:", url, e);
    return null;
  }
}

export default function DashboardClient({ user }) {
  const [tab, setTab] = useState("calc");
  const [cm, setCm] = useState(new Date().getMonth());
  const [oklad, setOklad] = useState(135000);
  const [otRate, setOtRate] = useState(164);
  const [autoOtRate, setAutoOtRate] = useState(false);
  const [overtime, setOvertime] = useState({});
  const [editingDay, setEditingDay] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [editOperation, setEditOperation] = useState("add");
  const [loaded, setLoaded] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [noteSummaries, setNoteSummaries] = useState({});
  const [noteDialog, setNoteDialog] = useState(null);
  const [noteText, setNoteText] = useState("");
  const [noteAttachments, setNoteAttachments] = useState([]);
  const [noteError, setNoteError] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);

  const [absences, setAbsences] = useState({});
  const [vacations, setVacations] = useState([]);
  const [vacationWarning, setVacationWarning] = useState("");

  const [selMode, setSelMode] = useState(false);
  const [selectedDays, setSelectedDays] = useState(new Set());
  const [bulkVal, setBulkVal] = useState("");

  const longPressTimer = useRef(null);
  const touchMoved = useRef(false);
  const selModeTimer = useRef(null);
  const yearTableRef = useRef(null);
  const monthViewRef = useRef(null);
  const settingsSaveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    return () => {
      if (selModeTimer.current) clearTimeout(selModeTimer.current);
    };
  }, []);

  useEffect(() => {
    setSelMode(false);
    setSelectedDays(new Set());
    setEditingDay(null);
    setEditOperation("add");
    setVacationWarning("");
  }, [cm]);

  const exitSelMode = useCallback(() => {
    setSelMode(false);
    setSelectedDays(new Set());
    setBulkVal("");
  }, []);

  const enterSelMode = useCallback((day) => {
    setEditingDay(null);
    setSelMode(true);
    setSelectedDays(new Set([day]));
    setBulkVal("");
    if (navigator.vibrate) navigator.vibrate(40);
  }, []);

  const toggleDay = useCallback((day) => {
    setSelectedDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
        if (next.size === 0) {
          if (selModeTimer.current) clearTimeout(selModeTimer.current);
          selModeTimer.current = setTimeout(() => setSelMode(false), 50);
        }
      } else {
        next.add(day);
      }
      return next;
    });
  }, []);

  const refreshVacations = useCallback(async () => {
    const data = await api(`/api/vacations?year=${YEAR}`);
    if (data && !data.error) setVacations(Array.isArray(data.vacations) ? data.vacations : []);
  }, []);

  useEffect(() => {
    Promise.all([
      api("/api/settings"),
      api(`/api/work-hours?year=${YEAR}`),
      api(`/api/absences?year=${YEAR}`),
      api(`/api/day-notes?year=${YEAR}`),
      api(`/api/vacations?year=${YEAR}`),
    ]).then(([s, o, a, notes, v]) => {
      if (s && !s.error) {
        setOklad(s.oklad ?? 135000);
        setOtRate(s.ot_rate ?? 164);
        setAutoOtRate(Boolean(s.auto_ot_rate));
      }
      if (o && !o.error) setOvertime(o);
      if (a && !a.error) setAbsences(a);
      if (notes && !notes.error) setNoteSummaries(notes);
      if (v && !v.error) setVacations(Array.isArray(v.vacations) ? v.vacations : []);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  // day -> vacation info, per month of the supported year.
  const vacationsByMonth = useMemo(() => {
    const map = new Map();
    for (let m = 0; m < 12; m += 1) map.set(m, vacationDaysOfMonth(vacations, YEAR, m));
    return map;
  }, [vacations]);

  // Vacation money per month, split by half. `sumVacationPayByHalf` is the panel's
  // adapter over the vacation money model; the dashboard never re-derives it.
  const vacationMoney = useMemo(() => {
    const map = new Map();
    for (let m = 0; m < 12; m += 1) map.set(m, sumVacationPayByHalf({ year: YEAR, month: m, vacations }));
    return map;
  }, [vacations]);

  const vacationForDay = useCallback(
    (m, d) => vacationsByMonth.get(m)?.get(d) ?? null,
    [vacationsByMonth]
  );

  useEffect(() => {
    if (!loaded) return;
    const payload = { oklad, ot_rate: otRate, auto_ot_rate: autoOtRate };
    const t = setTimeout(() => {
      settingsSaveQueueRef.current = settingsSaveQueueRef.current.then(async () => {
        const result = await api("/api/settings", "POST", payload);
        if (result === null) {
          setSaveError(true);
          setTimeout(() => setSaveError(false), 4000);
        }
      });
    }, 800);
    return () => clearTimeout(t);
  }, [oklad, otRate, autoOtRate, loaded]);

  const effectiveOtRate = autoOtRate
    ? Math.round((oklad * 12 / ANNUAL_WORK_HOURS + Number.EPSILON) * 100) / 100
    : otRate;

  const saveOT = useCallback((m, d, hours) => {
    api("/api/work-hours", "POST", { year: YEAR, month: m, day: d, hours }).then((result) => {
      if (result === null) {
        setSaveError(true);
        setTimeout(() => setSaveError(false), 4000);
      }
    });
  }, []);

  const toggleAbsence = useCallback((m, d) => {
    const key = `${m}-${d}`;
    const isAbsent = absences[key];
    setAbsences((prev) => {
      const next = { ...prev };
      if (isAbsent) delete next[key]; else next[key] = true;
      return next;
    });
    if (isAbsent) {
      api(`/api/absences?year=${YEAR}&month=${m}&day=${d}`, "DELETE");
    } else {
      // Clear any overtime on this day first
      setOvertime((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        api("/api/overtime", "POST", { year: YEAR, month: m, day: d, hours: 0 });
        return next;
      });
      api("/api/absences", "POST", { year: YEAR, month: m, day: d });
    }
  }, [absences]);

  const setDayOT = useCallback((m, d, hours) => {
    // A vacation day is an absence, not worked time: writing hours over it would
    // pay the day twice (salary share is already deducted, vacation pay added).
    // The write is refused here and in the API; the reason is always announced.
    const vacation = vacationsByMonth.get(m)?.get(d) ?? null;
    if (vacation) {
      setVacationWarning(
        `День ${d} входит в отпуск${vacationLabel(vacation)}. Часы за этот день не сохранены — отпуск уже оплачен отпускными.`
      );
      return false;
    }
    setOvertime((prev) => ({ ...prev, [`${m}-${d}`]: hours }));
    saveOT(m, d, hours);
    return true;
  }, [saveOT, vacationsByMonth]);

  const applyBulk = useCallback((hours) => {
    if (selectedDays.size === 0) return;
    const blocked = [...selectedDays].filter((d) => vacationsByMonth.get(cm)?.has(d)).sort((a, b) => a - b);
    if (blocked.length > 0) {
      setVacationWarning(
        `Выбранные дни входят в отпуск: ${blocked.join(", ")}. Часы не сохранены — уберите эти дни из выделения.`
      );
      return;
    }
    const items = [...selectedDays].map((d) => ({ day: d, hours }));
    setOvertime((prev) => {
      const next = { ...prev };
      selectedDays.forEach((d) => {
        const key = `${cm}-${d}`;
        if (hours === 0) delete next[key]; else next[key] = hours;
      });
      return next;
    });
    api("/api/overtime", "POST", { bulk: true, year: YEAR, month: cm, items });
    exitSelMode();
  }, [selectedDays, cm, exitSelMode, vacationsByMonth]);

  const confirmBulk = useCallback(() => {
    const val = parseFloat(bulkVal) || 0;
    applyBulk(val);
  }, [bulkVal, applyBulk]);

  const clearMonth = useCallback(async (m) => {
    setOvertime((prev) => {
      const next = { ...prev };
      const total = daysInMonth(m);
      for (let d = 1; d <= total; d++) delete next[`${m}-${d}`];
      return next;
    });
    await api(`/api/overtime?year=${YEAR}&month=${m}`, "DELETE");
  }, []);

  const openNoteDialog = useCallback(async () => {
    if (!editingDay) return;
    const [month, day] = editingDay.split("-").map(Number);
    setNoteError("");
    setNoteBusy(true);
    const detail = await api(`/api/day-notes?year=${YEAR}&month=${month}&day=${day}`);
    setNoteText(typeof detail?.text === "string" ? detail.text : "");
    setNoteAttachments(Array.isArray(detail?.attachments) ? detail.attachments : []);
    setNoteDialog({ month, day });
    setNoteBusy(false);
  }, [editingDay]);

  const saveNote = useCallback(async () => {
    if (!noteDialog) return;
    setNoteBusy(true); setNoteError("");
    const result = await api("/api/day-notes", "POST", { year: YEAR, month: noteDialog.month, day: noteDialog.day, text: noteText });
    if (result?.ok) {
      const key = `${noteDialog.month}-${noteDialog.day}`;
      setNoteSummaries((prev) => ({ ...prev, [key]: { hasNote: Boolean(noteText.trim()) || noteAttachments.length > 0 } }));
      setNoteDialog(null);
    } else setNoteError("Не удалось сохранить заметку.");
    setNoteBusy(false);
  }, [noteDialog, noteText, noteAttachments.length]);

  const uploadNoteFile = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file || !noteDialog) return;
    setNoteBusy(true); setNoteError("");
    const form = new FormData();
    form.set("year", String(YEAR)); form.set("month", String(noteDialog.month)); form.set("day", String(noteDialog.day)); form.set("file", file);
    const response = await fetch("/api/day-notes/attachments", { method: "POST", body: form });
    const result = await response.json().catch(() => null);
    if (response.ok && result?.attachment) {
      setNoteAttachments((prev) => [...prev, result.attachment]);
      const key = `${noteDialog.month}-${noteDialog.day}`;
      setNoteSummaries((prev) => ({ ...prev, [key]: { hasNote: true } }));
    } else setNoteError(result?.error || "Не удалось прикрепить файл.");
    event.target.value = ""; setNoteBusy(false);
  }, [noteDialog]);

  const deleteNote = useCallback(async () => {
    if (!noteDialog) return;
    if (!window.confirm("Удалить заметку и все прикреплённые файлы? Восстановить их будет невозможно.")) return;
    setNoteBusy(true); setNoteError("");
    const result = await api(`/api/day-notes?year=${YEAR}&month=${noteDialog.month}&day=${noteDialog.day}`, "DELETE");
    if (result?.ok) {
      const key = `${noteDialog.month}-${noteDialog.day}`;
      setNoteSummaries((prev) => { const next = { ...prev }; delete next[key]; return next; });
      setNoteDialog(null);
    } else setNoteError("Не удалось удалить заметку.");
    setNoteBusy(false);
  }, [noteDialog]);

  const handleDayClick = useCallback((d) => {
    if (selMode) {
      toggleDay(d);
      return;
    }

    const key = `${cm}-${d}`;
    if (editingDay === key) { setEditingDay(null); return; }
    setEditingDay(key);
    setEditVal(Object.hasOwn(overtime, key) ? overtime[key].toString() : "");
  }, [cm, selMode, editingDay, overtime, toggleDay]);

  const confirmEdit = useCallback(() => {
    if (!editingDay) return;
    const [ms, ds] = editingDay.split("-").map(Number);
    const val = parseFloat(editVal);
    if (!Number.isFinite(val)) return;
    if (setDayOT(ms, ds, val) === false) return; // vacation day: warned, not written
    setEditingDay(null);
  }, [editingDay, editVal, setDayOT]);

  const startLongPress = useCallback((d) => {
    touchMoved.current = false;
    longPressTimer.current = setTimeout(() => {
      if (!touchMoved.current) enterSelMode(d);
    }, 400);
  }, [enterSelMode]);

  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const monthStats = useMemo(() => {
    return MONTHS.map((_, m) => {
      const workDays = MONTHLY_DATA[m].work;
      const hourlyRate = workDays > 0 ? oklad / (workDays * 8) : 0;
      const end = daysInMonth(m);
      const vacationDays = vacationsByMonth.get(m) ?? new Map();

      const calculated = computeMonthPay({
        salaryKopecks: Math.round(oklad * 100), overtimeRateKopecks: effectiveOtRate * 100,
        workHours: overtime, year: YEAR, month: m, vacations,
      });
      const periods = calculated.halves.map((half) => ({
        ...half.stats,
        deduction: half.deductionKopecks / 100,
        overtimePay: half.overtimePayKopecks / 100,
        vacationDeduction: half.vacationReductionKopecks / 100,
        vacationPayKopecks: half.vacationPayKopecks,
        baseKopecks: half.baseKopecks,
        totalKopecks: half.totalKopecks,
        workPayKopecks: half.workPayKopecks,
      }));
      const money = vacationMoney.get(m) ?? { count: 0 };
      const [firstHalf, secondHalf] = periods;
      const positiveHours = firstHalf.positiveHours + secondHalf.positiveHours;
      const underworkHours = firstHalf.underworkHours + secondHalf.underworkHours;
      const recordedDays = firstHalf.recordedDays + secondHalf.recordedDays;
      const coveredHours = firstHalf.coveredHours + secondHalf.coveredHours;
      const effectiveOT = firstHalf.payableOvertimeHours + secondHalf.payableOvertimeHours;
      const deduction = firstHalf.deduction + secondHalf.deduction;
      const vacationDeduction = firstHalf.vacationDeduction + secondHalf.vacationDeduction;
      const vacationHours = vacationNormHours(m, vacationDays);
      const adjustedOklad = calculated.workPayKopecks / 100;
      const otPay = calculated.overtimePayKopecks / 100;
      const vacationPayKopecks = calculated.vacationPayKopecks;
      const totalKopecks = calculated.totalKopecks;
      const total = totalKopecks / 100;
      // A vacation month shows work pay instead of the full salary: the salary
      // share of the scheduled vacation hours (and any absence) is already out.
      const hasVacation = vacationHours > 0;
      return {
        workDays, hourlyRate, periods, positiveHours, underworkHours, recordedDays, coveredHours,
        effectiveOT, deduction, vacationDeduction, vacationDeductionKopecks: Math.round(vacationDeduction * 100),
        vacationHours, vacationCount: money.count, vacationPayKopecks, vacationPaidKopecks: calculated.vacationPaidKopecks,
        vacationOutstandingKopecks: calculated.outstandingKopecks,
        hasVacation, adjustedOklad, adjustedOkladKopecks: calculated.workPayKopecks, otPay, oklad, total, totalKopecks,
      };
    });
  }, [overtime, absences, effectiveOtRate, oklad, vacationsByMonth, vacationMoney]);

  const yearTotals = useMemo(() => {
    let otH = 0, otP = 0, totalDeduction = 0, adjOklad = 0, vacDeduction = 0, vacPay = 0;
    monthStats.forEach((s) => {
      otH += s.effectiveOT; otP += s.otPay; totalDeduction += s.deduction;
      adjOklad += s.adjustedOklad; vacDeduction += s.vacationDeduction; vacPay += s.vacationPayKopecks / 100;
    });
    return {
      otHours: otH, otPay: otP, deduction: totalDeduction, vacationDeduction: vacDeduction,
      oklad: adjOklad, vacationPay: vacPay, total: adjOklad + otP + vacPay,
    };
  }, [monthStats]);

  const exportExcel = useCallback(async () => {
    const XLSX = await import("xlsx");
    const rows = monthStats.map((s, i) => ({
      "Месяц": MONTHS[i],
      "Раб. дней": s.workDays,
      "Пропуски (дн)": s.absenceHours / 8 || 0,
      "Недоработка (ч)": s.underworkHours || 0,
      "Оклад (₽)": s.oklad,
      "Вычет (₽)": s.deduction > 0 ? -Math.round(s.deduction) : 0,
      "Переработка (ч)": s.effectiveOT || 0,
      "Переработка (₽)": s.otPay || 0,
      "Итого (₽)": Math.round(s.total),
    }));
    rows.push({
      "Месяц": `${YEAR} год`,
      "Раб. дней": 247,
      "Пропуски (дн)": monthStats.reduce((a, s) => a + s.absenceHours / 8, 0),
      "Недоработка (ч)": monthStats.reduce((a, s) => a + s.underworkHours, 0),
      "Оклад (₽)": Math.round(yearTotals.oklad),
      "Вычет (₽)": yearTotals.deduction > 0 ? -Math.round(yearTotals.deduction) : 0,
      "Переработка (ч)": yearTotals.otHours || 0,
      "Переработка (₽)": yearTotals.otPay || 0,
      "Итого (₽)": Math.round(yearTotals.total),
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Календарь 2026");
    const data = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "Производственный_календарь_2026.xlsx";
    link.click();
    URL.revokeObjectURL(url);
  }, [monthStats, yearTotals]);

  const exportJpeg = useCallback(async () => {
    if (!yearTableRef.current) return;
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(yearTableRef.current, {
      backgroundColor: "#0d1117",
      scale: 2,
    });
    const link = document.createElement("a");
    link.download = "Производственный_календарь_2026.jpg";
    link.href = canvas.toDataURL("image/jpeg", 0.95);
    link.click();
  }, []);

  const exportMonthExcel = useCallback(async () => {
    const XLSX = await import("xlsx");
    const DAY_TYPE_LABEL = { workday: "Рабочий", weekend: "Выходной", holiday: "Праздник", preholiday: "Сокращённый" };
    const rows = [];
    for (let d = 1; d <= daysInMonth(cm); d++) {
      const type = getDayType(cm, d);
      const ot = overtime[`${cm}-${d}`] || 0;
      const absent = !!absences[`${cm}-${d}`];
      rows.push({
        "Дата": `${d < 10 ? "0" + d : d}.${cm + 1 < 10 ? "0" + (cm + 1) : cm + 1}.${YEAR}`,
        "День": WEEKDAYS[dow(cm, d)],
        "Тип дня": absent ? "Не работал" : DAY_TYPE_LABEL[type],
        "Переработка (ч)": absent ? "" : (ot || ""),
      });
    }
    const ms = monthStats[cm];
    rows.push({});
    rows.push({ "Дата": "Оклад (₽)", "День": ms.oklad });
    if (ms.absenceHours > 0) {
      rows.push({ "Дата": "Пропущено (дн)", "День": ms.absenceHours / 8 });
      rows.push({ "Дата": "Вычет (₽)", "День": -Math.round(ms.deduction) });
    }
    if (ms.underworkHours > 0) rows.push({ "Дата": "Недоработка (ч)", "День": ms.underworkHours });
    rows.push({ "Дата": "Переработка (ч)", "День": ms.effectiveOT });
    rows.push({ "Дата": "Переработка (₽)", "День": ms.otPay });
    rows.push({ "Дата": "Итого (₽)", "День": Math.round(ms.total) });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${MONTHS[cm]} ${YEAR}`);
    const data = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([data], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Календарь_${MONTHS[cm]}_${YEAR}.xlsx`;
    link.click();
    URL.revokeObjectURL(url);
  }, [cm, overtime, monthStats]);

  const exportMonthJpeg = useCallback(async () => {
    if (!monthViewRef.current) return;
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(monthViewRef.current, {
      backgroundColor: "#0d1117",
      scale: 2,
    });
    const link = document.createElement("a");
    link.download = `Календарь_${MONTHS[cm]}_${YEAR}.jpg`;
    link.href = canvas.toDataURL("image/jpeg", 0.95);
    link.click();
  }, [cm]);

  const cmStats = monthStats[cm];

  const payPeriods = useMemo(() => {
    const totalWork = cmStats.workDays;
    const end = daysInMonth(cm);
    const wd1 = countWorkDays(cm, 1, 15);
    const wd2 = countWorkDays(cm, 16, end);
    const [firstHalf, secondHalf] = cmStats.periods;
    const base1 = firstHalf.baseKopecks / 100;
    const base2 = secondHalf.baseKopecks / 100;
    // Halves are money to hand over for work done: the vacation part is shown
    // once in the month summary, never inside a half.
    const advance = (firstHalf.totalKopecks - firstHalf.vacationPayKopecks) / 100;
    const settlement = (secondHalf.totalKopecks - secondHalf.vacationPayKopecks) / 100;
    return { wd1, wd2, base1, base2, firstHalf, secondHalf, advance, settlement };
  }, [cm, oklad, cmStats]);

  const totalDays = daysInMonth(cm);
  const first = firstDow(cm);
  const calCells = [];
  for (let i = 0; i < first; i++) calCells.push(<td key={`e${i}`} className="dc-empty" />);

  for (let d = 1; d <= totalDays; d++) {
    const type = getDayType(cm, d);
    const key = `${cm}-${d}`;
    const isRecorded = Object.hasOwn(overtime, key);
    const actualHours = isRecorded ? overtime[key] : null;
    const delta = isRecorded ? actualHours - dayNorm(YEAR, cm, d) : 0;
    const isSel = selectedDays.has(d);
    const isEdit = editingDay === key;
    const isSat = isSaturday(cm, d);
    const vacInfo = vacationForDay(cm, d);
    let cls = "dc";
    if (type === "holiday") cls += " dc-hol";
    else if (type === "weekend") { cls += isSat ? " dc-sat" : " dc-sun"; }
    else if (type === "preholiday") cls += " dc-pre";
    else cls += " dc-wd";
    if (isRecorded && delta > 0) cls += " dc-ot";
    else if (isRecorded && delta < 0) cls += " dc-under";
    if (isEdit) cls += " dc-edit";
    if (isSel) cls += " dc-sel";
    const today = new Date();
    if (today.getFullYear() === YEAR && today.getMonth() === cm && today.getDate() === d) cls += " dc-today";

    calCells.push(
      <td
        key={d}
        className={cls}
        onClick={() => handleDayClick(d)}
        onMouseDown={() => !selMode && startLongPress(d)}
        onMouseUp={cancelLongPress}
        onMouseLeave={cancelLongPress}
        onTouchStart={() => { touchMoved.current = false; if (!selMode) startLongPress(d); }}
        onTouchMove={() => { touchMoved.current = true; cancelLongPress(); }}
        onTouchEnd={cancelLongPress}
        onContextMenu={(e) => { e.preventDefault(); if (!selMode) enterSelMode(d); }}
      >
        {selMode && (
          <div className={`dc-check ${isSel ? "dc-check-on" : ""}`}>
            {isSel ? "✓" : ""}
          </div>
        )}
        <div className="dc-num">{d}</div>
        {isRecorded && !isSel && <div className="dc-hours">{actualHours}ч</div>}
        {isRecorded && delta > 0 && !isSel && <div className="dc-badge">+{delta}ч</div>}
        {isRecorded && delta < 0 && !isSel && <div className="dc-under-badge">−{Math.abs(delta)}ч</div>}
        {noteSummaries[key]?.hasNote && !isSel && <div className="dc-note" title="Есть заметка"><NoteIcon /></div>}
        {vacInfo && <div className="dc-vac" title={`Отпуск${vacationLabel(vacInfo)}`}><span className="dc-vac-mark">О</span></div>}
        {type === "preholiday" && <div className="dc-star">*</div>}
      </td>
    );
  }

  const calRows = [];
  for (let i = 0; i < calCells.length; i += 7) calRows.push(<tr key={i}>{calCells.slice(i, i + 7)}</tr>);

  let editInfo = null;
  if (editingDay) {
    const [em, ed] = editingDay.split("-").map(Number);
    const eType = getDayType(em, ed);
    editInfo = {
      m: em, d: ed, type: eType, isSat: isSaturday(em, ed), dow: dow(em, ed),
      vacation: vacationForDay(em, ed),
    };
  }

  if (!loaded) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#080c16", color: "#6b7280" }}>
      Загрузка...
    </div>
  );

  const currentYear = new Date().getFullYear();

  return (
    <div className="root">
      <div className="user-bar">
        {user.image && <Image src={user.image} alt="" width={32} height={32} style={{ borderRadius: "50%" }} referrerPolicy="no-referrer" />}
        <span>{user.name}</span>
        <button onClick={() => signOut()}>Выйти</button>
      </div>

      {currentYear !== YEAR && (
        <div style={{ background: "#7c2d12", color: "#fed7aa", padding: "10px 16px", textAlign: "center", fontSize: 13, borderRadius: 8, margin: "8px 0" }}>
          Внимание: календарь составлен для {YEAR} года, данные могут быть неактуальны для {currentYear}.
        </div>
      )}

      {saveError && (
        <div style={{ background: "#7f1d1d", color: "#fca5a5", padding: "8px 16px", textAlign: "center", fontSize: 13, borderRadius: 8, margin: "4px 0" }}>
          Ошибка сохранения настроек. Проверьте соединение.
        </div>
      )}

      {vacationWarning && (
        <div className="vacation-warn" role="alert">
          <span>{vacationWarning}</span>
          <button type="button" className="vacation-warn-close" onClick={() => setVacationWarning("")}>Понятно</button>
        </div>
      )}

      <div className="hdr">
        <Image className="hdr-logo" src="/assets/computrols-logo-muted.svg" alt="КОМПЬЮТРОЛС" width={180} height={40} priority />
        <h1>Календарь трудочасов</h1>
      </div>

      <div className="tabs">
        {[ ["calc", "Калькулятор"], ["year", "Годовой обзор"] ].map(([k, v]) => (
          <button key={k} className={`tb ${tab === k ? "tb-a" : ""}`} onClick={() => setTab(k)}>{v}</button>
        ))}
      </div>

      {tab === "calc" && (<>
        {selMode && (
          <div className="sel-bar">
            <div className="sel-bar-top">
              <span className="sel-bar-title">Выбрано: {selectedDays.size} дн.</span>
              <button className="sel-bar-cancel" onClick={exitSelMode}>Отменить выделение</button>
            </div>
            <div className="sel-bar-row">
              <span className="sel-bar-label">Отклонение:</span>
              <input
                className="sel-bar-input"
                type="number" min="-8" max="24" step="0.5"
                value={bulkVal}
                placeholder="—"
                onChange={(e) => setBulkVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confirmBulk(); if (e.key === "Escape") exitSelMode(); }}
                autoFocus
              />
              <span className="sel-bar-label">ч</span>
              <button className="sel-bar-ok" onClick={confirmBulk}>Применить</button>
              <button className="sel-bar-del" onClick={() => applyBulk(0)}>Убрать</button>
            </div>
          </div>
        )}

        {editInfo && !selMode && (
          <div className="edit-bar">
            <span className="eb-label">{editInfo.d} {MONTHS_SHORT[editInfo.m]}, {WEEKDAYS[editInfo.dow]}
              {editInfo.type === "preholiday" ? " (сокр.)" : ""}{editInfo.isSat && editInfo.type === "weekend" ? " (сб)" : ""}
            </span>
            <span style={{ fontSize: 11, color: "#6b7280" }}>Норма: {dayNorm(YEAR, editInfo.m, editInfo.d)} ч</span>
            {editInfo.vacation && (
              <span className="eb-vac-warn" role="status">Отпуск: часы за этот день не сохраняются</span>
            )}
            <input className="eb-input" type="number" min="0" max="24" step="0.5" value={editVal}
              aria-label="Фактически отработано"
              onChange={(e) => setEditVal(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmEdit(); if (e.key === "Escape") setEditingDay(null); }} autoFocus />
            <span style={{ fontSize: 11, color: "#6b7280" }}>ч фактически</span>
            <button className="eb-ok" onClick={confirmEdit}>Сохранить</button>
            <button className="eb-del" onClick={() => { const key = `${editInfo.m}-${editInfo.d}`; setOvertime((prev) => { const next = { ...prev }; delete next[key]; return next; }); api(`/api/work-hours?year=${YEAR}&month=${editInfo.m}&day=${editInfo.d}`, "DELETE"); setEditingDay(null); }}>Сбросить к норме</button>
            <button className="eb-note" type="button" aria-label="Заметка дня" onClick={openNoteDialog}><NoteIcon /></button>
            <button className="eb-cancel" onClick={() => setEditingDay(null)}>✕</button>
          </div>
        )}

        {noteDialog && (
          <div className="note-backdrop" role="presentation" onMouseDown={() => !noteBusy && setNoteDialog(null)}>
            <section className="note-dialog" role="dialog" aria-modal="true" aria-label="Заметка дня" onMouseDown={(event) => event.stopPropagation()}>
              <div className="note-head"><div className="note-title">Заметка · {noteDialog.day} {MONTHS_SHORT[noteDialog.month]}</div><button type="button" className="note-delete" aria-label="Удалить заметку" title="Удалить заметку и вложения" disabled={noteBusy} onClick={deleteNote}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M6 4V2.5h4V4m-6 0 .6 9h6.8l.6-9M6.5 6.5v4M9.5 6.5v4" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg></button></div>
              <textarea aria-label="Текст заметки" maxLength="5000" value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="Текст заметки" />
              <label className="note-file">📎 Прикрепить файл<input aria-label="Прикрепить файл" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt" onChange={uploadNoteFile} disabled={noteBusy || noteAttachments.length >= 5} /></label>
              <div className="note-files">{noteAttachments.map((file) => <a key={file.id} href={`/api/day-notes/attachments/${file.id}`} download>{file.originalName}</a>)}</div>
              {noteError && <div className="note-error">{noteError}</div>}
              <div className="note-actions"><button type="button" className="eb-cancel" disabled={noteBusy} onClick={() => setNoteDialog(null)}>Отмена</button><button type="button" className="eb-ok" disabled={noteBusy} onClick={saveNote}>{noteBusy ? "Сохранение…" : "Сохранить"}</button></div>
            </section>
          </div>
        )}

        <div className="month-view" ref={monthViewRef}>
          <div className="mv-header">
            <div className="mv-title">{MONTHS[cm]}</div>
          </div>
          <table className="cal-tbl">
            <thead><tr>{WEEKDAYS.map((w, i) => <th key={i} className={i >= 5 ? "th-we" : ""}>{w}</th>)}</tr></thead>
            <tbody>{calRows}</tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 14 }}>
          <button className="mv-btn" onClick={() => setCm(Math.max(0, cm - 1))} disabled={cm === 0}>← {cm > 0 ? MONTHS_SHORT[cm - 1] : ""}</button>
          <button className="mv-btn" onClick={() => setCm(Math.min(11, cm + 1))} disabled={cm === 11}>{cm < 11 ? MONTHS_SHORT[cm + 1] : ""} →</button>
        </div>
        <div className="summary">
          <div className="sum-title">{MONTHS[cm]} {YEAR}</div>
          <div className="sum-grid">
            <div className="sg"><div className="sg-v v-blue">{cmStats.workDays}</div><div className="sg-l">рабочих дней</div></div>
            <div className="sg"><div className="sg-v v-green">{cmStats.positiveHours}</div><div className="sg-l">часов сверх нормы</div></div>
            <div className="sg"><div className="sg-v v-red">{cmStats.underworkHours}</div><div className="sg-l">часов недоработки</div></div>
            <div className="sg"><div className="sg-v v-orange">{fmt(cmStats.total)} ₽</div><div className="sg-l">итого за месяц</div></div>
          </div>
          <div className="sum-breakdown">
            {cmStats.hasVacation ? (
              // The salary share of the vacation hours (and of any absence) is
              // already deducted, so the row shows the actual work pay — the
              // numbers below still add up to the month total.
              <div className="sb-line"><span>Оплата работы</span><span className="sb-val">{formatKopecks(cmStats.adjustedOkladKopecks)} ₽</span></div>
            ) : (
              <div className="sb-line"><span>Оклад</span><span className="sb-val">{fmt(oklad)} ₽</span></div>
            )}
            {cmStats.underworkHours > 0 && <div className="sb-line"><span>Недоработка: {cmStats.underworkHours} ч</span><span className="sb-val" style={{ color: "#ef4444" }}>−</span></div>}
            {cmStats.absenceHours > 0 && <div className="sb-line"><span>Не работал: {cmStats.absenceHours / 8} дн. ({cmStats.absenceHours} ч)</span><span className="sb-val" style={{ color: "#ef4444" }}>−</span></div>}
            {cmStats.coveredHours > 0 && <div className="sb-line"><span>Покрыто переработкой: {cmStats.coveredHours} ч</span><span className="sb-val" style={{ color: "#10b981" }}>✓</span></div>}
            {cmStats.deduction > 0 && !cmStats.hasVacation && <div className="sb-line"><span>Вычет из оклада</span><span className="sb-val" style={{ color: "#ef4444" }}>−{fmt(Math.round(cmStats.deduction))} ₽</span></div>}
            <div className="sb-line"><span>Переработка: {cmStats.effectiveOT} ч × {fmt(effectiveOtRate)} ₽</span><span className="sb-val">{fmt(cmStats.otPay)} ₽</span></div>
            {cmStats.vacationPayKopecks > 0 && (
              <div className="sb-line sb-vac-pay">
                <span>Отпускные</span>
                <span className="sb-val" style={{ color: "#10b981" }}>{formatKopecks(cmStats.vacationPayKopecks)} ₽</span>
              </div>
            )}
            <div className="sb-line sb-total">
              <span>Итого</span>
              <span className="sb-val">
                {cmStats.vacationPayKopecks > 0 ? formatKopecks(cmStats.totalKopecks) : fmt(Math.round(cmStats.total))} ₽
              </span>
            </div>
          </div>
          {cmStats.vacationPayKopecks > 0 && (
            <div className="vacation-payment-status">
              <div>Отпускные уже выплачены: {formatKopecks(cmStats.vacationPaidKopecks)} ₽</div>
              <div>Осталось выплатить отпускных: {formatKopecks(cmStats.vacationOutstandingKopecks)} ₽</div>
            </div>
          )}
          <div className="pay-periods">
            <div className="pp">
              <div className="pp-label">Аванс <span className="pp-range">1–15</span></div>
              <div className="pp-row">
                <span className="pp-type pp-type-card">💳 Карта</span>
                <span className="pp-sum">{formatKopecks(payPeriods.firstHalf.workPayKopecks)} ₽</span>
              </div>
              <div className="pp-row">
                <span className="pp-type pp-type-cash">💵 Наличные</span>
                <span className="pp-sum">{payPeriods.firstHalf.overtimePay > 0 ? fmt(payPeriods.firstHalf.overtimePay) + " ₽" : "—"}</span>
              </div>
              <div className="pp-total">{fmt(payPeriods.advance)} ₽</div>
            </div>
            <div className="pp-divider">+</div>
            <div className="pp">
              <div className="pp-label">Перерасчёт <span className="pp-range">16–{daysInMonth(cm)}</span></div>
              <div className="pp-row">
                <span className="pp-type pp-type-card">💳 Карта</span>
                <span className="pp-sum">{formatKopecks(payPeriods.secondHalf.workPayKopecks)} ₽</span>
              </div>
              <div className="pp-row">
                <span className="pp-type pp-type-cash">💵 Наличные</span>
                <span className="pp-sum">{payPeriods.secondHalf.overtimePay > 0 ? fmt(payPeriods.secondHalf.overtimePay) + " ₽" : "—"}</span>
              </div>
              <div className="pp-total">{fmt(payPeriods.settlement)} ₽</div>
            </div>
          </div>
        </div>

        <div className="mstrip">
          {MONTHS.map((_, i) => { const s = monthStats[i]; return (
            <div key={i} className={`mm ${i === cm ? "mm-a" : ""} ${s.effectiveOT > 0 ? "mm-has" : ""} ${s.underworkHours > 0 ? "mm-under" : ""}`} onClick={() => setCm(i)}>
              <div className="mm-name">{MONTHS_SHORT[i]}</div>
              <div className="mm-total">{fmt(s.total)}₽</div>
              {s.effectiveOT > 0 && <div className="mm-ot">+{s.effectiveOT}ч</div>}
              {s.underworkHours > 0 && <div className="mm-under-label">−{s.underworkHours}ч</div>}
            </div>
          ); })}
        </div>

        <div className="settings">
          <div className="settings-title">Настройки</div>
          <div className="s-row">
            <div className="s-field"><label htmlFor="salary-input">Оклад / месяц</label>
              <input id="salary-input" className="s-input" type="number" min="0" step="1000" value={oklad || ""} onChange={(e) => setOklad(Math.max(0, parseFloat(e.target.value) || 0))} /><div className="s-unit">₽ фиксированный</div></div>
            <div className="s-field"><label htmlFor="overtime-rate-input">Ставка переработки</label>
              <input id="overtime-rate-input" className="s-input" type="number" min="0" step="0.01" value={effectiveOtRate || ""} disabled={autoOtRate} onChange={(e) => setOtRate(Math.max(0, parseFloat(e.target.value) || 0))} /><div className="s-unit">₽ / час</div></div>
          </div>
          <label className="s-auto-rate">
            <input type="checkbox" checked={autoOtRate} onChange={(e) => setAutoOtRate(e.target.checked)} />
            <span>Рассчитывать ставку автоматически</span>
          </label>
        </div>

        <VacationPanel year={YEAR} month={cm} vacations={vacations} onRefresh={refreshVacations} />
      </>)}

      {tab === "year" && (
        <div style={{ background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 14, padding: 14 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button className="mv-btn" onClick={exportExcel}>Экспорт Excel</button>
            <button className="mv-btn" onClick={exportJpeg}>Экспорт JPEG</button>
          </div>
          <table className="yo-tbl" ref={yearTableRef}>
            <thead><tr><th>Месяц</th><th>Раб.дн.</th><th>Оклад</th><th>Вычет</th><th>Перераб.(ч)</th><th>Перераб.(₽)</th><th>Итого</th></tr></thead>
            <tbody>
              {monthStats.map((s, i) => (
                <tr key={i}><td className="yo-m" onClick={() => { setCm(i); setTab("calc"); }}>{MONTHS_SHORT[i]}</td>
                  <td>{s.workDays}</td><td>{fmt(s.oklad)}</td>
                  <td style={{ color: "#ef4444", fontWeight: 600 }}>{s.deduction > 0 ? `−${fmt(Math.round(s.deduction))}` : "—"}</td>
                  <td className="yo-h">{s.effectiveOT || "—"}</td>
                  <td className="yo-p">{s.otPay ? fmt(s.otPay) : "—"}</td><td className="yo-t">{fmt(Math.round(s.total))}</td></tr>
              ))}
              <tr className="yo-total"><td className="yo-m">{YEAR} год</td><td>247</td><td>{fmt(Math.round(yearTotals.oklad))}</td>
                <td style={{ color: "#ef4444", fontWeight: 700 }}>{yearTotals.deduction > 0 ? `−${fmt(Math.round(yearTotals.deduction))}` : "—"}</td>
                <td className="yo-h">{yearTotals.otHours || "—"}</td><td className="yo-p">{yearTotals.otPay ? fmt(yearTotals.otPay) : "—"}</td>
                <td className="yo-t">{fmt(Math.round(yearTotals.total))}</td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
