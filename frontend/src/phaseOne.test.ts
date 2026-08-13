import { beforeEach, describe, expect, it } from "vitest";
import { buildAiPrompt, buildReportText } from "./reportExport";
import { DEFAULT_SETTINGS, exportShareCode, importShareCode, loadSettings, markOnboardingCompleted, onboardingCompleted, resetOnboarding, saveSettings } from "./settings";
import { clearUsageStats, loadUsageStats, recordUsage } from "./usageStats";
import { localDateKey, shouldGenerateDaily } from "./reportScheduler";
import { fetchLocal, waitForLocalApi } from "./localApi";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() } });
beforeEach(() => values.clear());

describe("一期配置", () => {
  it("保存工作偏好并恢复默认值", () => {
    saveSettings({ ...DEFAULT_SETTINGS, targetMinutes: 450 });
    expect(loadSettings().targetMinutes).toBe(450);
    expect(loadSettings().generateAt).toBe("17:50");
  });
  it("记录和重置首次引导状态", () => {
    expect(onboardingCompleted()).toBe(false);
    markOnboardingCompleted();
    expect(onboardingCompleted()).toBe(true);
    resetOnboarding();
    expect(onboardingCompleted()).toBe(false);
  });
  it("普通分享码可校验且排除姓名", async () => {
    const code = await exportShareCode({ ...DEFAULT_SETTINGS, displayName: "不应分享" });
    const imported = await importShareCode(code);
    expect(code.startsWith("TF1.")).toBe(true);
    expect(imported).not.toHaveProperty("displayName");
    expect(imported.targetMinutes).toBe(480);
  });
  it("加密分享码仅能用正确密码解密", async () => {
    const code = await exportShareCode(DEFAULT_SETTINGS, "正确密码");
    await expect(importShareCode(code, "错误密码")).rejects.toThrow("分享密码错误");
    await expect(importShareCode(code, "正确密码")).resolves.toMatchObject({ aiMode: "EXPORT" });
  });
  it("被篡改的普通分享码无法导入", async () => {
    const code = await exportShareCode(DEFAULT_SETTINGS);
    await expect(importShareCode(`${code.slice(0, -1)}x`)).rejects.toThrow("校验失败");
  });
});

describe("日报自动生成调度", () => {
  it("工作日到点或错过时间后补生成，但每天只生成一次", () => {
    expect(shouldGenerateDaily(new Date(2026, 7, 12, 17, 49), "17:50", false)).toBe(false);
    expect(shouldGenerateDaily(new Date(2026, 7, 12, 17, 50), "17:50", false)).toBe(true);
    expect(shouldGenerateDaily(new Date(2026, 7, 12, 20, 0), "17:50", false)).toBe(true);
    expect(shouldGenerateDaily(new Date(2026, 7, 12, 20, 0), "17:50", true)).toBe(false);
    expect(shouldGenerateDaily(new Date(2026, 7, 15, 20, 0), "17:50", false)).toBe(false);
    expect(shouldGenerateDaily(new Date(2026, 9, 1, 20, 0), "17:50", false, ["2026-10-01"])).toBe(false);
    expect(shouldGenerateDaily(new Date(2026, 9, 10, 20, 0), "17:50", false, [], ["2026-10-10"])).toBe(true);
  });
  it("日期键使用本地日期而不是 UTC 日期", () => {
    expect(localDateKey(new Date(2026, 7, 12, 0, 30))).toBe("2026-08-12");
  });
});

describe("本地后端启动窗口", () => {
  it("首次连接失败后自动重试", async () => {
    let calls = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls < 3) throw new TypeError("connection refused");
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    await expect(fetchLocal("http://127.0.0.1/test", undefined, 3)).resolves.toMatchObject({ status: 200 });
    expect(calls).toBe(3);
    globalThis.fetch = originalFetch;
  });
  it("写操作前等待健康接口", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("http://127.0.0.1:17890/actuator/health");
      return new Response('{"status":"UP"}', { status: 200 });
    }) as typeof fetch;
    await expect(waitForLocalApi("http://127.0.0.1:17890/api")).resolves.toBeUndefined();
    globalThis.fetch = originalFetch;
  });
});

describe("日报复制与 Codex 导出", () => {
  const report = { date: "2026-08-10", summary: "【项目A】完成接口联调。", nextPlan: "继续验证异常流程。", targetMinutes: 480 };
  it("生成企业微信可粘贴的日报文本", () => {
    const text = buildReportText(report);
    expect(text).toContain("今日工作总结\n【项目A】完成接口联调。");
    expect(text).toContain("工时：8 小时");
  });
  it("Codex 提示词明确禁止虚构", () => {
    const prompt = buildAiPrompt(report);
    expect(prompt).toContain("不虚构工作内容");
    expect(prompt).toContain("不要增加原文没有的成果");
    expect(prompt).toContain("2026-08-10");
  });
});

describe("仅本机使用统计", () => {
  it("统计开启时递增，关闭时不记录，并可清空", () => {
    recordUsage("generate", true);
    recordUsage("generate", false);
    recordUsage("copy", true);
    expect(loadUsageStats()).toMatchObject({ generate: 1, copy: 1 });
    clearUsageStats();
    expect(loadUsageStats()).toMatchObject({ generate: 0, copy: 0 });
  });
});
