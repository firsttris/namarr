import { describe, expect, it, vi } from "vitest";
import { MemoryCache } from "../src/cache.ts";
import { ProviderHttp } from "../src/http.ts";

describe("ProviderHttp", () => {
  it("merkt sich auch, dass etwas fehlt (404), nur kürzer", async () => {
    const cache = new MemoryCache();
    const set = vi.spyOn(cache, "set");
    const http = new ProviderHttp("tvdb", { cache, minTime: 0 });
    const load = vi.fn(async () => undefined);
    expect(await http.cached("/series/1/translations/deu", 7 * 24 * 3600, load)).toBeUndefined();
    expect(await http.cached("/series/1/translations/deu", 7 * 24 * 3600, load)).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith("tvdb", "/series/1/translations/deu", expect.anything(), 3600);
    // Real values as before.
    const found = vi.fn(async () => ({ name: "Dark" }));
    expect(await http.cached("/series/2", 60, found)).toEqual({ name: "Dark" });
    expect(await http.cached("/series/2", 60, found)).toEqual({ name: "Dark" });
    expect(found).toHaveBeenCalledTimes(1);
  });
});
