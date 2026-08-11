/**
 * In-memory mock data for the public student portal.
 *
 * This milestone ships with mock data only — no Supabase, API, or real search.
 * The shapes here mirror `@careerhub/types` so swapping in real data later is a
 * drop-in change.
 */

export type UkLocation =
  | "London"
  | "Manchester"
  | "Birmingham"
  | "Leeds"
  | "Remote";

export type Sector =
  | "Technology"
  | "Finance"
  | "Education"
  | "Retail"
  | "Healthcare";

export interface Company {
  id: string;
  slug: string;
  name: string;
  location: UkLocation;
  sector: Sector;
  website: string;
  careersUrl: string;
  description: string;
  /** Outreach lead score, 0–100. */
  leadScore: number;
}

export interface Job {
  id: string;
  companyId: string;
  title: string;
  location: UkLocation;
  /** Optional — not every listing publishes a salary. */
  salary?: string;
  /** ISO 8601 date the role was posted. */
  postedDate: string;
  url: string;
}

export const companies: Company[] = [
  {
    id: "c1",
    slug: "technova-solutions",
    name: "TechNova Solutions",
    location: "London",
    sector: "Technology",
    website: "https://technova.example.com",
    careersUrl: "https://technova.example.com/careers",
    description:
      "A fast-growing London software studio building developer tooling and cloud platforms for UK scale-ups. Strong graduate and internship programme.",
    leadScore: 85,
  },
  {
    id: "c2",
    slug: "finora-digital-bank",
    name: "Finora Digital Bank",
    location: "Manchester",
    sector: "Finance",
    website: "https://finora.example.com",
    careersUrl: "https://finora.example.com/careers",
    description:
      "A challenger digital bank reimagining everyday money for students and young professionals across the UK. Hiring across engineering, risk, and design.",
    leadScore: 55,
  },
  {
    id: "c3",
    slug: "brightpath-edtech",
    name: "BrightPath EdTech",
    location: "Birmingham",
    sector: "Education",
    website: "https://brightpath.example.com",
    careersUrl: "https://brightpath.example.com/jobs",
    description:
      "An education technology company helping UK schools and universities deliver personalised learning. Mission-driven team with a strong early-careers focus.",
    leadScore: 20,
  },
  {
    id: "c4",
    slug: "greenleaf-retail",
    name: "GreenLeaf Retail",
    location: "Leeds",
    sector: "Retail",
    website: "https://greenleaf.example.com",
    careersUrl: "https://greenleaf.example.com/careers",
    description:
      "A sustainability-first retailer operating stores and e-commerce nationwide. Roles span supply chain, data, and store operations.",
    leadScore: 0,
  },
  {
    id: "c5",
    slug: "medicare-plus",
    name: "MediCare Plus",
    location: "Remote",
    sector: "Healthcare",
    website: "https://medicareplus.example.com",
    careersUrl: "https://medicareplus.example.com/careers",
    description:
      "A remote-first healthcare provider delivering digital-first patient care across the UK. Hiring clinical, product, and engineering talent.",
    leadScore: 55,
  },
];

export const jobs: Job[] = [
  {
    id: "j1",
    companyId: "c1",
    title: "Graduate Software Engineer",
    location: "London",
    salary: "£38,000 – £45,000",
    postedDate: "2026-08-04",
    url: "https://technova.example.com/careers/graduate-software-engineer",
  },
  {
    id: "j2",
    companyId: "c1",
    title: "Frontend Developer (React)",
    location: "Remote",
    salary: "£45,000 – £55,000",
    postedDate: "2026-07-29",
    url: "https://technova.example.com/careers/frontend-developer",
  },
  {
    id: "j3",
    companyId: "c2",
    title: "Data Analyst, Risk",
    location: "Manchester",
    salary: "£40,000 – £48,000",
    postedDate: "2026-08-01",
    url: "https://finora.example.com/careers/data-analyst-risk",
  },
  {
    id: "j4",
    companyId: "c2",
    title: "Product Design Intern",
    location: "Manchester",
    postedDate: "2026-07-22",
    url: "https://finora.example.com/careers/product-design-intern",
  },
  {
    id: "j5",
    companyId: "c3",
    title: "Junior Product Manager",
    location: "Birmingham",
    salary: "£32,000 – £38,000",
    postedDate: "2026-08-06",
    url: "https://brightpath.example.com/jobs/junior-product-manager",
  },
  {
    id: "j6",
    companyId: "c4",
    title: "Supply Chain Graduate Scheme",
    location: "Leeds",
    salary: "£30,000",
    postedDate: "2026-07-18",
    url: "https://greenleaf.example.com/careers/supply-chain-graduate-scheme",
  },
  {
    id: "j7",
    companyId: "c5",
    title: "Backend Engineer (Python)",
    location: "Remote",
    salary: "£55,000 – £70,000",
    postedDate: "2026-08-08",
    url: "https://medicareplus.example.com/careers/backend-engineer-python",
  },
  {
    id: "j8",
    companyId: "c5",
    title: "Clinical Operations Associate",
    location: "Remote",
    postedDate: "2026-07-31",
    url: "https://medicareplus.example.com/careers/clinical-operations-associate",
  },
];

/** All distinct sectors present in the dataset, for filter dropdowns. */
export const sectors: Sector[] = [
  "Technology",
  "Finance",
  "Education",
  "Retail",
  "Healthcare",
];

/** All distinct locations present in the dataset, for filter dropdowns. */
export const locations: UkLocation[] = [
  "London",
  "Manchester",
  "Birmingham",
  "Leeds",
  "Remote",
];

/** Count of open jobs for a given company. */
export function countOpenJobs(companyId: string): number {
  return jobs.filter((job) => job.companyId === companyId).length;
}

/** All open jobs for a given company. */
export function getJobsForCompany(companyId: string): Job[] {
  return jobs.filter((job) => job.companyId === companyId);
}

/** Look up a single company by its URL slug. */
export function getCompanyBySlug(slug: string): Company | undefined {
  return companies.find((company) => company.slug === slug);
}

/** A company enriched with its open-job count, as consumed by list views. */
export interface CompanyWithJobCount extends Company {
  openJobs: number;
}

/** Companies decorated with their open-job counts. */
export function getCompaniesWithJobCounts(): CompanyWithJobCount[] {
  return companies.map((company) => ({
    ...company,
    openJobs: countOpenJobs(company.id),
  }));
}
