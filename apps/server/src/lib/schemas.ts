import { z } from "zod";

const base = {
  id: z.string().max(100).optional(),
  enabled: z.boolean().optional(),
  target: z.enum(["name", "extension", "full"]).optional(),
};
const position = z.enum(["start", "end"]);
const short = z.string().max(500);

/** Mirrors `Rule` from @namarr/core/rules: every rule stack from the UI is validated against it. */
export const ruleSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("replace"),
    find: short,
    replace: short,
    regex: z.boolean().optional(),
    caseSensitive: z.boolean().optional(),
    all: z.boolean().optional(),
  }),
  z.object({ ...base, type: z.literal("insert"), text: short, position: z.union([position, z.number().int().min(0)]) }),
  z.object({
    ...base,
    type: z.literal("remove"),
    from: z.number().int().min(0),
    count: z.number().int().min(0).optional(),
    fromEnd: z.boolean().optional(),
  }),
  z.object({ ...base, type: z.literal("case"), mode: z.enum(["title", "lower", "upper", "sentence"]) }),
  z.object({ ...base, type: z.literal("separators"), separator: z.string().max(10) }),
  z.object({
    ...base,
    type: z.literal("numbering"),
    start: z.number().int().optional(),
    step: z.number().int().optional(),
    padding: z.number().int().min(0).max(10).optional(),
    position: position.optional(),
    separator: z.string().max(20).optional(),
    sort: z.enum(["list", "name"]).optional(),
  }),
  z.object({
    ...base,
    type: z.literal("date"),
    source: z.enum(["mtime", "birthtime"]).optional(),
    format: z.string().max(50).optional(),
    position: position.optional(),
    separator: z.string().max(20).optional(),
  }),
  z.object({ ...base, type: z.literal("extension"), to: z.string().max(20).optional(), case: z.enum(["lower", "upper"]).optional() }),
  z.object({ ...base, type: z.literal("transliterate"), stripDiacritics: z.boolean().optional() }),
  z.object({ ...base, type: z.literal("cutAfter"), pattern: short, regex: z.boolean().optional(), keepMatch: z.boolean().optional() }),
  z.object({ ...base, type: z.literal("pad"), digits: z.number().int().min(1).max(10) }),
  z.object({
    ...base,
    type: z.literal("cleanup"),
    brackets: z.boolean().optional(),
    separators: z.boolean().optional(),
    spaces: z.boolean().optional(),
  }),
  z.object({
    ...base,
    type: z.literal("strip"),
    digits: z.boolean().optional(),
    symbols: z.boolean().optional(),
    chars: z.string().max(100).optional(),
  }),
  z.object({ ...base, type: z.literal("rearrange"), delimiter: z.string().max(20), pattern: short }),
  z.object({
    ...base,
    type: z.literal("list"),
    names: z.array(z.string().max(255)).max(10_000),
    sort: z.enum(["list", "name"]).optional(),
  }),
  z.object({
    ...base,
    type: z.literal("metadata"),
    template: short,
    position: z.enum(["replace", "start", "end"]).optional(),
    separator: z.string().max(20).optional(),
  }),
]);

export const rulesSchema = z.array(ruleSchema).max(100);
export const templateSchema = z.object({ movie: z.string().max(2000).optional(), episode: z.string().max(2000).optional() });
