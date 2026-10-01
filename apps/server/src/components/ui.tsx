import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export { cx };

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "accent" | "light" | "ghost"; size?: "sm" | "md" | "lg" };

export function Button({ variant = "ghost", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-9 px-3.5 text-[13px]",
        size === "lg" && "h-11 rounded-[10px] px-5 text-sm font-semibold",
        variant === "accent" && "bg-accent text-accent-ink font-semibold hover:bg-accent-soft",
        variant === "light" && "bg-ink text-nav font-semibold hover:bg-white",
        variant === "ghost" && "border border-line-3 bg-transparent text-ink hover:bg-panel-2",
        className,
      )}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx("h-9 rounded-lg border border-line-3 bg-panel-2 px-3 text-[13px] text-ink", className)} {...rest}>
      {children}
    </select>
  );
}

export function Panel({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cx("rounded-[14px] border border-line bg-panel", className)} {...rest}>
      {children}
    </section>
  );
}

export function PanelHeader({ title, id, children }: { title: string; id?: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-5 py-[18px]">
      <h2 id={id} className="m-0 flex-grow text-base font-semibold">
        {title}
      </h2>
      {children}
    </div>
  );
}

export function Chip({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return <span className={cx("rounded-md bg-chip px-2 py-[3px] text-[11px] text-chip-ink", mono && "font-mono")}>{children}</span>;
}

export function Progress({ value, tone = "accent" }: { value: number; tone?: "accent" | "info" }) {
  return (
    <div
      className="h-1.5 flex-grow rounded-[3px] bg-line-2"
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cx("h-1.5 rounded-[3px]", tone === "accent" ? "bg-accent" : "bg-info")}
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </div>
  );
}

const POSTER_TONES = [
  ["#2b3a55", "#cfe0ff"],
  ["#3a3226", "#f3dcb8"],
  ["#26383a", "#c4ecef"],
  ["#3d2f22", "#f6d2ad"],
  ["#33284a", "#ddd0ff"],
];

/** Poster image, or a colored tile with initials like in the design. */
export function Poster({ title, src, size = "md" }: { title?: string; src?: string; size?: "sm" | "md" | "lg" }) {
  const dims = size === "sm" ? "h-8 w-[22px]" : size === "lg" ? "h-[84px] w-14" : "h-16 w-11";
  if (src) return <img src={src} alt="" className={cx(dims, "flex-shrink-0 rounded-md object-cover")} loading="lazy" />;
  const t = title ?? "?";
  const initials =
    t
      .replace(/^(the|der|die|das)\s+/i, "")
      .split(/[\s\-:]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  const [bg, fg] = POSTER_TONES[[...t].reduce((a, c) => a + c.charCodeAt(0), 0) % POSTER_TONES.length]!;
  return (
    <div
      className={cx(dims, "flex flex-shrink-0 items-end rounded-md p-1.5 text-[10px] font-semibold")}
      style={{ background: bg, color: fg }}
      aria-hidden="true"
    >
      {size !== "sm" && initials}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center gap-4">
      <div className="flex min-w-0 flex-grow flex-col gap-0.5">
        <h1 className="m-0 font-display text-[30px] font-bold tracking-[-0.02em]">{title}</h1>
        {subtitle && <div className="text-sm text-muted">{subtitle}</div>}
      </div>
      {children}
    </header>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">
      {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] text-muted">
        {label}
      </label>
      {children}
      {hint && <div className="text-xs text-faint">{hint}</div>}
    </div>
  );
}

export const inputClass = "h-9 rounded-lg border border-line-3 bg-field px-3 text-[13px] text-ink placeholder:text-faint";
