import pino from 'pino';

/**
 * All logs go to stderr. stdout is reserved for the NDJSON protocol stream —
 * writing logs there would corrupt frames read by the consuming agent.
 *
 * Set LOG_PRETTY=1 for human-readable output during development (requires the
 * optional pino-pretty devDependency).
 */
const options: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'token', 'auth', 'GITHUB_TOKEN'],
    censor: '***REDACTED***',
  },
  base: { service: 'pi-github' },
};

export const logger: pino.Logger =
  process.env.LOG_PRETTY === '1'
    ? pino({ ...options, transport: { target: 'pino-pretty', options: { destination: 2 } } })
    : pino(options, pino.destination(2));
