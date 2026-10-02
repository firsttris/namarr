import { describeRule, previewRules, type Rule, RuleError } from "@namarr/core/rules";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { parse as parseYaml, stringify as toYaml } from "yaml";
import { useLocalize, useT } from "~/lib/i18n";
import { rulesSchema } from "~/lib/schemas";
import { GripIcon, PlusIcon, XIcon } from "./icons";
import { cx, inputClass, Select } from "./ui";

const NEW_RULES: Record<Rule["type"], Rule> = {
  replace: { type: "replace", find: ":", replace: " -" },
  insert: { type: "insert", text: "", position: "start" },
  remove: { type: "remove", from: 0, count: 1 },
  case: { type: "case", mode: "title" },
  separators: { type: "separators", separator: " " },
  numbering: { type: "numbering", start: 1, step: 1, padding: 2, position: "start", separator: " - " },
  date: { type: "date", format: "YYYY-MM-DD", position: "start", separator: " " },
  extension: { type: "extension", case: "lower" },
  transliterate: { type: "transliterate" },
  cutAfter: { type: "cutAfter", pattern: "" },
  pad: { type: "pad", digits: 2 },
  cleanup: { type: "cleanup", brackets: true, spaces: true },
  strip: { type: "strip", symbols: true },
  rearrange: { type: "rearrange", delimiter: " - ", pattern: "$2 - $1" },
  list: { type: "list", names: [] },
  metadata: { type: "metadata", template: "{date:YYYY-MM-DD HH-mm-ss}", position: "replace" },
};

/** Example data for the per-rule preview of metadata rules (the real values come from the files). */
const SAMPLE_META = {
  taken: new Date(2024, 6, 14, 18, 3, 22),
  tags: {
    artist: "Artist",
    album_artist: "Artist",
    title: "Title",
    album: "Album",
    track: "3/12",
    disc: "1",
    date: "2024",
    genre: "Genre",
  },
};

/** File format for sharing rule stacks: YAML, without the UI's ids. */
function exportRules(rules: Rule[]): string {
  return toYaml({ namarr: "rules/1", rules: rules.map(({ id: _, ...rule }) => rule) });
}

/** Accepts the export format or a bare list; YAML is a superset of JSON, so JSON works too. */
function importRules(text: string): Rule[] {
  const data = parseYaml(text) as unknown;
  const list = Array.isArray(data) ? data : (data as { rules?: unknown })?.rules;
  const parsed = rulesSchema.safeParse(list);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "invalid");
  return (parsed.data as Rule[]).map((rule) => ({ ...rule, id: crypto.randomUUID() }));
}

type Props = {
  rules: Rule[];
  onChange: (rules: Rule[]) => void;
  /** The selected file's name before the rules, for the per-rule preview. */
  sample?: string;
  title?: string;
  note?: string;
};

/** Ordered rule stack: drag to reorder, toggle, edit inline, preview per rule. */
export function RuleStack({ rules, onChange, sample, title, note }: Props) {
  const t = useT();
  const localize = useLocalize();
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportRules(rules)], { type: "application/yaml" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "namarr-rules.yaml" });
    a.click();
    URL.revokeObjectURL(url);
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      onChange(importRules(await f.text()));
      setImportError(null);
    } catch (e) {
      setImportError(t.rules.importError((e as Error).message));
    }
  };

  const steps = useMemo(() => {
    if (!sample) return null;
    try {
      const entry = { path: sample.split("/").at(-1)!, mtime: new Date(), meta: SAMPLE_META };
      return { names: previewRules([entry], rules).map((s) => s[0]!), error: null };
    } catch (e) {
      return { names: null, error: e instanceof RuleError ? e : null };
    }
  }, [rules, sample]);

  const update = (i: number, patch: Partial<Rule>) => onChange(rules.map((r, k) => (k === i ? ({ ...r, ...patch } as Rule) : r)));
  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...rules];
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r!);
    onChange(next);
  };

  return (
    <section aria-labelledby="rules-h" className="flex flex-col gap-2.5 rounded-[14px] border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <h2 id="rules-h" className="m-0 flex-grow text-[15px] font-semibold">
          {title ?? t.workbench.rulesAfter}
        </h2>
        <button
          type="button"
          aria-label={t.rules.add}
          aria-expanded={adding}
          onClick={() => setAdding((a) => !a)}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[7px] border border-line-3 bg-transparent text-ink hover:bg-panel-2"
        >
          <PlusIcon size={14} />
        </button>
      </div>
      {adding && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(NEW_RULES).map(([type, rule]) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                onChange([...rules, { ...rule, id: crypto.randomUUID() } as Rule]);
                setOpen(rules.length);
                setAdding(false);
              }}
              className="cursor-pointer rounded-md border-0 bg-chip px-2 py-1 text-xs text-chip-ink hover:bg-toggle"
            >
              {t.rules.types[type]}
            </button>
          ))}
        </div>
      )}
      {rules.length === 0 && <div className="text-xs text-faint">{t.rules.none}</div>}
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {rules.map((rule, i) => (
          <li
            key={rule.id ?? i}
            draggable
            onDragStart={() => setDrag(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag !== null) move(drag, i);
              setDrag(null);
            }}
            className={cx("flex flex-col gap-2 rounded-lg border border-line-2 bg-panel-2 px-3 py-2.5", drag === i && "opacity-50")}
          >
            <div className="flex items-center gap-2.5">
              <span className="cursor-grab text-faint" title={t.rules.drag}>
                <GripIcon />
              </span>
              <span className="font-mono text-[11px] text-faint">{i + 1}</span>
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
                className={cx(
                  "flex-grow cursor-pointer border-0 bg-transparent p-0 text-left text-[13px] text-ink",
                  rule.enabled === false && "text-faint line-through",
                )}
              >
                {localize(describeRule(rule))}
              </button>
              <input
                type="checkbox"
                checked={rule.enabled !== false}
                onChange={(e) => update(i, { enabled: e.target.checked })}
                aria-label={t.rules.active(i + 1)}
                className="h-4 w-4"
              />
              <button
                type="button"
                aria-label={t.rules.remove(i + 1)}
                onClick={() => onChange(rules.filter((_, k) => k !== i))}
                className="cursor-pointer border-0 bg-transparent p-1 text-faint hover:text-ink"
              >
                <XIcon />
              </button>
            </div>
            {open === i && <RuleEditor rule={rule} index={i} onChange={(patch) => update(i, patch)} />}
            {steps?.names && (
              <div className="truncate font-mono text-[11px] text-muted" title={steps.names[i + 1]}>
                → {steps.names[i + 1]}
              </div>
            )}
            {steps?.error?.ruleIndex === i && <div className="text-[11px] text-danger">{localize(steps.error.message)}</div>}
          </li>
        ))}
      </ol>
      <div className="text-xs text-muted">{note ?? t.workbench.rulesAfterNote}</div>
      <div className="flex gap-3 text-xs">
        <button
          type="button"
          onClick={download}
          disabled={!rules.length}
          className="cursor-pointer border-0 bg-transparent p-0 text-accent hover:text-accent-soft disabled:cursor-default disabled:text-faint"
        >
          {t.rules.exportRules}
        </button>
        <button
          type="button"
          onClick={() => file.current?.click()}
          className="cursor-pointer border-0 bg-transparent p-0 text-accent hover:text-accent-soft"
        >
          {t.rules.importRules}
        </button>
        <input
          ref={file}
          type="file"
          accept=".yaml,.yml,.json"
          aria-label={t.rules.importRules}
          className="hidden"
          onChange={(e) => {
            void upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {importError && (
        <div role="alert" className="text-[11px] text-danger">
          {importError}
        </div>
      )}
    </section>
  );
}

function Row({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="w-24 flex-shrink-0 text-xs text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

const small = cx(inputClass, "h-8 min-w-0 flex-grow font-mono text-xs");

function RuleEditor({ rule, index, onChange }: { rule: Rule; index: number; onChange: (patch: Partial<Rule>) => void }) {
  const r = useT().rules;
  const id = (f: string) => `rule-${index}-${f}`;
  const target = (
    <Row label={r.appliesTo} id={id("target")}>
      <Select
        id={id("target")}
        className="h-8 text-xs"
        value={rule.target ?? "name"}
        onChange={(e) => onChange({ target: e.target.value as Rule["target"] })}
      >
        <option value="name">{r.targetName}</option>
        <option value="extension">{r.targetExtension}</option>
        <option value="full">{r.targetFull}</option>
      </Select>
    </Row>
  );
  const position = (value: string | number | undefined) => (
    <Row label={r.position} id={id("pos")}>
      <Select
        id={id("pos")}
        className="h-8 text-xs"
        value={String(value ?? "start")}
        onChange={(e) => onChange({ position: e.target.value as "start" } as Partial<Rule>)}
      >
        <option value="start">{r.start}</option>
        <option value="end">{r.end}</option>
      </Select>
    </Row>
  );
  const text = (label: string, field: string, value: string | undefined) => (
    <Row label={label} id={id(field)}>
      <input
        id={id(field)}
        className={small}
        value={value ?? ""}
        onChange={(e) => onChange({ [field]: e.target.value } as Partial<Rule>)}
      />
    </Row>
  );
  const number = (label: string, field: string, value: number | undefined) => (
    <Row label={label} id={id(field)}>
      <input
        id={id(field)}
        type="number"
        className={small}
        value={value ?? 0}
        onChange={(e) => onChange({ [field]: Number(e.target.value) } as Partial<Rule>)}
      />
    </Row>
  );
  const check = (label: string, field: string, value: boolean | undefined) => (
    <label className="flex items-center gap-2 text-xs text-soft">
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => onChange({ [field]: e.target.checked } as Partial<Rule>)}
        className="h-4 w-4"
      />
      {label}
    </label>
  );

  return (
    <div className="flex flex-col gap-2 border-t border-line-2 pt-2">
      {rule.type === "replace" && (
        <>
          {text(r.find, "find", rule.find)}
          {text(r.replace, "replace", rule.replace)}
          <div className="flex gap-4">
            {check(r.regex, "regex", rule.regex)}
            {check(r.caseSensitive, "caseSensitive", rule.caseSensitive)}
          </div>
        </>
      )}
      {rule.type === "insert" && (
        <>
          {text(r.text, "text", rule.text)}
          {position(rule.position)}
        </>
      )}
      {rule.type === "remove" && (
        <>
          {number(r.from, "from", rule.from)}
          {number(r.count, "count", rule.count)}
          {check(r.fromEnd, "fromEnd", rule.fromEnd)}
        </>
      )}
      {rule.type === "case" && (
        <Row label={r.mode} id={id("mode")}>
          <Select
            id={id("mode")}
            className="h-8 text-xs"
            value={rule.mode}
            onChange={(e) => onChange({ mode: e.target.value as "title" } as Partial<Rule>)}
          >
            <option value="title">{r.caseTitle}</option>
            <option value="sentence">{r.caseSentence}</option>
            <option value="lower">{r.caseLower}</option>
            <option value="upper">{r.caseUpper}</option>
          </Select>
        </Row>
      )}
      {rule.type === "separators" && text(r.separator, "separator", rule.separator)}
      {rule.type === "numbering" && (
        <>
          {number(r.numberStart, "start", rule.start)}
          {number(r.step, "step", rule.step)}
          {number(r.padding, "padding", rule.padding)}
          {text(r.separator, "separator", rule.separator)}
          {position(rule.position)}
          <Row label={r.order} id={id("sort")}>
            <Select
              id={id("sort")}
              className="h-8 text-xs"
              value={rule.sort ?? "list"}
              onChange={(e) => onChange({ sort: e.target.value as "name" } as Partial<Rule>)}
            >
              <option value="list">{r.orderList}</option>
              <option value="name">{r.orderName}</option>
            </Select>
          </Row>
        </>
      )}
      {rule.type === "date" && (
        <>
          {text(r.format, "format", rule.format)}
          {text(r.separator, "separator", rule.separator)}
          {position(rule.position)}
        </>
      )}
      {rule.type === "extension" && (
        <>
          {text(r.newExtension, "to", rule.to)}
          <Row label={r.types.case!} id={id("case")}>
            <Select
              id={id("case")}
              className="h-8 text-xs"
              value={rule.case ?? ""}
              onChange={(e) => onChange({ case: (e.target.value || undefined) as "lower" } as Partial<Rule>)}
            >
              <option value="">{r.unchanged}</option>
              <option value="lower">{r.caseLower}</option>
              <option value="upper">{r.caseUpper}</option>
            </Select>
          </Row>
        </>
      )}
      {rule.type === "transliterate" && check(r.stripDiacritics, "stripDiacritics", rule.stripDiacritics !== false)}
      {rule.type === "cutAfter" && (
        <>
          {text(r.pattern, "pattern", rule.pattern)}
          <div className="flex gap-4">
            {check(r.regex, "regex", rule.regex)}
            {check(r.keepMatch, "keepMatch", rule.keepMatch)}
          </div>
        </>
      )}
      {rule.type === "pad" && number(r.digits, "digits", rule.digits)}
      {rule.type === "cleanup" && (
        <>
          {check(r.brackets, "brackets", rule.brackets !== false)}
          {check(r.dotsToSpaces, "separators", rule.separators)}
          {check(r.tidySpaces, "spaces", rule.spaces !== false)}
        </>
      )}
      {rule.type === "strip" && (
        <>
          <div className="flex gap-4">
            {check(r.stripDigits, "digits", rule.digits)}
            {check(r.stripSymbols, "symbols", rule.symbols)}
          </div>
          {text(r.stripChars, "chars", rule.chars)}
        </>
      )}
      {rule.type === "rearrange" && (
        <>
          {text(r.delimiter, "delimiter", rule.delimiter)}
          {text(r.pattern, "pattern", rule.pattern)}
          <div className="text-[11px] text-faint">{r.rearrangeHint}</div>
        </>
      )}
      {rule.type === "list" && (
        <>
          <label htmlFor={id("names")} className="text-xs text-muted">
            {r.names}
          </label>
          <textarea
            id={id("names")}
            rows={5}
            className={cx(inputClass, "h-auto py-2 font-mono text-xs")}
            value={rule.names.join("\n")}
            onChange={(e) => onChange({ names: e.target.value.split("\n") } as Partial<Rule>)}
          />
          <div className="text-[11px] text-faint">{r.namesHint(rule.names.filter((n) => n.trim()).length)}</div>
          <Row label={r.order} id={id("sort")}>
            <Select
              id={id("sort")}
              className="h-8 text-xs"
              value={rule.sort ?? "list"}
              onChange={(e) => onChange({ sort: e.target.value as "name" } as Partial<Rule>)}
            >
              <option value="list">{r.orderList}</option>
              <option value="name">{r.orderName}</option>
            </Select>
          </Row>
        </>
      )}
      {rule.type === "metadata" && (
        <>
          {text(r.template, "template", rule.template)}
          <div className="text-[11px] text-faint">{r.metadataHint}</div>
          <Row label={r.position} id={id("pos")}>
            <Select
              id={id("pos")}
              className="h-8 text-xs"
              value={rule.position ?? "replace"}
              onChange={(e) => onChange({ position: e.target.value as "replace" } as Partial<Rule>)}
            >
              <option value="replace">{r.replaceName}</option>
              <option value="start">{r.start}</option>
              <option value="end">{r.end}</option>
            </Select>
          </Row>
          {rule.position && rule.position !== "replace" && text(r.separator, "separator", rule.separator ?? " ")}
        </>
      )}
      {rule.type !== "extension" && target}
    </div>
  );
}
