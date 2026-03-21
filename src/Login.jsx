import { useEffect, useState } from 'react'
import { APP_CONFIG } from './config'

const VALID_USERNAME = 'admin'
const VALID_PASSWORD = 'ledger123'
const REMEMBER_ME_KEY = 'ledger-remember-me-v1'

export const SESSION_KEY = 'ledger-session'

export function isLoggedIn() {
  return sessionStorage.getItem(SESSION_KEY) === 'true'
}

export function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_ME_KEY)
      if (!saved) return

      const parsed = JSON.parse(saved)
      if (parsed?.username && parsed?.password) {
        setUsername(parsed.username)
        setPassword(parsed.password)
        setRememberMe(true)
      }
    } catch {
      localStorage.removeItem(REMEMBER_ME_KEY)
    }
  }, [])

  function handleSubmit(e) {
    e.preventDefault()
    if (
      username.trim() === VALID_USERNAME &&
      password === VALID_PASSWORD
    ) {
      if (rememberMe) {
        localStorage.setItem(
          REMEMBER_ME_KEY,
          JSON.stringify({ username: username.trim(), password }),
        )
      } else {
        localStorage.removeItem(REMEMBER_ME_KEY)
      }

      sessionStorage.setItem(SESSION_KEY, 'true')
      onLogin()
    } else {
      setError('Invalid username or password.')
    }
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <img src="/logo.svg" alt="Ledger logo" className="login-logo" />
          <h1>{APP_CONFIG.appName}</h1>
          <p>{APP_CONFIG.tagline}</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <label className="login-field">
            Username
            <input
              type="text"
              value={username}
              autoComplete="username"
              placeholder="Enter username"
              onChange={(e) => { setUsername(e.target.value); setError('') }}
              required
            />
          </label>

          <label className="login-field">
            Password
            <div className="password-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                autoComplete="current-password"
                placeholder="Enter password"
                onChange={(e) => { setPassword(e.target.value); setError('') }}
                required
              />
              <button
                type="button"
                className="toggle-pw"
                onClick={() => setShowPassword((s) => !s)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </label>

          <label className="remember-field">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            Remember username and password
          </label>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="login-btn">Sign In</button>
        </form>
      </div>
    </main>
  )
}
