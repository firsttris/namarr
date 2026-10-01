import { describeRule, previewRules, type Rule, RuleError } from "@namarr/core/rules";
import { type ReactNode, useMemo, useState } from "react";
import { GripIcon, PlusIcon, XIcon } from "./icons";
import { cx, inputClass, Select } from "./ui";

const NEW_RULES: Record<Rule["type"], { label: string; rule: Rule }> = {
  replace: { label: "Ersetzen", rule: { type: "replace", find: ":", replace: " -" } },
  insert: { label: "Einfügen", rule: { type: "insert", text: "", position: "start" } },
  remove: { label: "Löschen", rule: { type: "remove", from: 0, count: 1 } },
  case: { label: "Schreibweise", rule: { type: "case", mode: "title" } },
  separators: { label: "Trenner normalisieren", rule: { type: "separators", separator: " " } },
  numbering: { label: "Nummerierung", rule: { type: "numbering", start: 1, step: 1, padding: 2, position: "start", separator: " - " } },
  date: { label: "Datum aus Datei", rule: { type: "date", format: "YYYY-MM-DD", position: "start", separator: " " } },
  extension: { label: "Erweiterung", rule: { type: "extension", case: "lower" } },
  transliterate: { label: "Umlaute ersetzen", rule: { type: "transliterate" } },
  cutAfter: { label: "Rest abschneiden", rule: { type: "cutAfter", pattern: "" } },
};

type Props = {
  rules: Rule[];
  onChange: (rules: Rule[]) => void;
  /** The selected file's name before the rules, for the per-rule preview. */
  sample?: string;
  title?: string;
  note?: string;
};

/** Ordered rule stack: drag to reorder, toggle, edit inline, preview per rule. */
export function RuleStack({
  rules,
  onChange,
  sample,
  title = "Regeln danach",
  note = "Regeln wirken nach dem Format auf jeden neuen Namen.",
}: Props) {
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);

  const steps = useMemo(() => {
    if (!sample) return null;
    try {
      return { names: previewRules([{ path: sample.split("/").at(-1)!, mtime: new Date() }], rules).map((s) => s[0]!), error: null };
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
          {title}
        </h2>
        <button
          type="button"
          aria-label="Regel hinzufügen"
          aria-expanded={adding}
          onClick={() => setAdding((a) => !a)}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[7px] border border-line-3 bg-transparent text-ink hover:bg-panel-2"
        >
          <PlusIcon size={14} />
        </button>
      </div>
      {adding && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(NEW_RULES).map(([type, { label, rule }]) => (
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
              {label}
            </button>
          ))}
        </div>
      )}
      {rules.length === 0 && <div className="text-xs text-faint">Keine Regeln.</div>}
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
              <span className="cursor-grab text-faint" title="Ziehen zum Sortieren">
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
                {describeRule(rule)}
              </button>
              <input
                type="checkbox"
                checked={rule.enabled !== false}
                onChange={(e) => update(i, { enabled: e.target.checked })}
                aria-label={`Regel ${i + 1} aktiv`}
                className="h-4 w-4"
              />
              <button
                type="button"
                aria-label={`Regel ${i + 1} entfernen`}
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
            {steps?.error?.ruleIndex === i && <div className="text-[11px] text-danger">{steps.error.message}</div>}
          </li>
        ))}
      </ol>
      <div className="text-xs text-muted">{note}</div>
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
  const id = (f: string) => `rule-${index}-${f}`;
  const target = (
    <Row label="Wirkt auf" id={id("target")}>
      <Select
        id={id("target")}
        className="h-8 text-xs"
        value={rule.target ?? "name"}
        onChange={(e) => onChange({ target: e.target.value as Rule["target"] })}
      >
        <option value="name">Name</option>
        <option value="extension">Erweiterung</option>
        <option value="full">Voller Pfad</option>
      </Select>
    </Row>
  );
  const position = (value: string | number | undefined) => (
    <Row label="Position" id={id("pos")}>
      <Select
        id={id("pos")}
        className="h-8 text-xs"
        value={String(value ?? "start")}
        onChange={(e) => onChange({ position: e.target.value as "start" } as Partial<Rule>)}
      >
        <option value="start">Anfang</option>
        <option value="end">Ende</option>
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
          {text("Suchen", "find", rule.find)}
          {text("Ersetzen", "replace", rule.replace)}
          <div className="flex gap-4">
            {check("Regex", "regex", rule.regex)}
            {check("Groß/klein", "caseSensitive", rule.caseSensitive)}
          </div>
        </>
      )}
      {rule.type === "insert" && (
        <>
          {text("Text", "text", rule.text)}
          {position(rule.position)}
        </>
      )}
      {rule.type === "remove" && (
        <>
          {number("Ab Zeichen", "from", rule.from)}
          {number("Anzahl", "count", rule.count)}
          {check("Von hinten", "fromEnd", rule.fromEnd)}
        </>
      )}
      {rule.type === "case" && (
        <Row label="Modus" id={id("mode")}>
          <Select
            id={id("mode")}
            className="h-8 text-xs"
            value={rule.mode}
            onChange={(e) => onChange({ mode: e.target.value as "title" } as Partial<Rule>)}
          >
            <option value="title">Titel</option>
            <option value="sentence">Satz</option>
            <option value="lower">klein</option>
            <option value="upper">GROSS</option>
          </Select>
        </Row>
      )}
      {rule.type === "separators" && text("Trenner", "separator", rule.separator)}
      {rule.type === "numbering" && (
        <>
          {number("Start", "start", rule.start)}
          {number("Schritt", "step", rule.step)}
          {number("Stellen", "padding", rule.padding)}
          {text("Trenner", "separator", rule.separator)}
          {position(rule.position)}
          <Row label="Reihenfolge" id={id("sort")}>
            <Select
              id={id("sort")}
              className="h-8 text-xs"
              value={rule.sort ?? "list"}
              onChange={(e) => onChange({ sort: e.target.value as "name" } as Partial<Rule>)}
            >
              <option value="list">Liste</option>
              <option value="name">Name (natürlich)</option>
            </Select>
          </Row>
        </>
      )}
      {rule.type === "date" && (
        <>
          {text("Format", "format", rule.format)}
          {text("Trenner", "separator", rule.separator)}
          {position(rule.position)}
        </>
      )}
      {rule.type === "extension" && (
        <>
          {text("Neue Endung", "to", rule.to)}
          <Row label="Schreibweise" id={id("case")}>
            <Select
              id={id("case")}
              className="h-8 text-xs"
              value={rule.case ?? ""}
              onChange={(e) => onChange({ case: (e.target.value || undefined) as "lower" } as Partial<Rule>)}
            >
              <option value="">unverändert</option>
              <option value="lower">klein</option>
              <option value="upper">GROSS</option>
            </Select>
          </Row>
        </>
      )}
      {rule.type === "transliterate" && check("Auch Akzente entfernen (é → e)", "stripDiacritics", rule.stripDiacritics !== false)}
      {rule.type === "cutAfter" && (
        <>
          {text("Muster", "pattern", rule.pattern)}
          <div className="flex gap-4">
            {check("Regex", "regex", rule.regex)}
            {check("Treffer behalten", "keepMatch", rule.keepMatch)}
          </div>
        </>
      )}
      {rule.type !== "extension" && target}
    </div>
  );
}
