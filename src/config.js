const env = import.meta.env

export const APP_CONFIG = {
  appName: env.VITE_APP_NAME || 'Ledger',
  tagline: env.VITE_APP_TAGLINE || 'Track Credits & Debits',
  developerName: env.VITE_DEVELOPER_NAME || 'Ajith Reddy',
  auth: {
    username: env.VITE_LOGIN_USERNAME || '',
    password: env.VITE_LOGIN_PASSWORD || '',
  },
}
