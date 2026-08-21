// Web API types used by adapters and HTTP utilities.
// Declared here because tsconfig has "types": [] (no global @types packages).
// These are available in all modern JS runtimes (Node 18+, Deno, Bun, CF Workers, browsers).

declare class URL {
  constructor(url: string, base?: string)
  readonly pathname: string
  readonly searchParams: URLSearchParams
  readonly href: string
  readonly origin: string
  readonly host: string
  readonly hostname: string
  readonly port: string
  readonly protocol: string
  readonly search: string
  readonly hash: string
  toString(): string
}

declare class URLSearchParams {
  constructor(init?: string | Record<string, string> | [string, string][])
  get(name: string): string | null
  has(name: string): boolean
  set(name: string, value: string): void
  append(name: string, value: string): void
  delete(name: string): void
  toString(): string
  forEach(callback: (value: string, key: string) => void): void
}

declare class Headers {
  constructor(init?: Record<string, string> | [string, string][])
  get(name: string): string | null
  set(name: string, value: string): void
  has(name: string): boolean
  append(name: string, value: string): void
  delete(name: string): void
  forEach(callback: (value: string, key: string) => void): void
  entries(): IterableIterator<[string, string]>
}

declare class Request {
  constructor(input: string | Request, init?: RequestInit)
  readonly url: string
  readonly method: string
  readonly headers: Headers
  readonly body: ReadableStream<Uint8Array> | null
  json(): Promise<unknown>
  text(): Promise<string>
  clone(): Request
}

declare class Response {
  constructor(body?: string | null, init?: ResponseInit)
  readonly status: number
  readonly statusText: string
  readonly headers: Headers
  readonly ok: boolean
  readonly body: ReadableStream<Uint8Array> | null
  json(): Promise<unknown>
  text(): Promise<string>
  clone(): Response
  static json(data: unknown, init?: ResponseInit): Response
}

interface RequestInit {
  method?: string
  headers?: Record<string, string> | Headers
  body?: string | null
}

interface ResponseInit {
  status?: number
  statusText?: string
  headers?: Record<string, string> | Headers
}

interface ReadableStream<R = unknown> {
  readonly locked: boolean
  getReader(): ReadableStreamDefaultReader<R>
}

interface ReadableStreamDefaultReader<R = unknown> {
  read(): Promise<{ done: boolean; value: R | undefined }>
  releaseLock(): void
}
