import { CherryLogo } from "@/components/shared/cherry-logo";

/**
 * `tone` is the background the lockup sits on: "dark" (the default — white
 * wordmark), "light" (ink wordmark), or "auto" (the theme's foreground color,
 * for surfaces that flip with light/dark mode such as the app sidebar).
 */
export function BrandLockup({
  iconSize = 34,
  textSize = "base",
  tone = "dark",
}: {
  iconSize?: number;
  textSize?: "sm" | "base" | "lg";
  tone?: "dark" | "light" | "auto";
}) {
  const textClass =
    textSize === "sm" ? "text-sm" : textSize === "lg" ? "text-lg" : "text-base";
  const proClass =
    textSize === "sm" ? "text-[9px]" : textSize === "lg" ? "text-[11px]" : "text-[10px]";

  const nameClass = tone === "light" ? "text-[#15171C]" : tone === "auto" ? "text-foreground" : "text-white";

  return (
    <div className="flex items-center gap-2.5">
      <CherryLogo size={iconSize} />
      <div>
        <span className={`${textClass} font-bold tracking-tight ${nameClass}`}>CherryWorks</span>
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
