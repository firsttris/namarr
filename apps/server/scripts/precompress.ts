/** Build step: `.br` and `.gz` next to the client assets, served by server.ts by Accept-Encoding. */
import * as path from "node:path";
import { precompress } from "../src/server/static.server.ts";

const dir = path.resolve(import.meta.dir, "../dist/client");
console.log(`precompress: ${await precompress(dir)} files in ${dir}`);
