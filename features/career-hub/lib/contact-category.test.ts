import { describe, expect, it } from "vitest";

import { contactCategory } from "@advance-academy/contracts/contacts";

describe("contactCategory", () => {
  it.each([
    ["Talent Acquisition Partner", "recruiter"],
    ["Head of Talent", "recruiter"],
    ["Graduate Recruitment Lead", "recruiter"],
    ["HR Business Partner", "hr"],
    ["Chief People Officer", "hr"],
    ["Human Resources Manager", "hr"],
    ["Co-Founder & CEO", "leadership"],
    ["Managing Director", "leadership"],
    ["Engineering Director", "department_head"],
    ["Head of Marketing", "department_head"],
    ["VP Sales", "department_head"],
    ["Data Engineering Manager", "hiring_manager"],
    ["Team Lead, Analytics", "hiring_manager"],
    ["Software Engineer", "other"],
  ])("%s → %s", (title, expected) => {
    expect(contactCategory(title)).toBe(expected);
  });

  it("treats a missing title as other", () => {
    expect(contactCategory(null)).toBe("other");
    expect(contactCategory("  ")).toBe("other");
  });
});
