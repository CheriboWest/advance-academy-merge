import {
  Building2,
  LayoutDashboard,
  Mail,
  Radar,
  Search,
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
  { href: "/coach/crawler", label: "Crawler", icon: Radar },
  { href: "/coach/outreach", label: "Outreach", icon: Mail },
  // Shared search surface. Job Role Search here respects this coach's hidden
  // companies (see lib/role-search.ts).
  { href: "/search?mode=role", label: "Job search", icon: Search },
];
