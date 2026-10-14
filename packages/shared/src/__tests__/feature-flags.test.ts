import { describe, it, expect, afterEach } from 'bun:test';
import { isDevRuntime, isDeveloperFeedbackEnabled, isTokenBirdCliEnabled, isEmbeddedServerEnabled } from '../feature-flags.ts';

const ORIGINAL_ENV = {
  NODE_ENV: process.env.NODE_ENV,
  TOKENBIRD_DEBUG: process.env.TOKENBIRD_DEBUG,
  TOKENBIRD_FEATURE_DEVELOPER_FEEDBACK: process.env.TOKENBIRD_FEATURE_DEVELOPER_FEEDBACK,
  TOKENBIRD_FEATURE_CLI: process.env.TOKENBIRD_FEATURE_CLI,
  TOKENBIRD_FEATURE_EMBEDDED_SERVER: process.env.TOKENBIRD_FEATURE_EMBEDDED_SERVER,
};

afterEach(() => {
  if (ORIGINAL_ENV.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = ORIGINAL_ENV.NODE_ENV;

  if (ORIGINAL_ENV.TOKENBIRD_DEBUG === undefined) delete process.env.TOKENBIRD_DEBUG;
  else process.env.TOKENBIRD_DEBUG = ORIGINAL_ENV.TOKENBIRD_DEBUG;

  if (ORIGINAL_ENV.TOKENBIRD_FEATURE_DEVELOPER_FEEDBACK === undefined) delete process.env.TOKENBIRD_FEATURE_DEVELOPER_FEEDBACK;
  else process.env.TOKENBIRD_FEATURE_DEVELOPER_FEEDBACK = ORIGINAL_ENV.TOKENBIRD_FEATURE_DEVELOPER_FEEDBACK;

  if (ORIGINAL_ENV.TOKENBIRD_FEATURE_CLI === undefined) delete process.env.TOKENBIRD_FEATURE_CLI;
  else process.env.TOKENBIRD_FEATURE_CLI = ORIGINAL_ENV.TOKENBIRD_FEATURE_CLI;

  if (ORIGINAL_ENV.TOKENBIRD_FEATURE_EMBEDDED_SERVER === undefined) delete process.env.TOKENBIRD_FEATURE_EMBEDDED_SERVER;
  else process.env.TOKENBIRD_FEATURE_EMBEDDED_SERVER = ORIGINAL_ENV.TOKENBIRD_FEATURE_EMBEDDED_SERVER;
});

describe('feature-flags runtime helpers', () => {
  it('isDevRuntime returns true for explicit dev NODE_ENV', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.TOKENBIRD_DEBUG;

    expect(isDevRuntime()).toBe(true);
  });

  it('isDevRuntime returns true for TOKENBIRD_DEBUG override', () => {
    process.env.NODE_ENV = 'production';
    process.env.TOKENBIRD_DEBUG = '1';

    expect(isDevRuntime()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled honors explicit override false', () => {
    process.env.NODE_ENV = 'development';
    process.env.TOKENBIRD_FEATURE_DEVELOPER_FEEDBACK = '0';

    expect(isDeveloperFeedbackEnabled()).toBe(false);
  });

  it('isDeveloperFeedbackEnabled honors explicit override true', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.TOKENBIRD_DEBUG;
    process.env.TOKENBIRD_FEATURE_DEVELOPER_FEEDBACK = '1';

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isDeveloperFeedbackEnabled falls back to dev runtime when no override', () => {
    process.env.NODE_ENV = 'production';
    process.env.TOKENBIRD_DEBUG = '1';
    delete process.env.TOKENBIRD_FEATURE_DEVELOPER_FEEDBACK;

    expect(isDeveloperFeedbackEnabled()).toBe(true);
  });

  it('isTokenBirdCliEnabled defaults to false when no override is set', () => {
    delete process.env.TOKENBIRD_FEATURE_CLI;

    expect(isTokenBirdCliEnabled()).toBe(false);
  });

  it('isTokenBirdCliEnabled honors explicit override true', () => {
    process.env.TOKENBIRD_FEATURE_CLI = '1';

    expect(isTokenBirdCliEnabled()).toBe(true);
  });

  it('isTokenBirdCliEnabled honors explicit override false', () => {
    process.env.TOKENBIRD_FEATURE_CLI = '0';

    expect(isTokenBirdCliEnabled()).toBe(false);
  });

  it('isEmbeddedServerEnabled defaults to true when no override is set', () => {
    delete process.env.TOKENBIRD_FEATURE_EMBEDDED_SERVER;

    expect(isEmbeddedServerEnabled()).toBe(true);
  });

  it('isEmbeddedServerEnabled honors explicit override true', () => {
    process.env.TOKENBIRD_FEATURE_EMBEDDED_SERVER = '1';

    expect(isEmbeddedServerEnabled()).toBe(true);
  });

  it('isEmbeddedServerEnabled honors explicit override false', () => {
    process.env.TOKENBIRD_FEATURE_EMBEDDED_SERVER = '0';

    expect(isEmbeddedServerEnabled()).toBe(false);
  });
});
