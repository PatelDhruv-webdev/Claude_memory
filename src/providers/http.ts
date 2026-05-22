/**
 * Thin fetch wrapper with timeout. node 22 has global fetch.
 * We deliberately don't use a fetch library so deps stay slim.
 */
export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  body: string;
  headers: Headers;
}

function buildInit(req: HttpRequest, signal: AbortSignal): RequestInit {
  const init: RequestInit = {
    method: req.method ?? "GET",
    headers: req.headers,
    signal,
  };
  if (req.body !== undefined) {
    // fetch's BodyInit accepts string and Uint8Array at runtime; the lib types
    // narrow it down depending on which lib is loaded. We assert here once.
    (init as { body: unknown }).body = req.body;
  }
  return init;
}

export async function http(req: HttpRequest): Promise<HttpResponse> {
  const ctrl = new AbortController();
  const timer = req.timeoutMs
    ? setTimeout(() => ctrl.abort(new Error(`timeout after ${req.timeoutMs}ms`)), req.timeoutMs)
    : null;
  if (req.signal) {
    req.signal.addEventListener("abort", () => ctrl.abort(req.signal!.reason), { once: true });
  }

  try {
    const res = await fetch(req.url, buildInit(req, ctrl.signal));
    const body = await res.text();
    return { status: res.status, ok: res.ok, body, headers: res.headers };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function httpStream(req: HttpRequest): Promise<Response> {
  const ctrl = new AbortController();
  const timer = req.timeoutMs
    ? setTimeout(() => ctrl.abort(new Error(`timeout after ${req.timeoutMs}ms`)), req.timeoutMs)
    : null;
  if (req.signal) {
    req.signal.addEventListener("abort", () => ctrl.abort(req.signal!.reason), { once: true });
  }
  try {
    const res = await fetch(req.url, buildInit(req, ctrl.signal));
    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
