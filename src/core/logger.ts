import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'GITHUB_TOKEN', 'token'],
    censor: '***REDACTED***'
  },
  base: { service: 'pi-github-agent' }
});