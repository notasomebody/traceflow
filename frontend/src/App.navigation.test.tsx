// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./desktopMonitor", () => ({
  getCapturePolicy: vi.fn().mockResolvedValue(null),
  getMonitorStatus: vi.fn().mockResolvedValue("DISABLED"),
  pauseMonitor: vi.fn(),
  setMonitorEnabled: vi.fn().mockResolvedValue("DISABLED"),
}));

beforeEach(() => {
  localStorage.setItem("traceflow.onboarding.completed", "true");
  localStorage.setItem("traceflow.report.generated.2026-08-13", "true");
  globalThis.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("/dashboard")
      ? { date: "2026-08-13", events: [], connectors: [], allocatedMinutes: 0, targetMinutes: 480 }
      : url.endsWith("/app-config.json") ? { supportEmail: "" } : [];
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
  });
});

describe("左侧导航", () => {
  it("从下方页面仍能返回今日工作", async () => {
    render(<App/>);
    fireEvent.click(screen.getByRole("button", { name: "历史记录" }));
    expect(await screen.findByRole("heading", { name: "历史日报" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入历史日报" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "企业微信" }));
    expect(screen.getByRole("heading", { name: "企业微信汇报" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "读取当前企业微信" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "今日工作" }));
    expect(screen.getByRole("heading", { name: "今天的工作，已经有迹可循" })).toBeInTheDocument();
  });
});
