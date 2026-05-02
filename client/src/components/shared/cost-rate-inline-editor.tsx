import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { getCurrencySymbol } from "@/components/shared/format";
import { Pencil } from "lucide-react";

interface CostRateInlineEditorProps {
  projectId: string;
  userId: string;
  teamMemberName: string;
  projectName: string;
  baseCurrency: string;
  triggerVariant?: "warning" | "default";
  invalidateKeys?: readonly (readonly unknown[])[];
}

export function CostRateInlineEditor({
  projectId,
  userId,
  teamMemberName,
  projectName,
  baseCurrency,
  triggerVariant = "warning",
  invalidateKeys,
}: CostRateInlineEditorProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const symbol = getCurrencySymbol(baseCurrency);

  const mutation = useMutation({
    mutationFn: async (rate: number) => {
      await apiRequest("PUT", `/api/projects/${projectId}/members/by-user/${userId}/cost-rate`, {
        costRateHourly: rate,
      });
    },
    onSuccess: () => {
      const keys = invalidateKeys ?? [
        ["/api/payouts/summary"],
        ["/api/projects", projectId],
      ];
      for (const key of keys) {
        queryClient.invalidateQueries({ queryKey: key as unknown[] });
      }
      toast({
        title: "Cost rate saved",
        description: `${teamMemberName} on ${projectName}.`,
      });
      setOpen(false);
      setValue("");
      setError(null);
    },
    onError: (err: Error) => {
      setError(err.message || "Failed to save cost rate");
    },
  });

  function handleSave() {
    const num = Number(value);
    if (!value.trim() || isNaN(num)) {
      setError("Enter a valid number");
      return;
    }
    if (num <= 0) {
      setError("Cost rate must be greater than 0");
      return;
    }
    if (num > 10000) {
      setError("Cost rate cannot exceed 10,000/hr");
      return;
    }
    setError(null);
    mutation.mutate(num);
  }

  const triggerColor = triggerVariant === "warning" ? "#b45309" : undefined;

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setError(null); setValue(""); } }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 ml-0.5 align-middle"
          style={triggerColor ? { color: triggerColor } : undefined}
          aria-label={`Edit cost rate for ${teamMemberName} on ${projectName}`}
          data-testid={`button-edit-cost-rate-${projectId}-${userId}`}
        >
          <Pencil className="w-3 h-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-64 p-3"
        align="start"
        data-testid={`popover-edit-cost-rate-${projectId}-${userId}`}
      >
        <div className="space-y-2">
          <div>
            <p className="text-xs font-semibold" style={{ color: "var(--lux-text)" }}>Set cost rate</p>
            <p className="text-[11px]" style={{ color: "var(--lux-text-muted)" }}>
              {teamMemberName} on {projectName}
            </p>
          </div>
          <div className="relative">
            <span
              className="absolute left-2 top-1/2 -translate-y-1/2 text-xs"
              style={{ color: "var(--lux-text-muted)" }}
            >
              {symbol}
            </span>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              autoFocus
              placeholder="0.00"
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); handleSave(); }
                if (e.key === "Escape") { setOpen(false); }
              }}
              className="h-8 pl-6 pr-12 text-sm"
              data-testid={`input-cost-rate-${projectId}-${userId}`}
            />
            <span
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px]"
              style={{ color: "var(--lux-text-muted)" }}
            >
              /hr
            </span>
          </div>
          {error && (
            <p className="text-[11px]" style={{ color: "#ef4444" }} data-testid={`text-cost-rate-error-${projectId}-${userId}`}>
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setOpen(false)}
              data-testid={`button-cancel-cost-rate-${projectId}-${userId}`}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 text-xs text-white"
              style={{ background: "var(--gradient-brand)" }}
              onClick={handleSave}
              disabled={mutation.isPending}
              data-testid={`button-save-cost-rate-${projectId}-${userId}`}
            >
              {mutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
