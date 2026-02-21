import winston from 'winston';

const REDACTION_PATTERN = /(token|secret|key|password)/i;
const REDACTED_VALUE = '[REDACTED]';

export function redactSensitiveData<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item)) as T;
  }

  if (value !== null && typeof value === 'object') {
    const redacted: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      redacted[key] = REDACTION_PATTERN.test(key)
        ? REDACTED_VALUE
        : redactSensitiveData(nestedValue);
    }

    return redacted as T;
  }

  return value;
}

const redactMetadataFormat = winston.format((info) => {
  return redactSensitiveData(info) as winston.Logform.TransformableInfo;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(winston.format.timestamp(), redactMetadataFormat(), winston.format.json()),
  transports: [new winston.transports.Console()]
});
