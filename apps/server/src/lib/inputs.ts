import { ACTIONS, CONFLICT_POLICIES } from "@namarr/core";
import { ITEM_STATES, SERIES_PROVIDERS } from "@namarr/db";
import { z } from "zod";
import { rulesSchema, templateSchema } from "~/lib/schemas";

/** Inputs shared by the server functions (UI) and the MCP tools (agents): one validation for both. */
const id = z.number().int().positive();
const kinds = z.object({ movie: z.string().optional(), series: z.string().optional() });

export const createJobInput = z.object({
  paths: z.array(z.string().min(1)).min(1).max(100),
  mode: z.enum(["media", "rules", "both"]).optional(),
  /** Format ids per kind (unset: the defaults); `template` wins where given. */
  formats: kinds.optional(),
  preset: z.string().optional(),
  template: templateSchema.optional(),
  rules: rulesSchema.optional(),
  action: z.enum(ACTIONS).optional(),
  conflictPolicy: z.enum(CONFLICT_POLICIES).optional(),
  targetRoot: z.string().optional(),
  /** Library folders by kind (taken over when matching again); `null`: none. Unset: the profile's, else the defaults. */
  targets: kinds.nullable().optional(),
  order: z.enum(["aired", "dvd", "absolute"]).optional(),
  provider: z.enum(SERIES_PROVIDERS).optional(),
  language: z.string().optional(),
  recursive: z.boolean().optional(),
});

export const jobItemsInput = z.object({
  jobId: id,
  states: z.array(z.enum(ITEM_STATES)).optional(),
  search: z.string().max(200).optional(),
  cursor: z.number().int().optional(),
  limit: z.number().int().min(1).max(5000).optional(),
});

export const updateItemInput = z.object({
  itemId: id,
  match: z.object({ id: z.string(), kind: z.enum(["movie", "series"]) }).optional(),
  targetPath: z.string().max(4096).nullable().optional(),
  excluded: z.boolean().optional(),
  remember: z.boolean().optional(),
  approve: z.boolean().optional(),
});

export const recomputeInput = z.object({
  jobId: id,
  mode: z.enum(["media", "rules", "both"]).optional(),
  preset: z.string().optional(),
  template: templateSchema.optional(),
  /** The formats the template came from (ids), shown in the workbench. */
  formats: kinds.optional(),
  rules: rulesSchema.optional(),
  /** One folder for every file; `null`: none. */
  targetRoot: z.string().min(1).nullable().optional(),
  /** "library": by kind into the library folders; `null`: none (in place unless `targetRoot`). */
  targets: z.literal("library").nullable().optional(),
});

export const executeJobInput = z.object({
  jobId: id,
  action: z.enum(ACTIONS).optional(),
  conflictPolicy: z.enum(CONFLICT_POLICIES).optional(),
  itemIds: z.array(id).optional(),
});

export const undoInput = z.object({
  jobId: id.optional(),
  itemIds: z.array(id).optional(),
  operationIds: z.array(id).optional(),
  since: z.string().datetime().optional(),
});

export const searchInput = z.object({
  q: z.string().min(1).max(200),
  kind: z.enum(["movie", "series"]),
  year: z.number().int().optional(),
  jobId: id.optional(),
});

// scope "all": the whole file system, folders only, for choosing the folders themselves (settings).
export const browseInput = z.object({ path: z.string().optional(), scope: z.enum(["allowed", "all"]).optional() });

export const approveInboxInput = z.object({ itemIds: z.array(id).optional(), minConfidence: z.number().min(0).max(1).optional() });

export const historyInput = z.object({
  search: z.string().max(200).optional(),
  before: z.number().int().optional(),
  includeUndone: z.boolean().optional(),
});
