import { useState } from 'react'

// Single set of credentials stored in sessionStorage under a hashed key.
// Change these values to whatever you want for your login.
const VALID_USERNAME = 'admin'
const VALID_PASSWORD = 'ledger123'

export const SESSION_KEY = 'ledger-session'

export function isLoggedIn() {
  return sessionStorage.getItem(SESSION_KEY) === 'true'
}

export function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  function handleSubmit(e) {
    e.preventDefault()
    if (
      username.trim() === VALID_USERNAME &&
      password === VALID_PASSWORD
    ) {
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
          <h1>Ledger</h1>
          <p>Track Credits &amp; Debits</p>
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

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="login-btn">Sign In</button>
        </form>
      </div>
    </main>
  )
}
