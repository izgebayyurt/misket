import { useTranslation } from "react-i18next";
import { PALETTE } from "@/core/codeTree";
import { cn } from "@/lib/utils";

export function ColorDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2.5 shrink-0 rounded-full", className)}
      style={{ background: color }}
      aria-hidden
    />
  );
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex flex-wrap gap-1.5"
      role="radiogroup"
      aria-label={t("analysis.clustering.colorLabel")}
    >
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toUpperCase() === c}
          onClick={() => onChange(c)}
          className={cn(
            "size-6 rounded-full border-2 border-transparent",
            value.toUpperCase() === c && "border-fg",
          )}
          style={{ background: c }}
          title={c}
        />
      ))}
    </div>
  );
}
