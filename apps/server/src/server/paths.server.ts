import * as path from "node:path";
import { isInside } from "@namarr/core";

const SYSTEM_DIRS = ["/proc", "/sys", "/dev"];

/**
 * Folders namarr must not work in: the whole file system, kernel and device trees, and anything
 * holding its own database (rule mode could rename it).
 */
export function forbiddenFolder(folder: string, configDir: string): boolean {
  const dir = path.resolve(folder);
  const config = path.resolve(configDir);
  return (
    dir === "/" ||
    SYSTEM_DIRS.some((s) => dir === s || isInside(dir, s)) ||
    dir === config ||
    isInside(config, dir) ||
    isInside(dir, config)
  );
}
