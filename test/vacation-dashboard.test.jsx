import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardClient from "../app/dashboard/client";
import { sumVacationPayByHalf } from "../app/dashboard/vacation-panel";
import { formatKopecks } from "../lib/money";

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("next/image", () => ({
  default: ({ priority: _priority, ...props }) => <img {...props} />,
}));

const YEAR = 2026;
// Pinned to November 2026: 20 scheduled workdays and a Nov 2–8 vacation whose
// scheduled hours are 8 (Mon 2), 7 (pre-holiday Tue 3), 0 (holiday Wed 4),
// 8 (Thu 5), 8 (Fri 6), 0 (Sat 7), 0 (Sun 8) — 31 hours in total.
const MONTH = 10;
const MM = "11";

const SETTINGS = { oklad: 135000, ot_rate: 164, auto_ot_rate: 0 };

const VACATION = {
  id: 1,
  startDate: `${YEAR}-${MM}-02`,
  endDate: `${YEAR}-${MM}-08`,
  year: YEAR,
  amountKopecks: 2606800,
  paid: false,
  paidDate: null,
};

// The app's established convention (see the code comment on monthStats):
// salary ÷ (scheduled workdays × 8) per hour, so a vacation deducts the salary
// share of the scheduled hours it covers. This is NOT the statutory average
// earnings calculation — it is the owner's current calendar convention.
const OKLAD_KOPECKS = 13500000;
const WORKDAYS = 20;
const HOURLY_RATE_KOPECKS = OKLAD_KOPECKS / (WORKDAYS * 8); // 84 375 kopecks
const VACATION_SCHEDULED_HOURS = 31;
const VACATION_DEDUCTION_KOPECKS = HOURLY_RATE_KOPECKS * VACATION_SCHEDULED_HOURS; // 2 615 625
const VACATION_KOPECKS = 2606800;
const TOTAL_KOPECKS = OKLAD_KOPECKS - VACATION_DEDUCTION_KOPECKS + VACATION_KOPECKS; // 13 491 175

// Per-half salary bases: 9 workdays in 1–15, 11 workdays in 16–30.
const BASE1_KOPECKS = (OKLAD_KOPECKS / WORKDAYS) * 9;
const BASE2_KOPECKS = (OKLAD_KOPECKS / WORKDAYS) * 11;
// Work pay after the vacation deduction: the halves carry no vacation money.
const ADJUSTED_OKLAD_KOPECKS = OKLAD_KOPECKS - VACATION_DEDUCTION_KOPECKS;
const ADVANCE_KOPECKS = BASE1_KOPECKS - VACATION_DEDUCTION_KOPECKS;
const SETTLEMENT_KOPECKS = BASE2_KOPECKS;
// Manual overtime rate from SETTINGS (auto mode off) and 10 worked hours on a
// plain 8-hour weekday: 2 payable overtime hours → 328 ₽ of cash per half.
const OVERTIME_HOURS = 2;
const OVERTIME_RATE_KOPECKS = 16400;
const CASH_KOPECKS = OVERTIME_HOURS * OVERTIME_RATE_KOPECKS;

function jsonResponse(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}

function normalize(text) {
  return String(text).replace(/\s/g, " ").trim();
}

function ruble(kopecks) {
  return normalize(`${formatKopecks(kopecks)} ₽`);
}

describe("dashboard vacation integration", () => {
  let fetchMock;
  let vacations;
  let workHoursData;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
    vacations = [];
    workHoursData = {};
    fetchMock = vi.fn(async (url, options = {}) => {
      const method = options.method || "GET";
      if (method === "GET") {
        if (url === "/api/settings") return jsonResponse(SETTINGS);
        if (url === `/api/work-hours?year=${YEAR}`) return jsonResponse(workHoursData);
        if (url === `/api/absences?year=${YEAR}`) return jsonResponse({});
        if (url === `/api/day-notes?year=${YEAR}`) return jsonResponse({});
        if (url === `/api/vacations?year=${YEAR}`) return jsonResponse({ year: YEAR, vacations });
        return jsonResponse({ ok: true });
      }
      if (url === "/api/vacations") {
        const body = JSON.parse(options.body);
        const created = { id: 99, ...body };
        vacations = [...vacations, created];
        return jsonResponse({ vacation: created }, { status: 201 });
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function renderDashboard() {
    const rendered = render(<DashboardClient user={{ name: "Тестовый пользователь" }} />);
    await screen.findByText("Календарь трудочасов");
    return rendered;
  }

  function summaryLines(container) {
    return [...container.querySelectorAll(".sum-breakdown .sb-line")].map((line) => ({
      text: normalize(line.textContent),
      label: normalize(line.querySelector("span")?.textContent ?? ""),
      value: normalize(line.querySelector(".sb-val")?.textContent ?? ""),
    }));
  }

  function payTotals(container) {
    return [...container.querySelectorAll(".pp-total")].map((node) => normalize(node.textContent));
  }

  function cashRows(container) {
    return [...container.querySelectorAll(".pp-row")]
      .filter((row) => normalize(row.querySelector(".pp-type")?.textContent ?? "").includes("Наличные"))
      .map((row) => normalize(row.querySelector(".pp-sum")?.textContent ?? ""));
  }

  function dayCell(container, dayNumber) {
    return [...container.querySelectorAll(".cal-tbl tbody td")].find(
      (cell) => cell.querySelector(".dc-num")?.textContent === String(dayNumber)
    );
  }

  function workHoursPosts() {
    return fetchMock.mock.calls.filter(([url, options]) => url === "/api/work-hours" && options?.method === "POST");
  }

  function overtimePosts() {
    return fetchMock.mock.calls.filter(([url, options]) => url === "/api/overtime" && options?.method === "POST");
  }

  it("loads the owner's vacation list from the year endpoint", async () => {
    vacations = [VACATION];
    await renderDashboard();

    expect(fetchMock.mock.calls.some(([url]) => url === `/api/vacations?year=${YEAR}`)).toBe(true);
    await waitFor(() => expect(document.querySelectorAll(".vacation-row")).toHaveLength(1));
    expect(normalize(document.querySelector(".vacation-row").textContent)).toContain(
      `02.${MM}.2026 — 08.${MM}.2026`
    );
  });

  it("deducts the salary share of the scheduled vacation hours without showing a red deduction row", async () => {
    vacations = [VACATION];
    const expected = sumVacationPayByHalf({ year: YEAR, month: MONTH, vacations: [VACATION] });
    expect(expected.totalKopecks).toBe(VACATION_KOPECKS);

    const { container } = await renderDashboard();
    await waitFor(() => expect(container.querySelector(".vacation-row")).toBeInTheDocument());

    // The arithmetic itself: 135 000 − 26 156,25 + 26 068 = 134 911,75 ₽.
    expect(TOTAL_KOPECKS).toBe(13491175);

    const lines = summaryLines(container);

    const vacationLine = lines.find((line) => line.label.startsWith("Отпускные"));
    expect(vacationLine).toBeDefined();
    expect(vacationLine.value).toBe(ruble(VACATION_KOPECKS));

    // The red "Вычет за дни отпуска: 31 ч" row is gone from the owner's summary…
    expect(container.querySelector(".sb-vac-deduction")).not.toBeInTheDocument();
    expect(container.querySelector(".sum-breakdown").textContent).not.toContain("Вычет за дни отпуска");
    expect(lines.some((line) => line.label.includes(`${VACATION_SCHEDULED_HOURS} ч`) && line.label.includes("отпуск"))).toBe(false);

    // …but the deduction itself survives: the salary row shows the adjusted
    // work pay under its vacation label, so the visible rows still add up.
    const salaryLine = lines.find((line) => line.label === "Оплата работы");
    expect(salaryLine).toBeDefined();
    expect(salaryLine.value).toBe(ruble(ADJUSTED_OKLAD_KOPECKS));
    expect(lines.some((line) => line.label === "Оклад")).toBe(false);
    const visibleSum = ADJUSTED_OKLAD_KOPECKS + VACATION_KOPECKS;
    expect(visibleSum).toBe(TOTAL_KOPECKS);

    const totalLine = container.querySelector(".sum-breakdown .sb-total");
    expect(normalize(totalLine.querySelector(".sb-val").textContent)).toBe(ruble(TOTAL_KOPECKS));

    // The erroneous expectation of a full salary plus vacation is rejected.
    expect(normalize(totalLine.querySelector(".sb-val").textContent)).not.toBe(ruble(OKLAD_KOPECKS + VACATION_KOPECKS));
    expect(normalize(container.querySelector(".sum-grid").textContent)).toContain(normalize(formatKopecks(TOTAL_KOPECKS)));

    // The vacation amount appears in exactly one breakdown line.
    expect(lines.filter((line) => line.value === ruble(VACATION_KOPECKS))).toHaveLength(1);
    expect(container.querySelectorAll(".sb-vac-pay")).toHaveLength(1);
  });

  it("shows received vacation money separately without adding it to income twice", async () => {
    vacations = [{ ...VACATION, paid: true }];
    const { container } = await renderDashboard();
    await waitFor(() => expect(container.querySelector(".vacation-row")).toBeInTheDocument());
    expect(normalize(container.querySelector(".sb-total .sb-val").textContent)).toBe(ruble(TOTAL_KOPECKS));
    expect(normalize(container.querySelector(".vacation-payment-status").textContent)).toContain("Отпускные уже выплачены: 26 068 ₽");
    expect(normalize(container.querySelector(".vacation-payment-status").textContent)).toContain("Осталось выплатить отпускных: 0 ₽");
    // The obsolete note about how half totals are meant is removed.
    expect(container.querySelector(".vacation-payment-status small")).not.toBeInTheDocument();
    expect(normalize(container.querySelector(".vacation-payment-status").textContent)).not.toContain("Итоги половин месяца");
    expect(normalize(container.querySelector(".pp .pp-sum").textContent)).toBe(ruble(BASE1_KOPECKS - VACATION_DEDUCTION_KOPECKS));
  });

  it("keeps vacation money out of both halves and lets the halves sum to the month total", async () => {
    vacations = [VACATION];
    const { container } = await renderDashboard();
    await waitFor(() => expect(container.querySelector(".vacation-row")).toBeInTheDocument());

    // No per-half vacation rows in either column.
    expect(container.querySelectorAll(".pp-vacation")).toHaveLength(0);
    expect(container.querySelector(".pay-periods").textContent).not.toContain("Отпускные");
    expect(container.querySelector(".pay-periods").textContent).not.toContain("🌴");

    // Half totals are net of vacation: the salary share of the 31 hours is gone
    // and the vacation money is not added back into either half.
    expect(payTotals(container)).toEqual([ruble(ADVANCE_KOPECKS), ruble(SETTLEMENT_KOPECKS)]);
    expect(ADVANCE_KOPECKS + SETTLEMENT_KOPECKS).toBe(ADJUSTED_OKLAD_KOPECKS);

    // The month total still counts the vacation money exactly once.
    expect(normalize(container.querySelector(".sb-total .sb-val").textContent)).toBe(ruble(TOTAL_KOPECKS));
    expect(ADVANCE_KOPECKS + SETTLEMENT_KOPECKS + VACATION_KOPECKS).toBe(TOTAL_KOPECKS);
  });

  it("keeps nonzero cash overtime visible in both halves alongside the net vacation handling", async () => {
    vacations = [VACATION];
    workHoursData = { [`${MONTH}-10`]: 10, [`${MONTH}-20`]: 10 };
    const { container } = await renderDashboard();
    await waitFor(() => expect(container.querySelector(".vacation-row")).toBeInTheDocument());

    expect(cashRows(container)).toEqual([ruble(CASH_KOPECKS), ruble(CASH_KOPECKS)]);

    expect(payTotals(container)).toEqual([
      ruble(ADVANCE_KOPECKS + CASH_KOPECKS),
      ruble(SETTLEMENT_KOPECKS + CASH_KOPECKS),
    ]);
    expect(container.querySelectorAll(".pp-vacation")).toHaveLength(0);
  });

  it("keeps the no-vacation pay periods and summary untouched", async () => {
    const { container } = await renderDashboard();

    expect(payTotals(container)).toEqual([ruble(BASE1_KOPECKS), ruble(BASE2_KOPECKS)]);
    const totalLine = container.querySelector(".sum-breakdown .sb-total");
    expect(normalize(totalLine.querySelector(".sb-val").textContent)).toBe("135 000 ₽");
    expect(container.querySelector(".pp-vacation")).not.toBeInTheDocument();
    expect(container.querySelector(".sum-breakdown").textContent).not.toContain("Отпускные");
  });

  it("shows no vacation markup and a plain empty state when the list is empty", async () => {
    const { container } = await renderDashboard();

    expect(container.querySelector(".pp-vacation")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".vacation-row")).toHaveLength(0);
    expect(screen.getByText("Отпуска за 2026 год не добавлены.")).toBeInTheDocument();
  });

  it("refetches the owner's list after a successful create", async () => {
    await renderDashboard();
    const before = fetchMock.mock.calls.filter(([url]) => url === `/api/vacations?year=${YEAR}`).length;

    fireEvent.click(screen.getByRole("button", { name: "Добавить отпуск" }));
    fireEvent.change(screen.getByLabelText("Начало отпуска"), { target: { value: `${YEAR}-${MM}-02` } });
    fireEvent.change(screen.getByLabelText("Окончание отпуска"), { target: { value: `${YEAR}-${MM}-08` } });
    fireEvent.change(screen.getByLabelText("Сумма отпускных, ₽"), { target: { value: "26068" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить отпуск" }));

    const post = await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url, options]) => url === "/api/vacations" && options?.method === "POST");
      expect(call).toBeDefined();
      return call;
    });
    expect(JSON.parse(post[1].body)).toEqual({
      startDate: `${YEAR}-${MM}-02`,
      endDate: `${YEAR}-${MM}-08`,
      amountKopecks: 2606800,
      paid: false,
      paidDate: null,
    });

    await waitFor(() => {
      const after = fetchMock.mock.calls.filter(([url]) => url === `/api/vacations?year=${YEAR}`).length;
      expect(after).toBe(before + 1);
    });
    await waitFor(() => expect(document.querySelector(".vacation-row")).toBeInTheDocument());
  });

  it("warns in the day editor and refuses to write hours for a vacation day", async () => {
    vacations = [VACATION];
    const { container } = await renderDashboard();
    await waitFor(() => expect(container.querySelector(".vacation-row")).toBeInTheDocument());

    const cell = dayCell(container, 5);
    expect(cell).toBeDefined();
    fireEvent.click(cell);

    const warning = await waitFor(() => container.querySelector(".eb-vac-warn"));
    expect(normalize(warning.textContent)).toMatch(/отпуск/i);

    fireEvent.change(screen.getByLabelText("Фактически отработано"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    const banner = await waitFor(() => container.querySelector(".vacation-warn"));
    expect(normalize(banner.textContent)).toMatch(/отпуск/i);

    // Nothing was written and no underwork badge appeared for the vacation day.
    expect(workHoursPosts()).toHaveLength(0);
    expect(container.querySelector(".dc-hours")).not.toBeInTheDocument();
  });

  it("blocks a bulk save that would write hours over vacation days", async () => {
    vacations = [VACATION];
    const { container } = await renderDashboard();
    await waitFor(() => expect(container.querySelector(".vacation-row")).toBeInTheDocument());

    fireEvent.contextMenu(dayCell(container, 5));
    const bar = await waitFor(() => container.querySelector(".sel-bar"));
    expect(bar).toBeInTheDocument();

    fireEvent.change(container.querySelector(".sel-bar-input"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Применить" }));

    const banner = await waitFor(() => container.querySelector(".vacation-warn"));
    expect(normalize(banner.textContent)).toMatch(/отпуск/i);
    expect(overtimePosts()).toHaveLength(0);
    expect(workHoursPosts()).toHaveLength(0);
  });

  it("still saves days that are not covered by a vacation", async () => {
    vacations = [VACATION];
    const { container } = await renderDashboard();
    await waitFor(() => expect(container.querySelector(".vacation-row")).toBeInTheDocument());

    fireEvent.click(dayCell(container, 10));
    await waitFor(() => expect(container.querySelector(".eb-input")).toBeInTheDocument());
    expect(container.querySelector(".eb-vac-warn")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Фактически отработано"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      const saved = workHoursPosts().some(([, options]) => JSON.parse(options.body).hours === 10);
      expect(saved).toBe(true);
    });
  });

  it("marks vacation days on the calendar without touching the existing day badges", async () => {
    vacations = [VACATION];
    const { container } = await renderDashboard();
    await waitFor(() => expect(container.querySelector(".vacation-row")).toBeInTheDocument());

    const marked = [...container.querySelectorAll(".cal-tbl tbody .dc-vac")];
    expect(marked.length).toBeGreaterThan(0);
    expect(marked[0].querySelector(".dc-vac-mark")).toHaveTextContent("О");

    // Every day of the inclusive range 2–8 is marked, including the holiday.
    const markedDays = marked
      .map((node) => node.closest("td")?.querySelector(".dc-num")?.textContent)
      .sort((a, b) => Number(a) - Number(b));
    expect(markedDays).toEqual(["2", "3", "4", "5", "6", "7", "8"]);

    // No factual-hours badge was invented from the vacation itself.
    expect(container.querySelector(".dc-hours")).not.toBeInTheDocument();
    expect(container.querySelector(".dc-badge")).not.toBeInTheDocument();
    expect(container.querySelector(".dc-under-badge")).not.toBeInTheDocument();
  });
});
