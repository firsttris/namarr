import * as fs from "node:fs";
import * as path from "node:path";

/** Fresh config and fake media files before every run (run by the webServer command). */
export default function setup() {
  const root = path.resolve("e2e/.tmp");
  fs.rmSync(root, { recursive: true, force: true });
  const tv = path.join(root, "data/downloads/tv");
  const files = [
    "Severance.S02E01.German.DL.1080p.WEB.h264-GRP.mkv",
    "Severance.S02E01.German.DL.1080p.WEB.h264-GRP.de.srt",
    "Severance.S02E02.German.DL.1080p.WEB.h264-GRP.mkv",
    "Severance.S02E03.German.DL.1080p.WEB.h264-GRP.mkv",
    "severance.204-205.720p.mkv",
    "Severance/Staffel 2/06.mkv",
    "Severance.S02E01.sample.mkv",
    "video_2024_final_v2.mp4",
  ];
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(tv, f)), { recursive: true });
    fs.writeFileSync(path.join(tv, f), `fake ${f}`);
  }
  fs.mkdirSync(path.join(root, "data/media/tv"), { recursive: true });
  fs.mkdirSync(path.join(root, "data/media/movies"), { recursive: true });
  const photos = path.join(root, "data/photos");
  fs.mkdirSync(photos, { recursive: true });
  for (const f of ["IMG_0003.JPG", "IMG_0001.JPG", "IMG_0002.JPG"]) fs.writeFileSync(path.join(photos, f), f);
  const hook = path.join(root, "data/hook/Dark.S01.German.DL.1080p.WEB-GRP");
  fs.mkdirSync(hook, { recursive: true });
  fs.writeFileSync(path.join(hook, "Dark.S01E01.German.DL.1080p.WEB.h264-GRP.mkv"), "dark");
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
}

if (import.meta.main) setup();
