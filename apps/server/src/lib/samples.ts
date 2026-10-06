// Example files for the format editor, without a job.

export const SAMPLE_EPISODE = {
  original: "Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv",
  parsed: {
    kind: { value: "episode" as const, confidence: 0.95 },
    title: "Severance",
    season: 2,
    episodes: [1],
    release: { resolution: "1080p", videoCodec: "H.264", group: "GRP", languages: ["de", "en"] },
  },
  match: {
    best: { provider: "tmdb", id: "95396", kind: "series" as const, title: "Severance", year: 2022 },
    episodes: [{ season: 2, episode: 1, title: "Hallo, Frau Cobel" }],
    alternatives: [],
    confidence: 0.97,
    reasons: [],
  },
};

export const SAMPLE_MOVIE = {
  original: "Das.Boot.1981.Directors.Cut.German.DL.1080p.BluRay.mkv",
  parsed: {
    kind: { value: "movie" as const, confidence: 0.85 },
    title: "Das Boot",
    year: 1981,
    episodes: [],
    edition: "Director's Cut",
    release: { resolution: "1080p", source: "BluRay", languages: ["de", "en"] },
  },
  match: {
    best: { provider: "tmdb", id: "387", kind: "movie" as const, title: "Das Boot", year: 1981 },
    episodes: [],
    alternatives: [],
    confidence: 0.95,
    reasons: [],
  },
};
