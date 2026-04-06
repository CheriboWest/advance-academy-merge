/**
 * Pure cosine similarity utilities — no external dependencies.
 */

/**
 * Returns cosine similarity between two vectors in the range [0, 1].
 * Returns 0 if either vector has zero magnitude.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  magA = Math.sqrt(magA);
  magB = Math.sqrt(magB);

  if (magA === 0 || magB === 0) return 0;

  return dot / (magA * magB);
}

/**
 * Computes the mean cosine similarity across all CV-JD vector pairings.
 * Returns a 0–100 score (raw similarity × 100, rounded to nearest integer).
 */
export function averageSimilarity(cvVectors: number[][], jdVectors: number[][]): number {
  if (cvVectors.length === 0 || jdVectors.length === 0) return 0;

  let total = 0;
  let count = 0;

  for (const cv of cvVectors) {
    for (const jd of jdVectors) {
      total += cosineSimilarity(cv, jd);
      count++;
    }
  }

  const mean = count > 0 ? total / count : 0;
  return Math.round(mean * 100);
}
