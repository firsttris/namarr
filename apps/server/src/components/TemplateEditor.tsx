import { formatPath, TemplateError, TOKEN_NAMES } from "@namarr/core/formatter";
import type { MatchResult } from "@namarr/core/matcher";
import type { Parsed } from "@namarr/core/types";
import type { NameFormat } from "@namarr/db/types";
import { type KeyboardEvent, useMemo, useRef, useState } from "react";
import { pickMsg, useLocalize } from "~/lib/i18n";
import { msgGroup } from "~/lib/msg-groups";
import * as m from "~/paraglide/messages";
import { Button, cx, Select } from "./ui";

export type Sample = { parsed: Parsed; match?: MatchResult | null; original: string };

type Props = {
  kind: "movie" | "episode";
  value: string;
  onChange: (template: string) => void;
  sample?: Sample;
  /** A picker for the formats of this kind; picking one replaces the template. */
  formats?: { list: NameFormat[]; selected?: string; onSelect: (format: NameFormat) => void; onSaveAs?: () => void };
  title?: string;
  /** Built-in formats: shown with their example, not editable. */
  readOnly?: boolean;
};

/** Template field with token chips, `{` autocompletion and a live example at the selected file. */
export function TemplateEditor({ kind, value, onChange: setValue, sample, formats, title, readOnly }: Props) {
  const localize = useLocalize();
  const area = useRef<HTMLTextAreaElement>(null);
  const [suggest, setSuggest] = useState<{ query: string; at: number } | null>(null);
  const [active, setActive] = useState(0);
  const chosen = formats?.list.find((f) => f.id === formats.selected);
  // Edited here: no longer the chosen format, until it is saved as one.
  const changed = Boolean(formats) && chosen?.template !== value;

  const example = useMemo(() => {
    if (!sample) return { text: m.template_pickFile(), error: false };
    try {
      return {
        text: formatPath(value, {
          parsed: sample.parsed,
          match: sample.match?.best,
          episodes: sample.match?.episodes,
          original: sample.original,
        }),
        error: false,
      };
    } catch (e) {
      return { text: localize(e instanceof TemplateError ? e.message : String(e)), error: true };
    }
  }, [value, sample, localize]);

  const options = suggest ? TOKEN_NAMES.filter((t) => t.startsWith(suggest.query)).slice(0, 8) : [];

  const insert = (token: string, replaceFrom?: number) => {
    const el = area.current;
    const start = replaceFrom ?? el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const text = replaceFrom !== undefined ? `${token}}` : `{${token}}`;
    const next = value.slice(0, start) + text + value.slice(end);
    setValue(next);
    setSuggest(null);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const onInput = (v: string, caret: number) => {
    setValue(v);
    const before = v.slice(0, caret);
    const m = /\{([a-z0-9]*)$/i.exec(before);
    setSuggest(m ? { query: m[1]!, at: caret - m[1]!.length } : null);
    setActive(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggest || !options.length) return;
    if (e.key === "ArrowDown") setActive((a) => (a + 1) % options.length);
    else if (e.key === "ArrowUp") setActive((a) => (a - 1 + options.length) % options.length);
    else if (e.key === "Enter" || e.key === "Tab") insert(options[active]!, suggest.at);
    else if (e.key === "Escape") setSuggest(null);
    else return;
    e.preventDefault();
  };

  return (
    <section aria-labelledby="fmt-h" className="flex flex-col gap-3 rounded-[14px] border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <h2 id="fmt-h" className="m-0 flex-grow text-[15px] font-semibold">
          {title ?? m.template_format()}{" "}
          <span className="text-xs font-normal text-muted">{kind === "episode" ? m.common_series() : m.common_movies()}</span>
        </h2>
        {formats && (
          <Select
            aria-label={m.template_preset()}
            value={changed ? "" : (chosen?.id ?? "")}
            onChange={(e) => {
              const f = formats.list.find((x) => x.id === e.target.value);
              if (f) formats.onSelect(f);
            }}
            className="h-8 max-w-48 text-xs"
          >
            {changed && <option value="">{m.template_custom()}</option>}
            {formats.list.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="relative">
        <label htmlFor="tpl" className="sr-only">
          {m.template_label()}
        </label>
        <textarea
          id="tpl"
          ref={area}
          rows={3}
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          onChange={(e) => onInput(e.target.value, e.target.selectionStart)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setSuggest(null), 150)}
          aria-autocomplete="list"
          aria-controls="tpl-suggest"
          aria-activedescendant={options.length ? `tpl-opt-${active}` : undefined}
          className="box-border w-full resize-none rounded-lg border border-line-3 bg-field px-3 py-2.5 font-mono text-xs leading-relaxed text-ink"
        />
        {options.length > 0 && (
          <div
            id="tpl-suggest"
            role="listbox"
            className="absolute top-full left-0 z-10 mt-1 w-56 rounded-lg border border-line-3 bg-panel-2 p-1 shadow-xl"
          >
            {options.map((t, i) => (
              <div
                key={t}
                id={`tpl-opt-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(t, suggest!.at);
                }}
                className={cx(
                  "flex cursor-pointer gap-2 rounded px-2 py-1 font-mono text-xs text-ink",
                  i === active ? "bg-toggle" : "bg-transparent",
                )}
              >
                <span>{`{${t}}`}</span>
                <span className="font-sans text-muted">{pickMsg(msgGroup.template_tokens, t) ?? ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={cx("flex flex-wrap gap-1.5", readOnly && "hidden")}>
        {["n", "y", "t", "s00e00", "vf", "lang", "edition"].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => insert(t)}
            className="cursor-pointer rounded-md border-0 bg-chip px-[7px] py-[3px] font-mono text-[11px] text-chip-ink hover:bg-toggle"
          >
            {`{${t}}`} {pickMsg(msgGroup.template_tokens, t)}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1 rounded-lg bg-panel-2 px-3 py-2.5" aria-live="polite">
        <div className="text-[11px] text-muted">{m.template_example()}</div>
        <div className={cx("font-mono text-xs leading-normal break-all", example.error && "text-danger")}>{example.text}</div>
      </div>
      {changed && formats?.onSaveAs && !example.error && (
        <div>
          <Button size="sm" onClick={formats.onSaveAs}>
            {m.template_saveAsFormat()}
          </Button>
        </div>
      )}
    </section>
  );
}
