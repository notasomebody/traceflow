// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
afterEach(cleanup);

describe("左侧导航", () => {
  it("只展示四个核心入口且可以往返切换", async () => {
    render(<App/>);
    expect(screen.getByRole("button", { name: "今日" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "工作记录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "汇报中心" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "项目" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Jira 工时" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "企业微信" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "工作记录" }));
    expect(await screen.findByRole("heading", { name: "工作记录" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "汇报中心" }));
    expect(await screen.findByRole("heading", { name: "汇报中心" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导入历史日报" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "从企业微信导入" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "项目" }));
    expect(await screen.findByRole("heading", { name: "项目" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "今日" }));
    expect(screen.getByRole("heading", { name: "今天的工作，已经有迹可循" })).toBeInTheDocument();
  });

  it("主题按钮可在深浅色之间切换", () => {
    render(<App/>);
    const toggle = screen.getByRole("button", { name: "切换到浅色模式" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "切换到深色模式" })).toBeInTheDocument();
  });

  it("设置采用四个简单入口且关闭后导航仍可用", async () => {
    render(<App/>);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("button", { name: /工作习惯/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /自动整理/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /连接服务/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /数据与安全/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /连接服务/ }));
    expect(screen.getByRole("button", { name: "读取当前企业微信" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭设置" }));
    fireEvent.click(screen.getByRole("button", { name: "项目" }));
    expect(await screen.findByRole("heading", { name: "项目" })).toBeInTheDocument();
  });
});
