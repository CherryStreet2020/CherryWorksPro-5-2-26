import { CherryLogo } from "@/components/shared/cherry-logo";

export function BrandLockup({
  iconSize = 34,
  textSize = "base",
}: {
  iconSize?: number;
  textSize?: "sm" | "base" | "lg";
}) {
  const textClass =
    textSize === "sm" ? "text-sm" : textSize === "lg" ? "text-lg" : "text-base";
  const proClass =
    textSize === "sm" ? "text-[9px]" : textSize === "lg" ? "text-[11px]" : "text-[10px]";

  return (
    <div className="flex items-center gap-2.5">
      <CherryLogo size={iconSize} />
      <div>
        <span className={`${textClass} font-bold tracking-tight text-white`}>CherryWorks</span>
        <span
          className={`${proClass} font-bold uppercase tracking-widest ml-1`}
          style={{ color: "#cf3339" }}
        >
          Pro
        </span>
      </div>
    </div>
  );
}
