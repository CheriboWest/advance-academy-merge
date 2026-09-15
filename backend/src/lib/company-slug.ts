/**
 * career-hub's company slug rule, ported to TypeScript.
 *
 * `public.companies` is shared by both halves of this app after migration
 * 024_ch0001. career-hub's crawler writes thousands of rows keyed by a unique
 * `slug`, derived in Python (backend-python/app/crawler/normalize.py). This
 * side has to derive the same slug from the same name or it will either miss an
 * existing company or insert a duplicate that violates `companies_slug_key`.
 *
 * Two implementations of one rule drift. `company-slug.cases.json` pins them
 * together: company-slug.test.ts asserts this file against it, and
 * backend-python/test_company_slug_parity.py asserts the Python against the
 * same file, so a change on either side fails a test rather than quietly
 * splitting the company table in two.
 *
 * ponytail: ported rather than shared, because the alternative is either an
 * HTTP hop to the Python service for one insert, or rewriting the crawler's
 * hot path to call a SQL function. If a third caller ever needs this, move it
 * into Postgres and have both sides call that instead.
 */

/** Trailing legal/structural words dropped so "8th Light Ltd" == "8th Light". */
const LEGAL_SUFFIXES = new Set([
  'ltd', 'limited', 'llc', 'inc', 'incorporated', 'plc', 'llp', 'co',
  'company', 'corp', 'corporation', 'gmbh', 'group', 'holdings', 'uk',
]);

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function companyWords(name: string): string[] {
  let text = stripHtml(name).toLowerCase();
  text = text.replace(/[.,&/]/g, ' ');
  // `-` is last in the class, so it is a literal hyphen, not a range.
  text = text.replace(/[^a-z0-9\s-]/g, '');
  text = text.replace(/-/g, ' ');
  const words = text.split(/\s+/).filter(Boolean);
  // More than one can trail: "Acme Holdings Group Ltd" -> "acme".
  while (words.length > 0 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) {
    words.pop();
  }
  return words;
}

/**
 * Canonical slug for a company display name.
 *
 * Falls back rather than returning empty: a name that is *only* legal suffixes
 * ("Ltd") keeps them, and a name with no usable characters ("!!!") becomes
 * "company" — matching the Python, which would otherwise write a null slug and
 * lose the uniqueness guarantee.
 */
export function companySlug(name: string): string {
  const slug = companyWords(name).join('-');
  if (slug) return slug;
  const fallback = stripHtml(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return fallback || 'company';
}
