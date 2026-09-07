/** Account scheduled for deletion: shown in every authenticated shell, including the inactive-plan screen. */
import { useState } from "react";
import { AlertTriangle, X as XIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useBillingStatus } from "@/hooks/use-billing-status";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function DeletionBanner() {
  const { data: billing } = useBillingStatus();
  const [dismissed, setDismissed] = useState(false);
  const { user } = useAuth();
  const [cancelling, setCancelling] = useState(false);
  const { toast } = useToast();

  if (dismissed || !billing?.deletionScheduledFor) return null;

  const scheduledDate = new Date(billing.deletionScheduledFor);
  const daysLeft = Math.max(0, Math.ceil((scheduledDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  const formattedDate = scheduledDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await apiRequest("POST", "/api/account/cancel-deletion");
      queryClient.invalidateQueries({ queryKey: ["/api/billing/status"] });
      toast({ title: "Deletion cancelled", description: "Your account deletion has been cancelled." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Failed to cancel deletion", variant: "destructive" });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 text-sm" style={{ background: "#fef2f2", borderBottom: "1px solid #fecaca" }} data-testid="banner-deletion-pending">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
        <span className="text-red-800">
          Account scheduled for deletion on <strong>{formattedDate}</strong> ({daysLeft} day{daysLeft !== 1 ? "s" : ""} remaining).
        </span>
        {user?.role === "ADMIN" && (
          <button
            className="ml-2 text-red-700 underline hover:text-red-900 font-medium"
            onClick={handleCancel}
            disabled={cancelling}
            data-testid="button-cancel-deletion"
          >
            {cancelling ? "Cancelling..." : "Cancel deletion"}
          </button>
        )}
      </div>
      <button onClick={() => setDismissed(true)} className="text-red-400 hover:text-red-600 ml-2" data-testid="button-dismiss-deletion-banner">
        <XIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
