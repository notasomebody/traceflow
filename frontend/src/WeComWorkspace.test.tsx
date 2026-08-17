// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WeComWorkspace from "./WeComWorkspace";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

afterEach(() => { cleanup(); invoke.mockReset(); });

describe("企业微信历史自动读取", () => {
  it("用一个主按钮启动 90 天只读补齐并展示暂停状态", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    invoke.mockImplementation((command: string) => {
      if (command === "ai_secret_status") return Promise.resolve(false);
      if (command === "wecom_history_status") return Promise.resolve({ stage:"PAUSED_FOR_USER", visitedRows:8, importedReports:3, message:"检测到你正在操作，已暂停" });
      if (command === "start_wecom_history_sync") return Promise.resolve({ stage:"WAITING_FOR_WE_COM", visitedRows:0, importedReports:0, message:"请切换到企业微信汇报列表" });
      return Promise.resolve();
    });
    render(<WeComWorkspace api="http://127.0.0.1:17890/api"/>);
    fireEvent.click(screen.getByRole("button", { name: "自动补齐最近 90 天汇报" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("start_wecom_history_sync", { historyDays:90 }));
    expect(await screen.findByText(/检测到你正在操作，已暂停/)).toBeInTheDocument();
  });
});
