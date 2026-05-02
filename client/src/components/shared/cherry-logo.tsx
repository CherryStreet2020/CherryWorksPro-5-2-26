import cherryIconRed from "@assets/cherry-icon-red.png";

export function CherryLogo({ size = 20, className = "" }: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={cherryIconRed}
      alt="CherryWorks Pro"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
