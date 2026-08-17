export type AiMode = "EXPORT" | "LOCAL" | "API";
export type AiProvider = "OPENAI" | "COMPATIBLE" | "OLLAMA" | "CODEX";

export type AppSettings = {
  displayName: string;
  targetMinutes: number;
  generateAt: string;
  submitAfter: string;
  aiMode: AiMode;
  metadataOnly: boolean;
  localStatistics: boolean;
  minimizeToTray: boolean;
  monitoringEnabled: boolean;
  aiProvider: AiProvider;
  aiModel: string;
  aiBaseUrl: string;
  aiProxyUrl: string;
  fileContentAuthorized: boolean;
  wecomPassiveCapture: boolean;
  wecomIdleSync: boolean;
  wecomHistoryDays: number;
};

export const DEFAULT_SETTINGS: AppSettings = {
  displayName: "",
  targetMinutes: 480,
  generateAt: "17:50",
  submitAfter: "18:00",
  aiMode: "EXPORT",
  metadataOnly: true,
  localStatistics: true,
  minimizeToTray: true,
  monitoringEnabled: false,
  aiProvider: "OPENAI",
  aiModel: "gpt-5-mini",
  aiBaseUrl: "",
  aiProxyUrl: "",
  fileContentAuthorized: false,
  wecomPassiveCapture: true,
  wecomIdleSync: true,
  wecomHistoryDays: 90,
};

const SETTINGS_KEY = "traceflow.settings.v1";
const ONBOARDING_KEY = "traceflow.onboarding.completed";

export function loadSettings(): AppSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    if (saved.aiModel === "gpt-5.4-mini") saved.aiModel = "gpt-5-mini";
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function onboardingCompleted() {
  return localStorage.getItem(ONBOARDING_KEY) === "true";
}

export function markOnboardingCompleted() {
  localStorage.setItem(ONBOARDING_KEY, "true");
}

export function resetOnboarding() {
  localStorage.removeItem(ONBOARDING_KEY);
}

type SharedSettings = Omit<AppSettings, "displayName">;
type ShareEnvelope = { kind: "traceflow-config"; version: 1; settings: SharedSettings };

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
};
const fromBase64Url = (value: string) => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
const asArrayBuffer = (bytes: Uint8Array) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
const hash = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", asArrayBuffer(bytes)));

function shareEnvelope(settings: AppSettings): ShareEnvelope {
  const { displayName: _personalField, ...shareable } = settings;
  return { kind: "traceflow-config", version: 1, settings: shareable };
}

export async function exportShareCode(settings: AppSettings, password = "") {
  const content = encoder.encode(JSON.stringify(shareEnvelope(settings)));
  if (!password) {
    const checksum = (await hash(content)).slice(0, 8);
    return `TF1.${toBase64Url(content)}.${toBase64Url(checksum)}`;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: asArrayBuffer(salt), iterations: 180_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: asArrayBuffer(iv) }, key, asArrayBuffer(content)));
  return `TF1E.${toBase64Url(salt)}.${toBase64Url(iv)}.${toBase64Url(cipher)}`;
}

export async function importShareCode(code: string, password = ""): Promise<SharedSettings> {
  const parts = code.trim().split(".");
  let content: Uint8Array;
  if (parts[0] === "TF1" && parts.length === 3) {
    content = fromBase64Url(parts[1]);
    const expected = toBase64Url((await hash(content)).slice(0, 8));
    if (expected !== parts[2]) throw new Error("分享码校验失败，内容可能不完整或已被修改");
  } else if (parts[0] === "TF1E" && parts.length === 4) {
    if (!password) throw new Error("这是加密分享码，请输入分享密码");
    const salt = fromBase64Url(parts[1]);
    const iv = fromBase64Url(parts[2]);
    const cipher = fromBase64Url(parts[3]);
    const baseKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: asArrayBuffer(salt), iterations: 180_000, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    try {
      content = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: asArrayBuffer(iv) }, key, asArrayBuffer(cipher)));
    } catch {
      throw new Error("分享密码错误，或分享码已经损坏");
    }
  } else {
    throw new Error("无法识别该分享码，请确认复制完整");
  }
  const envelope = JSON.parse(decoder.decode(content)) as ShareEnvelope;
  if (envelope.kind !== "traceflow-config" || envelope.version !== 1) throw new Error("配置版本不受支持");
  return envelope.settings;
}
