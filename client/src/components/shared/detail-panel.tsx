import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { Button } from "@/components/ui/button";
import { ArrowLeft, X } from "lucide-react";
import { AvatarInitials } from "./avatar-initials";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DetailPanelProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  avatar?: string;
  avatarImage?: string | null;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function DetailPanel({ open, onClose, title, subtitle, avatar, avatarImage, actions, children }: DetailPanelProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        hideClose
        aria-describedby={undefined}
        className="sm:max-w-[90vw] lg:max-w-[85vw] xl:max-w-[80vw] max-h-[90vh] p-0 gap-0 overflow-hidden"
        style={{ background: "var(--lux-surface)" }}
      >
        <VisuallyHidden.Root>
          <DialogTitle>{title}</DialogTitle>
        </VisuallyHidden.Root>
        <div
          className="flex items-center gap-2 px-5 py-3 border-b"
          style={{ borderColor: "var(--lux-border)" }}
        >
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8" data-testid="button-panel-back" aria-label="Back">
            <ArrowLeft size={16} />
          </Button>
          <span className="text-xs font-medium" style={{ color: "var(--lux-text-muted)" }}>
            Back
          </span>
          <div className="flex-1" />
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8" aria-label="Close panel">
            <X size={16} />
          </Button>
        </div>

        <ScrollArea className="flex-1 max-h-[calc(90vh-60px)]">
          <div className="p-6 space-y-6">
            <div className="flex items-start gap-4">
              {avatar && <AvatarInitials name={avatar} size="lg" imageUrl={avatarImage} />}
              <div className="flex-1 min-w-0">
                <h2 className="text-xl font-bold truncate" style={{ color: "var(--lux-text)" }}>
                  {title}
                </h2>
                {subtitle && (
                  <p className="text-sm truncate" style={{ color: "var(--lux-text-muted)" }}>
                    {subtitle}
                  </p>
                )}
              </div>
              {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
            </div>

            {children}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
