export interface ExperienceEntry {
  role: string;
  company: string;
  dates: string;
  bullets: string[];
}

export interface ParsedCV {
  /** Full raw text of the CV for LLM context. */
  fullText: string;
  /** Professional summary / profile statement. */
  summary: string;
  /** Flat list of skills (tools, languages, frameworks, soft skills). */
  skills: string[];
  /** Structured work experience entries. */
  experience: ExperienceEntry[];
  /** Extracted metric strings, e.g. "50% reduction", "$2M revenue". */
  metrics: string[];
}

export interface ParsedJD {
  /** Full raw text of the JD for LLM context. */
  fullText: string;
  /** Keywords from the job title itself (e.g. "Senior", "React", "Engineer"). */
  titleKeywords: string[];
  /** Keywords extracted from the JD body (technologies, methods, tools). */
  bodyKeywords: string[];
  /** Must-have skills / requirements. */
  requiredSkills: string[];
  /** Preferred but optional skills. */
  niceToHave: string[];
}
