import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Fake downloads for the README pictures (scripts/screenshots.spec.ts), fresh on every run: a
 * season in the downloads, a movie and a series for the download-client hook, empty libraries.
 * The folder is /data like in a container, so the paths in the pictures read as in real use;
 * SHOTS_DATA puts it elsewhere.
 */
export const shotsData = path.resolve(process.env.SHOTS_DATA ?? "/data");
export const shotsConfig = path.resolve("e2e/.tmp/shots-config");

export default function setup() {
  for (const dir of [shotsData, shotsConfig]) fs.rmSync(dir, { recursive: true, force: true });
  const write = (file: string) => {
    fs.mkdirSync(path.dirname(path.join(shotsData, file)), { recursive: true });
    fs.writeFileSync(path.join(shotsData, file), `fake ${path.basename(file)}`);
  };
  const season = "downloads/tv/Severance.S02.German.DL.1080p.WEB-GRP";
  for (let e = 1; e <= 7; e++) write(`${season}/Severance.S02E0${e}.German.DL.1080p.WEB.h264-GRP.mkv`);
  write(`${season}/Severance.S02E01.German.DL.1080p.WEB.h264-GRP.de.srt`);
  write(`${season}/Severance.S02E01.sample.mkv`);
  write("hook/Dune.Part.Two.2024.2160p.UHD.BluRay.x265-GRP/Dune.Part.Two.2024.2160p.UHD.BluRay.x265-GRP.mkv");
  write("hook/The.Office.US.S03.720p.WEB.x264-GRP/The.Office.US.S03E01.720p.WEB.x264-GRP.mkv");
  write("hook/The.Office.US.S03.720p.WEB.x264-GRP/The.Office.US.S03E02.720p.WEB.x264-GRP.mkv");
  write("hook/Dark.S01.German.DL.1080p.WEB-GRP/Dark.S01E01.German.DL.1080p.WEB.h264-GRP.mkv");
  write("hook/Dark.S01.German.DL.1080p.WEB-GRP/Dark.S01E02.German.DL.1080p.WEB.h264-GRP.mkv");
  for (const dir of ["downloads/movies", "media/tv", "media/movies"]) fs.mkdirSync(path.join(shotsData, dir), { recursive: true });
  fs.mkdirSync(shotsConfig, { recursive: true });
}

if (import.meta.main) setup();
