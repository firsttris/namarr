import * as fs from "node:fs/promises";
import * as path from "node:path";

export class PathOutsideRootError extends Error {
  constructor(readonly requested: string) {
    super(`Pfad liegt außerhalb der erlaubten Wurzelpfade: ${requested}`);
    this.name = "PathOutsideRootError";
  }
}

/** realpath of the deepest existing ancestor plus the missing rest, so targets that don't exist yet resolve too. */
async function realpathLoose(p: string): Promise<string> {
  const rest: string[] = [];
  let cur = path.resolve(p);
  for (;;) {
    try {
      const real = await fs.realpath(cur);
      return path.join(real, ...rest.reverse());
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const parent = path.dirname(cur);
      if (parent === cur) return path.join(cur, ...rest.reverse());
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolves `requested` (absolute, or relative to the first root) and checks it lies inside
 * one of `roots` after following symlinks. Throws {@link PathOutsideRootError} otherwise.
 */
export async function resolveInRoots(requested: string, roots: string[]): Promise<string> {
  if (!roots.length) throw new PathOutsideRootError(requested);
  if (requested.includes("\0")) throw new PathOutsideRootError(requested);
  const absolute = path.isAbsolute(requested) ? requested : path.join(roots[0]!, requested);
  const real = await realpathLoose(absolute);
  for (const root of roots) {
    if (isInside(real, await realpathLoose(root))) return real;
  }
  throw new PathOutsideRootError(requested);
}
