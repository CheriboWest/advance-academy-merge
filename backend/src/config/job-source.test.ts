import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getJobSourceMode,
  getJobSourceTimeoutMs,
  getJobCacheTtlMs,
  getJobFreshnessMaxDays,
  getJobFreshnessHardCapDays,
  getJobMaxRoleQueries,
  isJobLivenessEnabled,
} from './job-source.js';

/** Run `fn` with a temporary env value for `key`, restoring it afterwards. */
function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

test('getJobSourceMode: default is hybrid when unset', () => {
  withEnv('DREAM_JOB_SOURCE', undefined, () => {
    assert.equal(getJobSourceMode(), 'hybrid');
  });
});

test('getJobSourceMode: accepts the three known modes (case/space insensitive)', () => {
  withEnv('DREAM_JOB_SOURCE', 'hybrid', () => assert.equal(getJobSourceMode(), 'hybrid'));
  withEnv('DREAM_JOB_SOURCE', 'ADZUNA_REED', () => assert.equal(getJobSourceMode(), 'adzuna_reed'));
  withEnv('DREAM_JOB_SOURCE', '  exa  ', () => assert.equal(getJobSourceMode(), 'exa'));
});

test('getJobSourceMode: unknown value falls back to hybrid', () => {
  withEnv('DREAM_JOB_SOURCE', 'garbage', () => {
    assert.equal(getJobSourceMode(), 'hybrid');
  });
});

test('getJobSourceTimeoutMs: default 8000, override respected, invalid → default', () => {
  withEnv('JOB_SOURCE_TIMEOUT_MS', undefined, () => assert.equal(getJobSourceTimeoutMs(), 8000));
  withEnv('JOB_SOURCE_TIMEOUT_MS', '5000', () => assert.equal(getJobSourceTimeoutMs(), 5000));
  withEnv('JOB_SOURCE_TIMEOUT_MS', 'nope', () => assert.equal(getJobSourceTimeoutMs(), 8000));
  withEnv('JOB_SOURCE_TIMEOUT_MS', '-3', () => assert.equal(getJobSourceTimeoutMs(), 8000));
});

test('getJobCacheTtlMs: default 20 min, override respected', () => {
  withEnv('JOB_CACHE_TTL_MS', undefined, () => assert.equal(getJobCacheTtlMs(), 1_200_000));
  withEnv('JOB_CACHE_TTL_MS', '60000', () => assert.equal(getJobCacheTtlMs(), 60_000));
});

test('getJobFreshnessMaxDays: default 7, override respected', () => {
  withEnv('JOB_FRESHNESS_MAX_DAYS', undefined, () => assert.equal(getJobFreshnessMaxDays(), 7));
  withEnv('JOB_FRESHNESS_MAX_DAYS', '2', () => assert.equal(getJobFreshnessMaxDays(), 2));
});

test('getJobFreshnessHardCapDays: default 30, override respected', () => {
  withEnv('JOB_FRESHNESS_HARD_CAP_DAYS', undefined, () => assert.equal(getJobFreshnessHardCapDays(), 30));
  withEnv('JOB_FRESHNESS_HARD_CAP_DAYS', '14', () => assert.equal(getJobFreshnessHardCapDays(), 14));
});

test('getJobMaxRoleQueries: default 6, override respected', () => {
  withEnv('JOB_MAX_ROLE_QUERIES', undefined, () => assert.equal(getJobMaxRoleQueries(), 6));
  withEnv('JOB_MAX_ROLE_QUERIES', '1', () => assert.equal(getJobMaxRoleQueries(), 1));
});

test('isJobLivenessEnabled: default true, disabled by false/0/no', () => {
  withEnv('JOB_LIVENESS_ENABLED', undefined, () => assert.equal(isJobLivenessEnabled(), true));
  withEnv('JOB_LIVENESS_ENABLED', 'false', () => assert.equal(isJobLivenessEnabled(), false));
  withEnv('JOB_LIVENESS_ENABLED', '0', () => assert.equal(isJobLivenessEnabled(), false));
  withEnv('JOB_LIVENESS_ENABLED', 'true', () => assert.equal(isJobLivenessEnabled(), true));
});
