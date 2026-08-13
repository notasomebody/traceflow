const wait = (milliseconds: number) => new Promise(resolve => globalThis.setTimeout(resolve, milliseconds));

export async function fetchLocal(input: RequestInfo | URL, init?: RequestInit, attempts = 10): Promise<Response> {
  let lastError: unknown;
  const deadline = Date.now() + 15_000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), Math.min(3_000, remaining));
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (response.status < 500 || attempt === attempts - 1) return response;
      lastError = new Error(`本地服务返回 ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
    } finally {
      globalThis.clearTimeout(timeout);
    }
    await wait(Math.min(250 * 2 ** attempt, 2_000, Math.max(0, deadline - Date.now())));
  }
  throw lastError instanceof Error ? lastError : new Error("连接本地服务超时");
}

export async function waitForLocalApi(apiBase: string): Promise<void> {
  const response = await fetchLocal(`${apiBase.replace(/\/$/, "")}/projects`);
  if (!response.ok) throw new Error("本地服务尚未就绪");
}
