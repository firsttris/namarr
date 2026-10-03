import { msg } from "../i18n.ts";

/**
 * Template language, close to FileBot:
 *   {n} ({y})/{n} - {s00e00} - {t}
 *   {t|lower}  {n|replace:':':' -'}  {vf|default:'SD'}
 *   {?edition} [{edition}]{/}   {!t}Episode {e}{/}
 *   \{ and \} for literal braces (Plex: \{edition-{edition}\})
 */

export type Filter = { name: string; args: string[] };
export type Node =
  | { type: "text"; value: string }
  | { type: "token"; name: string; filters: Filter[] }
  | { type: "if"; name: string; negate: boolean; children: Node[] };

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(`${message} (Position ${position + 1})`);
    this.name = "TemplateError";
  }
}

export type Values = Record<string, string | number | undefined>;

type FilterFn = (value: string, args: string[]) => string;

const TRANSLIT: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss" };

export const FILTERS: Record<string, FilterFn> = {
  lower: (v) => v.toLowerCase(),
  upper: (v) => v.toUpperCase(),
  title: (v) => v.replace(/(^|[\s\-(])(\p{L})/gu, (_, p: string, c: string) => p + c.toUpperCase()),
  trim: (v) => v.trim(),
  replace: (v, [from = "", to = ""]) => (from ? v.split(from).join(to) : v),
  default: (v, [fallback = ""]) => (v === "" ? fallback : v),
  pad: (v, [width = "2"]) => (/^\d+$/.test(v) ? v.padStart(Number(width), "0") : v),
  truncate: (v, [max = "0"]) => (Number(max) > 0 ? [...v].slice(0, Number(max)).join("").trimEnd() : v),
  ascii: (v) =>
    v
      .replace(/[äöüÄÖÜß]/g, (c) => TRANSLIT[c]!)
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, ""),
  space: (v, [sep = "."]) => v.replace(/\s+/g, sep),
  first: (v, [sep = " & "]) => v.split(sep)[0] ?? "",
};

export const TOKEN_NAMES = [
  "n",
  "y",
  "s",
  "e",
  "s00",
  "e00",
  "s00e00",
  "sxe",
  "t",
  "absolute",
  "abs",
  "d",
  "vf",
  "vc",
  "ac",
  "af",
  "hdr",
  "source",
  "group",
  "lang",
  "edition",
  "ext",
  "part",
  "id",
  "provider",
  "orig",
  "kind",
] as const;

export function parseTemplate(template: string): Node[] {
  let i = 0;
  const root: Node[] = [];
  const stack: { node: Extract<Node, { type: "if" }>; start: number }[] = [];
  const current = () => stack.at(-1)?.node.children ?? root;
  const pushText = (value: string) => {
    const nodes = current();
    const last = nodes.at(-1);
    if (last?.type === "text") last.value += value;
    else nodes.push({ type: "text", value });
  };

  while (i < template.length) {
    const ch = template[i]!;
    if (ch === "\\" && (template[i + 1] === "{" || template[i + 1] === "}" || template[i + 1] === "\\")) {
      pushText(template[i + 1]!);
      i += 2;
      continue;
    }
    if (ch === "}") throw new TemplateError(msg("template_error_unexpectedClose"), i);
    if (ch !== "{") {
      pushText(ch);
      i++;
      continue;
    }
    const start = i;
    const end = findClose(template, i + 1);
    if (end < 0) throw new TemplateError(msg("template_error_missingClose"), start);
    const body = template.slice(i + 1, end).trim();
    i = end + 1;
    if (body === "/") {
      if (!stack.pop()) throw new TemplateError(msg("template_error_endWithoutBlock"), start);
      continue;
    }
    if (body.startsWith("?") || body.startsWith("!")) {
      const name = body.slice(1).trim();
      if (!/^[a-z0-9]+$/i.test(name)) throw new TemplateError(msg("template_error_invalidCondition", { body }), start);
      const node: Extract<Node, { type: "if" }> = { type: "if", name, negate: body[0] === "!", children: [] };
      current().push(node);
      stack.push({ node, start });
      continue;
    }
    current().push(parseToken(body, start));
  }
  const open = stack.pop();
  if (open) throw new TemplateError(msg("template_error_unclosedBlock", { name: open.node.name }), open.start);
  return root;
}

/** Index of the matching `}`, skipping quoted filter arguments. */
function findClose(s: string, from: number): number {
  let quote: string | undefined;
  for (let i = from; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = undefined;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === "}") return i;
    else if (c === "{") return -1;
  }
  return -1;
}

function parseToken(body: string, position: number): Node {
  const parts = splitOutside(body, "|");
  const name = parts.shift()!.trim();
  if (!/^[a-z0-9]+$/i.test(name)) throw new TemplateError(msg("template_error_invalidToken", { body }), position);
  const filters = parts.map((raw) => {
    const [filterName = "", ...args] = splitOutside(raw.trim(), ":");
    if (!FILTERS[filterName]) throw new TemplateError(msg("template_error_unknownFilter", { filterName }), position);
    return { name: filterName, args: args.map(unquote) };
  });
  return { type: "token", name, filters };
}

function splitOutside(s: string, sep: string): string[] {
  const out: string[] = [];
  let quote: string | undefined;
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      cur += c;
      if (c === "\\" && i + 1 < s.length) cur += s[++i];
      else if (c === quote) quote = undefined;
    } else if (c === "'" || c === '"') {
      quote = c;
      cur += c;
    } else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function unquote(arg: string): string {
  const a = arg.trim();
  if (a.length >= 2 && (a[0] === "'" || a[0] === '"') && a.at(-1) === a[0]) {
    return a.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return a;
}

/** Path separators inside a value would create folders the template never asked for. */
function tokenValue(values: Values, name: string): string {
  const v = values[name];
  return v === undefined || v === null ? "" : String(v).replace(/[\\/]+/g, "-");
}

export function renderNodes(nodes: Node[], values: Values): string {
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") out += node.value;
    else if (node.type === "token") {
      out += node.filters.reduce((v, f) => FILTERS[f.name]!(v, f.args), tokenValue(values, node.name));
    } else {
      const present = tokenValue(values, node.name) !== "";
      if (present !== node.negate) out += renderNodes(node.children, values);
    }
  }
  return out;
}

export function render(template: string, values: Values): string {
  return renderNodes(parseTemplate(template), values);
}
