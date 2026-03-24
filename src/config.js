const env = import.meta.env

import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = 'https://cobahehmpstttmnzmnky.supabase.co'
export const supabaseAnonKey = 'sb_publishable_RaogkZ-7uzmWSFNlXoTUcQ_htDPyrQw'
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const APP_CONFIG = {
  appName: env.VITE_APP_NAME || 'Ledger',
  tagline: env.VITE_APP_TAGLINE || 'Track Credits & Debits',
  developerName: env.VITE_DEVELOPER_NAME || 'Ajith Reddy',
  auth: {
    username: env.VITE_LOGIN_USERNAME || '',
    password: env.VITE_LOGIN_PASSWORD || '',
  },
}
