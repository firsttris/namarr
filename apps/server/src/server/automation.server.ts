import { type JobConfig, resolveFormats, type Settings, type Targets, type WatchFolder } from "@namarr/db";

/**
 * Config for jobs that run without a click (watch folders, download-client hooks): the watch
 * folder's formats, series source and action (move unless set), and the auto threshold — `null` means "always review".
 *
 * `targets`: the folders resolved for this job (see resolveTargets); `targetRoot`: one folder for
 * every file, given explicitly (download client hook).
 */
export function automaticConfig(
  settings: Settings,
  folder: Pick<WatchFolder, "options"> | undefined,
  opts: { targets: Targets; targetRoot?: string; autoThreshold: number | null },
): JobConfig {
  const options = folder?.options ?? {};
  const formats = resolveFormats(settings, options.formats);
  return {
    mode: "media",
    template: { movie: formats.movie.template, episode: formats.series.template },
    formats: { movie: formats.movie.id, series: formats.series.id },
    action: options.action ?? "move",
    conflictPolicy: options.conflictPolicy ?? "skip",
    provider: options.provider,
    targetRoot: opts.targetRoot,
    targets: { movie: opts.targets.movie, series: opts.targets.series },
    autoThreshold: opts.autoThreshold ?? undefined,
    alwaysReview: opts.autoThreshold === null,
  };
}
