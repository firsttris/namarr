import type { LibraryFolder, Targets } from "@namarr/db/types";
import * as m from "~/paraglide/messages";
import { PathInput } from "./PathInput";
import { Field, Select } from "./ui";

type Props = {
  idPrefix: string;
  targets: Targets;
  onChange: (targets: Targets) => void;
  folders: LibraryFolder[];
  /** Rule mode has no library: a folder for everything, or in place. Undefined: show both. */
  mode?: "media" | "rules" | "both";
};

/** Where a profile or watch folder puts files: library folders by kind, or one folder in rule mode. */
export function TargetFields({ idPrefix, targets, onChange, folders, mode }: Props) {
  const library = (kind: "movies" | "series", key: "movie" | "series", label: string) => {
    const ofKind = folders.filter((f) => f.kind === kind);
    const fallback = ofKind.find((f) => f.default) ?? (ofKind.length === 1 ? ofKind[0] : undefined);
    const id = `${idPrefix}-${key}`;
    return (
      <Field label={label} htmlFor={id}>
        <Select
          id={id}
          className="font-mono"
          value={targets[key] ?? ""}
          onChange={(e) => onChange({ ...targets, [key]: e.target.value || undefined })}
        >
          <option value="">{fallback ? m.targets_default({ name: fallback.name }) : m.targets_noDefault()}</option>
          {ofKind.map((f) => (
            <option key={f.path} value={f.path} title={f.path}>
              {f.name}
            </option>
          ))}
          {/* A folder set before it was a library folder (or removed as one) stays visible. */}
          {targets[key] && !ofKind.some((f) => f.path === targets[key]) && <option value={targets[key]}>{targets[key]}</option>}
        </Select>
      </Field>
    );
  };
  return (
    <>
      {mode !== "rules" && library("movies", "movie", m.targets_movies())}
      {mode !== "rules" && library("series", "series", m.targets_series())}
      {mode !== "media" && mode !== "both" && (
        <Field label={m.targets_rules()} htmlFor={`${idPrefix}-other`} hint={m.targets_rulesHint()}>
          <PathInput
            id={`${idPrefix}-other`}
            label={m.targets_rules()}
            value={targets.other ?? ""}
            placeholder={m.targets_inPlace()}
            onChange={(p) => onChange({ ...targets, other: p || undefined })}
          />
        </Field>
      )}
    </>
  );
}
