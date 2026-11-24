export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiRequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: Record<string, string>;
  token?: string | null;
  skipAuth?: boolean;
  signal?: AbortSignal;
}

export interface FetchRequestContext {
  url: string;
  init: RequestInit;
  headers: Headers;
  options: ApiRequestOptions;
}

export type RequestInterceptor = (
  context: FetchRequestContext
) => FetchRequestContext | Promise<FetchRequestContext>;

export type ResponseInterceptor = (
  response: Response,
  context: FetchRequestContext
) => Response | Promise<Response>;

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') || '';

// In-memory JWT store (never persisted to localStorage or sessionStorage)
let memoryAuthToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

const customRequestInterceptors: RequestInterceptor[] = [];
const customResponseInterceptors: ResponseInterceptor[] = [];

export function setAuthToken(token: string | null): void {
  memoryAuthToken = token;
}

export function getAuthToken(): string | null {
  return memoryAuthToken;
}

export function clearAuthToken(): void {
  memoryAuthToken = null;
}

export function registerUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export function addRequestInterceptor(interceptor: RequestInterceptor): () => void {
  customRequestInterceptors.push(interceptor);
  return () => {
    const idx = customRequestInterceptors.indexOf(interceptor);
    if (idx >= 0) customRequestInterceptors.splice(idx, 1);
  };
}

export function addResponseInterceptor(interceptor: ResponseInterceptor): () => void {
  customResponseInterceptors.push(interceptor);
  return () => {
    const idx = customResponseInterceptors.indexOf(interceptor);
    if (idx >= 0) customResponseInterceptors.splice(idx, 1);
  };
}

function buildUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

async function runJwtRequestInterceptor(ctx: FetchRequestContext): Promise<FetchRequestContext> {
  if (!ctx.headers.has('Accept')) {
    ctx.headers.set('Accept', 'application/json');
  }

  const isFormData = typeof FormData !== 'undefined' && ctx.options.body instanceof FormData;
  if (ctx.options.body !== undefined && !isFormData && !ctx.headers.has('Content-Type')) {
    ctx.headers.set('Content-Type', 'application/json');
  }

  if (!ctx.options.skipAuth) {
    const activeToken = ctx.options.token !== undefined ? ctx.options.token : memoryAuthToken;
    if (activeToken && !ctx.headers.has('Authorization')) {
      ctx.headers.set('Authorization', `Bearer ${activeToken}`);
    }
  }

  let current = ctx;
  for (const interceptor of customRequestInterceptors) {
    current = await interceptor(current);
  }
  current.init.headers = current.headers;
  return current;
}

async function runJwtResponseInterceptor(
  response: Response,
  ctx: FetchRequestContext
): Promise<Response> {
  let currentResponse = response;
  for (const interceptor of customResponseInterceptors) {
    currentResponse = await interceptor(currentResponse, ctx);
  }

  const isAuthEndpoint =
    ctx.url.includes('/api/auth/login') ||
    ctx.url.includes('/api/auth/register') ||
    ctx.url.includes('/api/auth/claim-admin');

  if (currentResponse.status === 401 && !ctx.options.skipAuth && !isAuthEndpoint) {
    clearAuthToken();
    if (unauthorizedHandler) {
      unauthorizedHandler();
    }
  }

  return currentResponse;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const url = buildUrl(path);
  const headers = new Headers(options.headers);
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;

  const initialContext: FetchRequestContext = {
    url,
    headers,
    options,
    init: {
      method: options.method || 'GET',
      headers,
      signal: options.signal,
      body:
        options.body === undefined
          ? undefined
          : isFormData
          ? (options.body as FormData)
          : JSON.stringify(options.body),
    },
  };

  const prepared = await runJwtRequestInterceptor(initialContext);
  const rawResponse = await fetch(prepared.url, prepared.init);
  const response = await runJwtResponseInterceptor(rawResponse, prepared);

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => '');

  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data && typeof (data as { error?: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, data);
  }

  return data as T;
}

export const api = {
  request: apiRequest,
  get: <T>(path: string, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<ApiRequestOptions, 'method' | 'body'>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T>(path: string, options?: Omit<ApiRequestOptions, 'method'>) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
  setToken: setAuthToken,
  getToken: getAuthToken,
  clearToken: clearAuthToken,
};
