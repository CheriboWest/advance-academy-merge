import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getJobSourceMode,
  getJobSourceTimeoutMs,
  getJobCacheTtlMs,
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
