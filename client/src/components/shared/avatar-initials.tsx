import { useState, useEffect } from "react";

const AVATAR_COLORS = [
  "#ef4444", "#f97316", "#f59e0b", "#22c55e", "#14b8a6",
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#06b6d4",
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

interface AvatarInitialsProps {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  color?: string;
  imageUrl?: string | null;
}

const sizeMap = {
  xs: { dim: 24, text: "text-[10px]" },
  sm: { dim: 32, text: "text-xs" },
  md: { dim: 40, text: "text-sm" },
  lg: { dim: 48, text: "text-base" },
};

export function AvatarInitials({ name, size = "md", color, imageUrl }: AvatarInitialsProps) {
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [imageUrl]);
  const bg = color || AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length];
  const { dim, text } = sizeMap[size];
  const testId = `avatar-${name.toLowerCase().replace(/\s+/g, "-")}`;

  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={name}
        onError={() => setImgError(true)}
        className="rounded-full shrink-0 object-cover"
        style={{ width: dim, height: dim, background: "#f3f4f6" }}
        data-testid={testId}
      />
    );
  }

  return (
    <div
      className={`inline-flex items-center justify-center rounded-full font-bold text-white shrink-0 ${text}`}
      style={{ width: dim, height: dim, backgroundColor: bg }}
      data-testid={testId}
    >
      {getInitials(name)}
    </div>
  );
}
