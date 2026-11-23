import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VacationPanel, { sumVacationPayByHalf } from "../app/dashboard/vacation-panel";

const YEAR = 2026;

function jsonResponse(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}

function vacation(overrides = {}) {
  return {
    id: 1,
    startDate: "2026-11-02",
    endDate: "2026-11-08",
    year: YEAR,
    amountKopecks: 2606800,
    paid: false,
    paidDate: null,
    ...overrides,
  };
}

describe("vacation panel form", () => {
  let fetchMock;
  let onRefresh;

  beforeEach(() => {
    onRefresh = vi.fn();
    fetchMock = vi.fn(async () => jsonResponse({ vacation: vacation() }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts collapsed and prefills no personal data", () => {
    render(<VacationPanel year={YEAR} month={10} vacations={[]} onRefresh={onRefresh} />);

    expect(screen.getByText("Отпускные")).toBeInTheDocument();
    expect(screen.queryByLabelText("Начало отпуска")).not.toBeInTheDocument();
    expect(screen.getByText("Отпуска за 2026 год не добавлены.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Добавить отпуск" }));

    expect(screen.getByLabelText("Начало отпуска")).toHaveValue("");
    expect(screen.getByLabelText("Окончание отпуска")).toHaveValue("");
    expect(screen.getByLabelText("Сумма отпускных, ₽")).toHaveValue("");
    expect(screen.getByLabelText("Отпускные выплачены")).not.toBeChecked();
    expect(screen.getByLabelText("Дата выплаты")).toHaveValue("");
    expect(screen.getByLabelText("Дата выплаты")).toBeDisabled();
  });

  it("posts the entered range as an inclusive ISO range with integer kopecks", async () => {
    render(<VacationPanel year={YEAR} month={10} vacations={[]} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить отпуск" }));

    fireEvent.change(screen.getByLabelText("Начало отпуска"), { target: { value: "2026-11-02" } });
    fireEvent.change(screen.getByLabelText("Окончание отпуска"), { target: { value: "2026-11-08" } });
    fireEvent.change(screen.getByLabelText("Сумма отпускных, ₽"), { target: { value: "26068" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить отпуск" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/vacations");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      startDate: "2026-11-02",
      endDate: "2026-11-08",
      amountKopecks: 2606800,
      paid: false,
      paidDate: null,
    });
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("sends the payment date only for a paid vacation and omits it as null otherwise", async () => {
    render(<VacationPanel year={YEAR} month={10} vacations={[]} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить отпуск" }));

    fireEvent.change(screen.getByLabelText("Начало отпуска"), { target: { value: "2026-11-02" } });
    fireEvent.change(screen.getByLabelText("Окончание отпуска"), { target: { value: "2026-11-08" } });
    fireEvent.change(screen.getByLabelText("Сумма отпускных, ₽"), { target: { value: "26068,50" } });
    fireEvent.click(screen.getByLabelText("Отпускные выплачены"));

    expect(screen.getByLabelText("Дата выплаты")).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText("Дата выплаты"), { target: { value: "2026-10-30" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить отпуск" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      startDate: "2026-11-02",
      endDate: "2026-11-08",
      amountKopecks: 2606850,
      paid: true,
      paidDate: "2026-10-30",
    });
  });

  it("keeps the typed values and shows the russian server warning on a 409 conflict", async () => {
    const warning = "Отпуск не сохранён: в период отпуска уже отмечены часы работы (2026-11-05).";
    fetchMock.mockImplementation(async () => jsonResponse({ error: warning }, { ok: false, status: 409 }));

    render(<VacationPanel year={YEAR} month={10} vacations={[]} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить отпуск" }));
    fireEvent.change(screen.getByLabelText("Начало отпуска"), { target: { value: "2026-11-02" } });
    fireEvent.change(screen.getByLabelText("Окончание отпуска"), { target: { value: "2026-11-08" } });
    fireEvent.change(screen.getByLabelText("Сумма отпускных, ₽"), { target: { value: "26068" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить отпуск" }));

    expect(await screen.findByText(warning)).toBeInTheDocument();
    expect(screen.getByLabelText("Начало отпуска")).toHaveValue("2026-11-02");
    expect(screen.getByLabelText("Окончание отпуска")).toHaveValue("2026-11-08");
    expect(screen.getByLabelText("Сумма отпускных, ₽")).toHaveValue("26068");
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("rejects an unparsable amount locally without calling the API", async () => {
    render(<VacationPanel year={YEAR} month={10} vacations={[]} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить отпуск" }));
    fireEvent.change(screen.getByLabelText("Начало отпуска"), { target: { value: "2026-11-02" } });
    fireEvent.change(screen.getByLabelText("Окончание отпуска"), { target: { value: "2026-11-08" } });
    fireEvent.change(screen.getByLabelText("Сумма отпускных, ₽"), { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить отпуск" }));

    expect(await screen.findByText(/Укажите сумму отпускных/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists saved vacations with inclusive dates, net amount and payment status", () => {
    render(
      <VacationPanel
        year={YEAR}
        month={10}
        vacations={[vacation(), vacation({ id: 2, startDate: "2026-03-10", endDate: "2026-03-12", amountKopecks: 100050, paid: true, paidDate: "2026-03-05" })]}
        onRefresh={onRefresh}
      />
    );

    const rows = document.querySelectorAll(".vacation-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent.replace(/\s/g, " ")).toContain("02.11.2026 — 08.11.2026");
    expect(rows[0]).toHaveTextContent("26 068 ₽");
    expect(rows[0]).toHaveTextContent("не выплачено");
    expect(rows[1]).toHaveTextContent("1 000,50 ₽");
    expect(rows[1]).toHaveTextContent("выплачено 05.03.2026");
    expect(screen.getByText("прогноз на руки")).toBeInTheDocument();
  });

  it("expands an existing vacation through a compact row and can collapse the form again", () => {
    render(<VacationPanel year={YEAR} month={10} vacations={[]} onRefresh={onRefresh} />);
    const toggle = screen.getByRole("button", { name: "Добавить отпуск" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Начало отпуска")).not.toBeInTheDocument();
  });
});

describe("vacation pay allocation adapter", () => {
  it("puts the whole net amount into the half that holds the paid vacation days", () => {
    const summary = sumVacationPayByHalf({ year: YEAR, month: 10, vacations: [vacation()] });

    expect(summary.count).toBe(1);
    expect(summary.totalKopecks).toBe(2606800);
    expect(summary.paidKopecks).toBe(0);
    expect(summary.outstandingKopecks).toBe(2606800);
    expect(summary.halves).toEqual([
      { half: 1, fromDay: 1, toDay: 15, paidDays: 6, kopecks: 2606800, paidKopecks: 0 },
      { half: 2, fromDay: 16, toDay: 30, paidDays: 0, kopecks: 0, paidKopecks: 0 },
    ]);
  });

  it("splits a vacation that crosses the 15th by paid days and keeps the kopecks exact", () => {
    const summary = sumVacationPayByHalf({
      year: YEAR,
      month: 10,
      vacations: [vacation({ startDate: "2026-11-12", endDate: "2026-11-18", amountKopecks: 100001 })],
    });

    expect(summary.halves.map((half) => [half.half, half.paidDays])).toEqual([[1, 4], [2, 3]]);
    expect(summary.halves[0].kopecks).toBe(57143);
    expect(summary.halves[1].kopecks).toBe(42858);
    expect(summary.halves[0].kopecks + summary.halves[1].kopecks).toBe(100001);
  });

  it("ignores vacations of other months and counts paid status independently", () => {
    const summary = sumVacationPayByHalf({
      year: YEAR,
      month: 2,
      vacations: [
        vacation({ startDate: "2026-03-10", endDate: "2026-03-12", amountKopecks: 50000, paid: true }),
        vacation({ startDate: "2026-11-02", endDate: "2026-11-08", amountKopecks: 2606800 }),
      ],
    });

    expect(summary.count).toBe(1);
    expect(summary.totalKopecks).toBe(50000);
    expect(summary.paidKopecks).toBe(50000);
    expect(summary.halves[0].kopecks).toBe(50000);
  });

  it("returns empty halves for a month without vacations", () => {
    const summary = sumVacationPayByHalf({ year: YEAR, month: 5, vacations: [] });

    expect(summary.count).toBe(0);
    expect(summary.totalKopecks).toBe(0);
    expect(summary.halves).toEqual([
      { half: 1, fromDay: 1, toDay: 15, paidDays: 0, kopecks: 0, paidKopecks: 0 },
      { half: 2, fromDay: 16, toDay: 30, paidDays: 0, kopecks: 0, paidKopecks: 0 },
    ]);
  });
});
