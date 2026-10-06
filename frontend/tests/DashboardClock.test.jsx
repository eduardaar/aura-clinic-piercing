import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PremiumDashboard } from "../src/features/dashboard/Dashboard";

afterEach(() => vi.useRealTimers());
it("contagem acompanha o relógio sem depender do fuso do navegador", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T15:00:00Z"));
  const { unmount } = render(<PremiumDashboard data={{ stats: {}, adminDashboard: { nextAppointment: {
    id: 1, full_name: "Cliente próximo", appointment_date: "2026-10-06", appointment_time: "13:30:00",
    starts_at: "2026-10-06T16:30:00Z", countdown: "Texto antigo", status: "confirmado"
  } } }} user={{ role: "admin", name: "Admin" }} setPage={() => {}} setPeriod={() => {}} setAlertsOpen={() => {}} />);
  expect(screen.getByText("Em 1h30")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(60000));
  expect(screen.getByText("Em 1h29")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(90 * 60000));
  expect(screen.getByText("Atualizando agenda…")).toBeInTheDocument();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
