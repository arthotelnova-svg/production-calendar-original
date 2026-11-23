"use client";
import { useState } from "react";
import { formatKopecks, splitKopecks, toKopecks } from "../../lib/money";
import { enumerateDates, isPublicHoliday } from "../../lib/vacation";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIsoParts(value) {
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function formatIsoDate(value) {
  const parts = parseIsoParts(value);
  if (!parts) return value ?? "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(parts.day)}.${pad(parts.month + 1)}.${parts.year}`;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function emptyHalves(year, month) {
  return [
    { half: 1, fromDay: 1, toDay: 15, paidDays: 0, kopecks: 0, paidKopecks: 0 },
    { half: 2, fromDay: 16, toDay: daysInMonth(year, month), paidDays: 0, kopecks: 0, paidKopecks: 0 },
  ];
}

// UI-side adapter for vacation money.
//
// The calculation module (`lib/vacation-pay.js`) is owned by another change, so
// the panel derives its own figures from the same primitives it will use:
// inclusive ISO ranges, statutory public holidays excluded from paid vacation
// days (ТК РФ ст. 112/120) and integer kopecks split by paid days. The parts
// always add back up to the entered net amount, so no ruble is invented or
// duplicated. When `computeMonthPay` lands this function is the only thing that
// has to be swapped for it.
export function sumVacationPayByHalf({ year, month, vacations }) {
  const halves = emptyHalves(year, month);
  const list = Array.isArray(vacations) ? vacations : [];
  let count = 0;
  let totalKopecks = 0;
  let paidKopecks = 0;

  for (const vacation of list) {
    const start = parseIsoParts(vacation?.startDate);
    const end = parseIsoParts(vacation?.endDate);
    const amount = vacation?.amountKopecks;
    if (!start || !end || !Number.isSafeInteger(amount) || amount <= 0) continue;

    const buckets = [];
    for (const date of enumerateDates(start, end)) {
      if (date.year !== year) continue;
      if (isPublicHoliday(date.year, date.month, date.day)) continue;
      const half = date.day <= 15 ? 1 : 2;
      const key = `${date.month}-${half}`;
      let bucket = buckets.find((item) => item.key === key);
      if (!bucket) {
        bucket = { key, month: date.month, half, paidDays: 0 };
        buckets.push(bucket);
      }
      bucket.paidDays += 1;
    }
    if (buckets.length === 0) continue;

    const parts = splitKopecks(amount, buckets.map((bucket) => bucket.paidDays));
    let touchesMonth = false;
    buckets.forEach((bucket, index) => {
      if (bucket.month !== month) return;
      const target = halves[bucket.half - 1];
      target.paidDays += bucket.paidDays;
      target.kopecks += parts[index];
      if (vacation.paid) target.paidKopecks += parts[index];
      touchesMonth = true;
    });
    if (!touchesMonth) continue;

    count += 1;
    totalKopecks += buckets.reduce((sum, bucket, index) => (bucket.month === month ? sum + parts[index] : sum), 0);
    if (vacation.paid) {
      paidKopecks += buckets.reduce((sum, bucket, index) => (bucket.month === month ? sum + parts[index] : sum), 0);
    }
  }

  return {
    count,
    totalKopecks,
    paidKopecks,
    outstandingKopecks: totalKopecks - paidKopecks,
    halves,
  };
}

// Days of `month` covered by a saved vacation, mapped to the range label, so the
// calendar and the day editor can see the absence instead of guessing.
export function vacationDaysOfMonth(vacations, year, month) {
  const days = new Map();
  const list = Array.isArray(vacations) ? vacations : [];
  for (const vacation of list) {
    const start = parseIsoParts(vacation?.startDate);
    const end = parseIsoParts(vacation?.endDate);
    if (!start || !end) continue;
    const label = `${formatIsoDate(vacation.startDate)} — ${formatIsoDate(vacation.endDate)}`;
    for (const date of enumerateDates(start, end)) {
      if (date.year !== year || date.month !== month) continue;
      days.set(date.day, { id: vacation.id, label, paid: Boolean(vacation.paid) });
    }
  }
  return days;
}

export default function VacationPanel({ year, month, vacations, onRefresh }) {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [amount, setAmount] = useState("");
  const [paid, setPaid] = useState(false);
  const [paidDate, setPaidDate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const list = Array.isArray(vacations) ? vacations : [];

  const submit = async () => {
    setError("");
    if (!startDate || !endDate) {
      setError("Укажите даты начала и окончания отпуска.");
      return;
    }
    if (endDate < startDate) {
      setError("Дата окончания отпуска не может быть раньше даты начала.");
      return;
    }
    const amountKopecks = toKopecks(amount.trim());
    if (amountKopecks === null || amountKopecks <= 0) {
      setError("Укажите сумму отпускных в рублях, например 26068,50.");
      return;
    }

    const payload = {
      startDate,
      endDate,
      amountKopecks,
      paid,
      paidDate: paid && paidDate ? paidDate : null,
    };

    setBusy(true);
    try {
      const response = await fetch("/api/vacations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setError(result?.error || `Не удалось сохранить отпуск (код ${response.status}).`);
        setBusy(false);
        return;
      }
      // Clear only after the server confirmed the row; nothing typed is lost on
      // an error path above.
      setStartDate("");
      setEndDate("");
      setAmount("");
      setPaid(false);
      setPaidDate("");
      setOpen(false);
      if (typeof onRefresh === "function") await onRefresh();
    } catch {
      setError("Не удалось сохранить отпуск. Проверьте соединение и повторите попытку.");
    }
    setBusy(false);
  };

  return (
    <div className="vacation-panel">
      <div className="vacation-head">
        <div className="vacation-title">Отпускные</div>
        <button
          type="button"
          className="vacation-toggle"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          Добавить отпуск
        </button>
      </div>

      {open && (
        <div className="vacation-form">
          <div className="vacation-field">
            <label htmlFor="vacation-start">Начало отпуска</label>
            <input id="vacation-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="vacation-field">
            <label htmlFor="vacation-end">Окончание отпуска</label>
            <input id="vacation-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="vacation-field">
            <label htmlFor="vacation-amount">Сумма отпускных, ₽</label>
            <input id="vacation-amount" inputMode="decimal" placeholder="например 26068,50" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="vacation-field vacation-field-paid">
            <label className="vacation-paid-label" htmlFor="vacation-paid">
              <input id="vacation-paid" type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
              <span>Отпускные выплачены</span>
            </label>
            <label htmlFor="vacation-paid-date">Дата выплаты</label>
            <input
              id="vacation-paid-date"
              type="date"
              value={paidDate}
              disabled={!paid}
              onChange={(e) => setPaidDate(e.target.value)}
            />
          </div>
          <div className="vacation-actions">
            <button type="button" className="vacation-save" disabled={busy} onClick={submit}>
              {busy ? "Сохранение…" : "Сохранить отпуск"}
            </button>
          </div>
          {error && (
            <div className="vacation-error" role="alert">
              {error}
            </div>
          )}
        </div>
      )}

      {list.length === 0 ? (
        <div className="vacation-empty">Отпуска за {year} год не добавлены.</div>
      ) : (
        <>
          <div className="vacation-net-label">прогноз на руки</div>
          <div className="vacation-list">
            {list.map((vacation) => {
              const isPaid = Boolean(vacation.paid);
              return (
                <div key={vacation.id ?? `${vacation.startDate}-${vacation.endDate}`} className="vacation-row">
                  <div className="vacation-dates">
                    {formatIsoDate(vacation.startDate)} — {formatIsoDate(vacation.endDate)}
                  </div>
                  <div className="vacation-amount">{formatKopecks(vacation.amountKopecks)} ₽</div>
                  <div className={`vacation-status ${isPaid ? "vacation-status-paid" : "vacation-status-unpaid"}`}>
                    {isPaid
                      ? vacation.paidDate
                        ? `выплачено ${formatIsoDate(vacation.paidDate)}`
                        : "выплачено"
                      : "не выплачено"}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {typeof month === "number" ? null : null}
    </div>
  );
}
