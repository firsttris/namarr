import { useEffect, useRef, useState } from "react";
import * as m from "~/paraglide/messages";
import { FolderBrowser } from "./FolderBrowser";
import { Button, cx, inputClass } from "./ui";

type Props = {
  id: string;
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
  /** "all": choose from the whole file system (the allowed folders themselves, in the settings). */
  scope?: "allowed" | "all";
  /** A file path: the browser picks its folder and keeps the file name. */
  fileName?: string;
  size?: "sm" | "md";
  /** What the path is for, for the browse button's accessible name. */
  label?: string;
};

/** A path field with a folder browser: type the path, or pick it. */
export function PathInput({ id, value, onChange, placeholder, required, className, scope, fileName, size = "md", label }: Props) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open) dialog.current?.close();
  }, [open]);
  const folder = fileName && value ? value.replace(/\/[^/]*$/, "") : value;

  return (
    <div className={cx("flex min-w-0 gap-2", className)}>
      <input
        id={id}
        aria-label={label ? m.folders_pathOf({ field: label }) : undefined}
        className={cx(inputClass, "min-w-0 flex-grow font-mono", size === "sm" && "h-8 text-xs")}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
      <Button
        size="sm"
        className={size === "md" ? "h-9" : undefined}
        onClick={() => setOpen(true)}
        aria-label={label ? m.folders_browseFor({ field: label }) : undefined}
      >
        {m.folders_browse()}
      </Button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        aria-labelledby={`${id}-browse-h`}
        className="m-auto w-[640px] max-w-[95vw] rounded-[14px] border border-line bg-panel p-0 text-ink"
      >
        {open && (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-center gap-2">
              <h2 id={`${id}-browse-h`} className="m-0 flex-grow text-base font-semibold">
                {fileName ? m.folders_chooseTargetFolder() : m.folders_chooseFolder()}
              </h2>
              <Button size="sm" onClick={() => setOpen(false)}>
                {m.common_close()}
              </Button>
            </div>
            <FolderBrowser
              scope={scope}
              initial={folder || undefined}
              onChoose={(p) => {
                onChange(fileName ? `${p}/${fileName}` : p);
                setOpen(false);
              }}
            />
          </div>
        )}
      </dialog>
    </div>
  );
}
