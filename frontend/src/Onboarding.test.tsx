// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Onboarding from "./Onboarding";
import { DEFAULT_SETTINGS } from "./settings";

afterEach(cleanup);

describe("首次使用引导", () => {
  it("在一个页面完成必要授权并开始自动整理", () => {
    const complete = vi.fn();
    render(<Onboarding initial={DEFAULT_SETTINGS} onComplete={complete} onSkip={vi.fn()}/>);

    expect(screen.getByRole("heading", { name: "让迹汇自动整理今天的工作" })).toBeInTheDocument();
    expect(screen.queryByText("下一步")).not.toBeInTheDocument();
    expect(screen.queryByText("上一步")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "允许读取今天实际修改的工作文件正文" }));
    fireEvent.click(screen.getByRole("button", { name: "开始自动整理" }));

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      monitoringEnabled: true,
      metadataOnly: false,
      fileContentAuthorized: true,
      wecomPassiveCapture: true,
      wecomHistoryDays: 90,
    }));
  });
});
