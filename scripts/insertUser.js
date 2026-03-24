// Run this script with: node scripts/insertUser.js
// It will insert a user with username 'praveen' and password 'Praveen321' (hashed) into your Supabase users table.

import { createClient } from '@supabase/supabase-js'
import bcrypt from 'bcryptjs'

const supabaseUrl = 'https://cobahehmpstttmnzmnky.supabase.co'
const supabaseAnonKey = 'sb_publishable_RaogkZ-7uzmWSFNlXoTUcQ_htDPyrQw'
const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function insertUser() {
  const username = 'praveen'
  const password = 'Praveen321'
  const password_hash = await bcrypt.hash(password, 10)

const { data, error } = await supabase
  .from('users')
  .insert([{ username, password: '', password_hash }])

  if (error) {
    console.error('Error inserting user:', error)
  } else {
    console.log('User inserted:', data)
  }
}

insertUser()
