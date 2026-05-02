export { formatHoursMinutes } from "@/components/shared/format";

export interface ProjectOption {
  id: string;
  name: string;
  clientName: string;
  rate: string;
}

export interface ServiceOption {
  id: string;
  name: string;
  defaultRate: string | null;
  isActive: boolean;
}

export const PROJECT_PALETTE = [
  '#cf3339', '#3b82f6', '#22c55e', '#f59e0b',
  '#8b5cf6', '#14b8a6', '#ec4899', '#f97316',
];

export function getProjectColor(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) hash = ((hash << 5) - hash) + projectId.charCodeAt(i);
  return PROJECT_PALETTE[Math.abs(hash) % PROJECT_PALETTE.length];
}

export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  const hmMatch = s.match(/^(\d+)h\s*(\d+)?\s*m?$/);
  if (hmMatch) return parseInt(hmMatch[1]) * 60 + parseInt(hmMatch[2] || '0');
  const colonMatch = s.match(/^(\d+):(\d{1,2})$/);
  if (colonMatch) return parseInt(colonMatch[1]) * 60 + parseInt(colonMatch[2]);
  const minMatch = s.match(/^(\d+)\s*m(in)?$/);
  if (minMatch) return parseInt(minMatch[1]);
  const decMatch = s.match(/^(\d+\.?\d*)h?$/);
  if (decMatch) { const h = parseFloat(decMatch[1]); return Math.round(h * 60); }
  return null;
}

export function formatMinutesShort(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}
