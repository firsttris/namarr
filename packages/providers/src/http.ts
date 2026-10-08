import { gunzipSync } from "node:zlib";
import Bottleneck from "bottleneck";
import { MemoryCache, type ProviderCache } from "./cache.ts";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type HttpOptions = {
  cache?: ProviderCache;
  fetch?: typeof fetch;
  /** Minimum pause between two requests in milliseconds. */
  minTime: number;
  maxConcurrent?: number;
};

/** Rate limit, response cache and 429 retries, shared by the providers. */
const MISSING = { namarrMissing: true } as const;
const MISSING_TTL_S = 3600;
const isMissing = (v: unknown) => typeof v === "object" && v !== null && (v as { namarrMissing?: boolean }).namarrMissing === true;

export class ProviderHttp {
  private readonly limiter: Bottleneck;
  readonly cache: ProviderCache;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly provider: string,
    options: HttpOptions,
  ) {
    this.limiter = new Bottleneck({ maxConcurrent: options.maxConcurrent ?? 4, minTime: options.minTime });
    this.cache = options.cache ?? new MemoryCache();
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** Returns the cached value for `key` or loads, caches and returns it. Undefined is not cached. */
  /**
   * `load` answering undefined (404: no such translation, no such ID) is remembered too, for at most
   * an hour, so a missing translation is not asked for on every run.
   */
  async cached<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    const hit = await this.cache.get(this.provider, key);
    if (isMissing(hit)) return undefined as T;
    if (hit !== undefined) return hit as T;
    const value = await load();
    if (value !== undefined) await this.cache.set(this.provider, key, value, ttlSeconds);
    else await this.cache.set(this.provider, key, MISSING, Math.min(ttlSeconds, MISSING_TTL_S));
    return value;
  }

  /** A rate-limited request; 429 waits for `retry-after` up to three times. */
  request(url: string, init: RequestInit = {}): Promise<Response> {
    return this.limiter.schedule(() => this.send(url, init, 0));
  }

  private async send(url: string, init: RequestInit, attempt: number): Promise<Response> {
    const res = await this.fetchImpl(url, init);
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get("retry-after") ?? 1) * 1000;
      await new Promise((r) => setTimeout(r, Math.min(wait, 10_000)));
      return this.send(url, init, attempt + 1);
    }
    return res;
  }
}

/** Body as text; gzip is unpacked even when the server did not say so (AniDB). */
export async function textOf(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes;
  return new TextDecoder().decode(raw);
}

/** de-DE → deu, as TheTVDB names languages. */
const ISO_639_2: Record<string, string> = {
  de: "deu",
  en: "eng",
  fr: "fra",
  es: "spa",
  it: "ita",
  ja: "jpn",
  nl: "nld",
  pt: "por",
  pl: "pol",
  sv: "swe",
  da: "dan",
  fi: "fin",
  no: "nor",
  ru: "rus",
  tr: "tur",
  cs: "ces",
  hu: "hun",
  ko: "kor",
  zh: "zho",
};

export const lang2 = (language?: string) => (language ?? "en").slice(0, 2).toLowerCase();
export const lang3 = (language?: string) => ISO_639_2[lang2(language)] ?? "eng";
export const yearOf = (date?: string | null) => (date && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : undefined);
