// Server configuration from environment variables. Values are never logged; only names.

export class ConfigError extends Error {
  constructor(missing) { super('Missing or invalid configuration: ' + missing.join(', ')); this.name = 'ConfigError'; this.missing = missing; }
}

export function loadConfig(env = process.env) {
  return {
    databaseUrl: env.DATABASE_URL || '',
    sessionSecret: env.SESSION_SECRET || '',
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
    appOrigin: (env.APP_ORIGIN || '').replace(/\/+$/, ''),
    allowedEmailDomains: env.ALLOWED_EMAIL_DOMAINS || ''
  };
}

// Throws ConfigError naming (never showing) any missing values.
export function requireConfig(config, names) {
  const missing = names.filter(name => {
    const value = config[name];
    if (name === 'sessionSecret') return typeof value !== 'string' || value.length < 32;
    if (name === 'appOrigin') { try { return new URL(value).origin !== value; } catch { return true; } }
    return !value;
  });
  if (missing.length) throw new ConfigError(missing.map(envName));
}

const envName = key => ({ databaseUrl: 'DATABASE_URL', sessionSecret: 'SESSION_SECRET', googleClientId: 'GOOGLE_CLIENT_ID', googleClientSecret: 'GOOGLE_CLIENT_SECRET', appOrigin: 'APP_ORIGIN' })[key] || key;
