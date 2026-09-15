import { CheckCircle2, Clock, MailCheck, TimerReset, XCircle } from "lucide-react";

import type { OutreachDisplayStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

const CONFIG: Record<
  OutreachDisplayStatus,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    variant: "default" | "highlight" | "secondary" | "destructive" | "outline";
  }
> = {
  draft: { label: "Draft", icon: Clock, variant: "outline" },
  sent: { label: "Sent", icon: MailCheck, variant: "secondary" },
  replied: { label: "Replied", icon: CheckCircle2, variant: "highlight" },
  follow_up_due: { label: "Follow-up due", icon: TimerReset, variant: "destructive" },
  closed: { label: "Closed", icon: XCircle, variant: "outline" },
};

export const OUTREACH_STATUS_FILTERS: ReadonlyArray<{
  value: OutreachDisplayStatus;
  label: string;
}> = [
  { value: "sent", label: CONFIG.sent.label },
  { value: "replied", label: CONFIG.replied.label },
  { value: "follow_up_due", label: CONFIG.follow_up_due.label },
  { value: "closed", label: CONFIG.closed.label },
];

interface OutreachStatusBadgeProps {
  status: OutreachDisplayStatus;
}

/** Status pill for one outreach activity row — same five states the
 *  dashboard's filter offers (plus "draft", unused there but kept for
 *  completeness since OutreachDisplayStatus includes it). */
export function OutreachStatusBadge({ status }: OutreachStatusBadgeProps) {
  const config = CONFIG[status];
  const Icon = config.icon;
  return (
    <Badge variant={config.variant}>
      <Icon className="size-3" />
      {config.label}
    </Badge>
  );
}
