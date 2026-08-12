import {
  Building2,
  LayoutDashboard,
  Mail,
  type LucideIcon,
} from "lucide-react";

export interface CoachNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Navigation items shared by the desktop sidebar and the mobile drawer. */
export const coachNavItems: CoachNavItem[] = [
  { href: "/coach/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/coach/companies", label: "Companies", icon: Building2 },
  { href: "/coach/outreach", label: "Outreach", icon: Mail },
];
