import type { JobConfig, Profile } from "@namarr/db";

/**
 * Config for jobs that run without a click (watch folders, download-client hooks): the profile's
 * format and rules, never the test action (hardlink instead, so seeding goes on), and the auto
 * threshold — `null` means "always review".
 */
export function automaticConfig(profile: Profile | undefined, opts: { targetRoot: string; autoThreshold: number | null }): JobConfig {
  return {
    mode: profile?.mode ?? "media",
    preset: profile?.preset ?? "jellyfin",
    template: profile?.template ?? {},
    rules: profile?.rulesJson ?? [],
    action: profile?.action && profile.action !== "test" ? profile.action : "hardlink",
    conflictPolicy: profile?.conflictPolicy ?? "skip",
    targetRoot: opts.targetRoot,
    autoThreshold: opts.autoThreshold ?? undefined,
    alwaysReview: opts.autoThreshold === null,
  };
}
