import type { JobConfig, Profile, Targets } from "@namarr/db";

/**
 * Config for jobs that run without a click (watch folders, download-client hooks): the profile's
 * format and rules, never the test action (hardlink instead, so seeding goes on), and the auto
 * threshold — `null` means "always review".
 *
 * `targets`: the folders resolved for this job (see resolveTargets); `targetRoot`: one folder for
 * every file, given explicitly (download client hook).
 */
export function automaticConfig(
  profile: Profile | undefined,
  opts: { targets: Targets; targetRoot?: string; autoThreshold: number | null },
): JobConfig {
  const mode = profile?.mode ?? "media";
  return {
    mode,
    preset: profile?.preset ?? "jellyfin",
    template: profile?.template ?? {},
    rules: profile?.rulesJson ?? [],
    action: profile?.action && profile.action !== "test" ? profile.action : "hardlink",
    conflictPolicy: profile?.conflictPolicy ?? "skip",
    provider: profile?.provider ?? undefined,
    targetRoot: opts.targetRoot ?? (mode === "rules" ? opts.targets.other : undefined),
    targets: { movie: opts.targets.movie, series: opts.targets.series },
    autoThreshold: opts.autoThreshold ?? undefined,
    alwaysReview: opts.autoThreshold === null,
  };
}
