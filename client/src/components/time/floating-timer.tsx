import { Button } from "@/components/ui/button";
import { Square, X } from "lucide-react";
import { getProjectColor } from "./utils";
import type { ProjectOption } from "./utils";

interface FloatingTimerProps {
  timerRunning: boolean;
  timerElapsed: number;
  timerProject: string;
  myProjects: ProjectOption[] | undefined;
  onStop: () => void;
  onDiscard: () => void;
}

function formatTimerDisplay(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function FloatingTimer({ timerRunning, timerElapsed, timerProject, myProjects, onStop, onDiscard }: FloatingTimerProps) {
  if (!timerRunning) return null;

  return (
    <div
      className="sticky top-0 z-30 flex items-center justify-between gap-4 px-5 py-3 rounded-xl"
      style={{
        background: "var(--lux-surface)",
        boxShadow: "0 0 20px var(--color-accent-glow), var(--lux-card-shadow-hover)",
        border: "1px solid var(--color-accent-glow)",
      }}
      data-testid="bar-floating-timer"
    >
      <div className="flex items-center gap-3">
        <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" style={{ animation: "pulse 1.5s ease-in-out infinite" }} />
        <span
          className="text-2xl font-bold tabular-nums"
          style={{ color: "var(--lux-text)" }}
          data-testid="text-timer-display"
        >
          {formatTimerDisplay(timerElapsed)}
        </span>
        <span className="flex items-center gap-1.5 text-sm" style={{ color: "var(--lux-text-secondary)" }}>
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: getProjectColor(timerProject) }} />
          {myProjects?.find(p => p.id === timerProject)?.name || "Project"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="text-white"
          style={{ background: "var(--gradient-brand)" }}
          onClick={onStop}
          data-testid="button-stop-timer"
        >
          <Square className="w-3.5 h-3.5 mr-1" />
          Stop & Log
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onDiscard}
          data-testid="button-discard-timer"
          aria-label="Discard timer"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
