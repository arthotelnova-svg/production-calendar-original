import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardClient from "../app/dashboard/client";

vi.mock("next-auth/react", () => ({ signOut: vi.fn() }));
vi.mock("next/image", () => ({
  default: ({ priority: _priority, ...props }) => <img {...props} />,
}));

const settings = {
  oklad: 135000,
  ot_rate: 164,
  ot_weekday: 2,
  ot_saturday: 8,
  auto_ot_rate: 0,
};
let overtimeData = {};
let noteSummaryData = {};

function jsonResponse(data) {
  return { ok: true, json: async () => data };
}

function dataFor(url) {
  if (url === "/api/settings") return settings;
  if (url === "/api/work-hours?year=2026") return overtimeData;
  if (url === "/api/absences?year=2026") return {};
  if (url === "/api/day-notes?year=2026") return noteSummaryData;
  return { ok: true };
}

describe("production dashboard baseline", () => {
  let fetchMock;

  beforeEach(() => {
    // Keep calendar fixtures deterministic: Sep 1 and Sep 16 are 8-hour workdays.
    // Fake Date only; async UI timers remain real.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
    settings.auto_ot_rate = 0;
    settings.oklad = 135000;
    settings.ot_rate = 164;
    overtimeData = {};
    noteSummaryData = {};
    fetchMock = vi.fn(async (url, options = {}) => {
      if (!options.method || options.method === "GET") {
        return jsonResponse(dataFor(url));
      }
      return jsonResponse({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the accepted calculator-first surface and 12-month navigation", async () => {
    const { container } = render(<DashboardClient user={{ name: "Тестовый пользователь" }} />);

    expect(await screen.findByText("Календарь трудочасов")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "КОМПЬЮТРОЛС" })).toHaveAttribute("src", "/assets/computrols-logo-muted.svg");
    expect(container.querySelector(".hdr .badge")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Калькулятор" })).toHaveClass("tb-a");
    expect(screen.getByRole("button", { name: "Годовой обзор" })).toBeInTheDocument();
    expect(screen.getByText("Настройки")).toBeInTheDocument();
    expect(screen.getByText("Оклад / месяц")).toBeInTheDocument();
    expect(screen.queryByText("Будни перераб.")).not.toBeInTheDocument();
    expect(screen.queryByText("Суббота перераб.")).not.toBeInTheDocument();
    expect(screen.getByText("Аванс", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Перерасчёт", { exact: false })).toBeInTheDocument();
    expect(container.querySelectorAll(".mstrip .mm")).toHaveLength(12);
    expect(container.querySelector(".cal-tbl")).toBeInTheDocument();
  });

  it("places calendar, payment calculation, month selector, and settings in the requested order", async () => {
    const { container } = render(<DashboardClient user={{ name: "Тестовый пользователь" }} />);
    await screen.findByText("Календарь трудочасов");

    const calendar = container.querySelector(".month-view");
    const payments = container.querySelector(".summary");
    const months = container.querySelector(".mstrip");
    const settingsPanel = container.querySelector(".settings");
    const follows = (before, after) => Boolean(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING);

    expect(follows(calendar, payments)).toBe(true);
    expect(follows(payments, months)).toBe(true);
    expect(follows(months, settingsPanel)).toBe(true);
  });

  it("omits the calendar fill/export toolbar and day-type legend", async () => {
    render(<DashboardClient user={{ name: "Тестовый пользователь" }} />);
    await screen.findByText("Календарь трудочасов");

    expect(screen.queryByRole("button", { name: /^Заполнить/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Excel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "JPEG" })).not.toBeInTheDocument();
    const previousMonth = screen.getByRole("button", { name: /^←/ });
    const nextMonth = screen.getByRole("button", { name: /→$/ });
    expect(previousMonth).toBeInTheDocument();
    expect(nextMonth).toBeInTheDocument();
    const monthTitle = document.querySelector(".mv-title");
    const initialMonth = monthTitle.textContent;
    fireEvent.click(nextMonth.disabled ? previousMonth : nextMonth);
    expect(monthTitle.textContent).not.toBe(initialMonth);
    for (const label of ["Рабочий", "Выходной", "Праздник", "Сокращённый*", "Переработка", "Не работал"]) {
      expect(screen.queryByText(label, { exact: true })).not.toBeInTheDocument();
    }
  });

  it("keeps the current day editor and persists overtime through the existing API contract", async () => {
    const { container } = render(<DashboardClient user={{ name: "Тестовый пользователь" }} />);
    await screen.findByText("Календарь трудочасов");

    const editableDay = container.querySelector(".cal-tbl tbody .dc-wd, .cal-tbl tbody .dc-pre");
    expect(editableDay).toBeInTheDocument();
    const dayNumber = Number(editableDay.querySelector(".dc-num").textContent);
    fireEvent.click(editableDay);

    const input = await waitFor(() => container.querySelector(".eb-input"));
    expect(input).toBeInTheDocument();
    expect(screen.getByLabelText("Фактически отработано")).toHaveDisplayValue("");
    expect(screen.getByText("Норма: 8 ч")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сбросить к норме" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Добавить" })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      const saved = fetchMock.mock.calls.some(([url, options]) => {
        if (url !== "/api/work-hours" || options?.method !== "POST") return false;
        const body = JSON.parse(options.body);
        return body.day === dayNumber && body.hours === 10;
      });
      expect(saved).toBe(true);
    });
  });

  it("renders a compact visible marker on a day that has a note", async () => {
    noteSummaryData = { [`${new Date().getMonth()}-1`]: { hasNote: true } };
    const { container } = render(<DashboardClient user={{ name: "Тестовый пользователь" }} />);
    await screen.findByText("Календарь трудочасов");

    const marker = container.querySelector(".dc-note svg");
    expect(marker).toBeInTheDocument();
    expect(marker).toHaveAttribute("width", "13");
    expect(marker).toHaveAttribute("height", "13");
  });

  it("opens the day-note editor from the notebook button in the daily editor", async () => {
    const { container } = render(<DashboardClient user={{ name: "Тестовый пользователь" }} />);
    await screen.findByText("Календарь трудочасов");

    fireEvent.click(container.querySelector(".cal-tbl tbody .dc-wd, .cal-tbl tbody .dc-pre"));
    const notebook = await screen.findByRole("button", { name: "Заметка дня" });
    fireEvent.click(notebook);

    expect(await screen.findByRole("dialog", { name: "Заметка дня" })).toBeInTheDocument();
    expect(screen.getByLabelText("Текст заметки")).toBeInTheDocument();
    expect(screen.getByLabelText("Прикрепить файл")).toHaveAttribute("type", "file");
    expect(screen.getByRole("button", { name: "Удалить заметку" })).toBeInTheDocument();
  });

  it("asks for confirmation that deleting a note will also remove its attachments", async () => {
    const { container } = render(<DashboardClient user={{ name: "Тестовый пользователь" }} />);
    await screen.findByText("Календарь трудочасов");
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(false);

    fireEvent.click(container.querySelector(".cal-tbl tbody .dc-wd, .cal-tbl tbody .dc-pre"));
    fireEvent.click(await screen.findByRole("button", { name: "Заметка дня" }));
    fireEvent.click(await screen.findByRole("button", { name: "Удалить заметку" }));

    expect(confirmMock).toHaveBeenCalledWith("Удалить заметку и все прикреплённые файлы? Восстановить их будет невозможно.");
    expect(fetchMock.mock.calls.some(([url, options]) => url.includes("/api/day-notes?") && options?.method === "DELETE")).toBe(false);
    confirmMock.mockRestore();
  });

  it("persists a negative daily delta and marks it as underwork", async () => {
    const { container } = render(<DashboardClient user={{ name: "Тестовый пользователь" }} />);
    await screen.findByText("Календарь трудочасов");

    const editableDay = container.querySelector(".cal-tbl tbody .dc-wd, .cal-tbl tbody .dc-pre");
    fireEvent.click(editableDay);
    const input = await waitFor(() => container.querySelector(".eb-input"));
    expect(input).toHaveAttribute("min", "0");
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      const saved = fetchMock.mock.calls.some(([url, options]) => {
        if (url !== "/api/work-hours" || options?.method !== "POST") return false;
        const body = JSON.parse(options.body);
        return body.hours === 5;
      });
      expect(saved).toBe(true);
    });
    expect(container.querySelector(".dc-under")).toBeInTheDocument();
    expect(container.querySelector(".dc-under-badge")).toHaveTextContent("−3ч");
  });

  it("does not offset an underwork in the second half against overtime in the first half", async () => {
    const month = new Date().getMonth();
    overtimeData = { [`${month}-1`]: 10, [`${month}-16`]: 5 };
    render(<DashboardClient user={{ name: "Тестовый пользователь" }} />);

    expect(await screen.findByText("Недоработка: 3 ч")).toBeInTheDocument();
    expect(screen.getByText(/Переработка: 2 ч × 164 ₽/)).toBeInTheDocument();
  });

  it("calculates the overtime rate from annual salary when automatic mode is enabled", async () => {
    settings.auto_ot_rate = 1;
    overtimeData = { [`${new Date().getMonth()}-1`]: 10 };
    const { container } = render(<DashboardClient user={{ name: "Тестовый пользователь" }} />);

    const automatic = await screen.findByRole("checkbox", { name: "Рассчитывать ставку автоматически" });
    const rateInput = screen.getByLabelText("Ставка переработки");
    expect(automatic).toBeChecked();
    expect(rateInput).toBeDisabled();
    expect(rateInput).toHaveValue(821.5);
    expect(screen.getByText(/Переработка: 2 ч × 821,5 ₽/)).toBeInTheDocument();
    const overtimeLine = [...container.querySelectorAll(".sb-line")].find((line) => line.textContent.includes("Переработка:"));
    expect(overtimeLine.querySelector(".sb-val").textContent.replace(/\s/g, " ")).toBe("1 643 ₽");

    fireEvent.change(screen.getByLabelText("Оклад / месяц"), { target: { value: "90000" } });
    expect(rateInput).toHaveValue(547.67);
    expect(container.querySelector(".settings").lastElementChild).toContainElement(automatic);
  });

  it("preserves the manual overtime rate while persisting automatic mode", async () => {
    render(<DashboardClient user={{ name: "Тестовый пользователь" }} />);

    const automatic = await screen.findByRole("checkbox", { name: "Рассчитывать ставку автоматически" });
    const rateInput = screen.getByLabelText("Ставка переработки");
    fireEvent.change(rateInput, { target: { value: "250" } });
    fireEvent.click(automatic);

    expect(rateInput).toBeDisabled();
    expect(rateInput).toHaveValue(821.5);
    await waitFor(() => {
      const saved = fetchMock.mock.calls.some(([url, options]) => {
        if (url !== "/api/settings" || options?.method !== "POST") return false;
        const body = JSON.parse(options.body);
        return body.ot_rate === 250 && body.auto_ot_rate === true;
      });
      expect(saved).toBe(true);
    }, { timeout: 2000 });

    fireEvent.click(automatic);
    expect(rateInput).not.toBeDisabled();
    expect(rateInput).toHaveValue(250);
  });

  it("serializes settings saves so an older request cannot finish after a newer one", async () => {
    render(<DashboardClient user={{ name: "Тестовый пользователь" }} />);
    await screen.findByRole("checkbox", { name: "Рассчитывать ставку автоматически" });

    const pending = [];
    fetchMock.mockImplementation((url, options = {}) => {
      if (!options.method || options.method === "GET") return Promise.resolve(jsonResponse(dataFor(url)));
      return new Promise((resolve) => pending.push(resolve));
    });
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText("Оклад / месяц"), { target: { value: "140000" } });
    await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Оклад / месяц"), { target: { value: "150000" } });
    await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);

    pending.shift()(jsonResponse({ ok: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(2);
    pending.shift()(jsonResponse({ ok: true }));
  });

  it("keeps the annual overview reachable as the secondary tab", async () => {
    render(<DashboardClient user={{ name: "Тестовый пользователь" }} />);
    await screen.findByText("Календарь трудочасов");

    fireEvent.click(screen.getByRole("button", { name: "Годовой обзор" }));

    expect(screen.getByRole("button", { name: "Годовой обзор" })).toHaveClass("tb-a");
    expect(screen.getByRole("columnheader", { name: "Месяц" })).toBeInTheDocument();
    expect(screen.getByText("2026 год")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Экспорт Excel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Экспорт JPEG" })).toBeInTheDocument();
  });
});
