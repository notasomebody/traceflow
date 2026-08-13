const wait = (milliseconds: number) => new Promise(resolve => globalThis.setTimeout(resolve, milliseconds));

export async function fetchLocal(input: RequestInfo | URL, init?: RequestInit, attempts = 10): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (response.status < 500 || attempt === attempts - 1) return response;
      lastError = new Error(`本地服务返回 ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
    }
    await wait(Math.min(250 * 2 ** attempt, 2000));
  }
  throw lastError instanceof Error ? lastError : new Error("无法连接本地服务");
}

export async function waitForLocalApi(apiBase: string): Promise<void> {
  const response = await fetchLocal(`${apiBase.replace(/\/api\/?$/, "")}/actuator/health`);
  if (!response.ok) throw new Error("本地服务尚未就绪");
}
