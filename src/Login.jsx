import { useEffect, useState } from 'react'
import { APP_CONFIG, supabase } from './config'
import bcrypt from 'bcryptjs'


const REMEMBER_ME_KEY = 'ledger-remember-me-v1'


export const SESSION_KEY = 'ledger-session'


export function isLoggedIn() {
  return sessionStorage.getItem(SESSION_KEY) === 'true'
}



export function Login({ onLogin }) {
  const [authView, setAuthView] = useState('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showOldPassword, setShowOldPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [forgotError, setForgotError] = useState('')
  const [forgotSuccess, setForgotSuccess] = useState('')

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

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    const normalizedUsername = username.trim()
    if (!normalizedUsername || !password) {
      setError('Please enter both username and password.')
      return
    }

    try {
      // Query user from Supabase
      const { data, error: queryError } = await supabase
        .from('users')
        .select('id,username,password_hash')
        .eq('username', normalizedUsername)
        .single()

      if (queryError || !data) {
        setError('Invalid username or password.')
        return
      }

      const match = await bcrypt.compare(password, data.password_hash)
      if (!match) {
        setError('Invalid username or password.')
        return
      }

      sessionStorage.setItem(
        'user',
        JSON.stringify({
          id: data.id,
          username: data.username,
        }),
      )

      if (rememberMe) {
        localStorage.setItem(
          REMEMBER_ME_KEY,
          JSON.stringify({ username: normalizedUsername, password }),
        )
      } else {
        localStorage.removeItem(REMEMBER_ME_KEY)
      }

      sessionStorage.setItem(SESSION_KEY, 'true')
      onLogin()
    } catch {
      setError('Unable to sign in right now. Please try again.')
    }
  }

  function openForgotPassword() {
    setAuthView('forgot')
    setError('')
    setSuccess('')
    setForgotError('')
    setForgotSuccess('')
    setOldPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  function backToLogin(message = '') {
    setAuthView('login')
    setForgotError('')
    setForgotSuccess('')
    setOldPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setSuccess(message)
  }

  async function handleResetPassword(event) {
    event.preventDefault()
    setForgotError('')
    setForgotSuccess('')

    // Query user from Supabase
    const { data, error: queryError } = await supabase
      .from('users')
      .select('id,username,password_hash')
      .eq('username', username.trim())
      .single()

    if (queryError || !data) {
      setForgotError('User not found.')
      return
    }

    const match = await bcrypt.compare(oldPassword, data.password_hash)
    if (!match) {
      setForgotError('Old password is incorrect.')
      return
    }

    if (newPassword.length < 6) {
      setForgotError('New password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setForgotError('New password and confirm password do not match.')
      return
    }

    // Hash new password
    const newHash = await bcrypt.hash(newPassword, 10)
    const { error: updateError } = await supabase
      .from('users')
      .update({ password_hash: newHash })
      .eq('id', data.id)

    if (updateError) {
      setForgotError('Failed to update password. Please try again.')
      return
    }

    setUsername(username.trim())
    setPassword('')
    backToLogin('Password updated successfully. Please sign in with your new password.')
  }

  return (
    <main className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <img src="/logo.svg" alt="Ledger logo" className="login-logo" />
          <h1>{APP_CONFIG.appName}</h1>
          <p>{APP_CONFIG.tagline}</p>
        </div>

        {authView === 'login' ? (
          <form className="login-form" onSubmit={handleSubmit} noValidate>
            <label className="login-field">
              Username
              <input
                type="text"
                value={username}
                autoComplete="username"
                placeholder="Enter username"
                onChange={(e) => {
                  setUsername(e.target.value)
                  setError('')
                  setSuccess('')
                }}
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
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError('')
                    setSuccess('')
                  }}
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
            {success && <p className="login-info">{success}</p>}

            <button type="button" className="forgot-link" onClick={openForgotPassword}>
              Forgot password?
            </button>

            <button type="submit" className="login-btn">Sign In</button>
          </form>
        ) : (

          <form className="login-form" onSubmit={handleResetPassword} noValidate>
            <h2 className="forgot-title">Reset Password</h2>
            <div className="forgot-username-info">
              Changing password for: <b>{username || <i>Not set</i>}</b>
            </div>

            <label className="login-field">
              Old Password
              <div className="password-wrap">
                <input
                  type={showOldPassword ? 'text' : 'password'}
                  value={oldPassword}
                  autoComplete="current-password"
                  placeholder="Enter old password"
                  onChange={(e) => {
                    setOldPassword(e.target.value)
                    setForgotError('')
                    setForgotSuccess('')
                  }}
                  required
                />
                <button
                  type="button"
                  className="toggle-pw"
                  onClick={() => setShowOldPassword((s) => !s)}
                  aria-label={showOldPassword ? 'Hide password' : 'Show password'}
                >
                  {showOldPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </label>

            <label className="login-field">
              New Password
              <div className="password-wrap">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  autoComplete="new-password"
                  placeholder="Enter new password"
                  onChange={(e) => {
                    setNewPassword(e.target.value)
                    setForgotError('')
                    setForgotSuccess('')
                  }}
                  required
                />
                <button
                  type="button"
                  className="toggle-pw"
                  onClick={() => setShowNewPassword((s) => !s)}
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                >
                  {showNewPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </label>

            <label className="login-field">
              Confirm New Password
              <div className="password-wrap">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  autoComplete="new-password"
                  placeholder="Confirm new password"
                  onChange={(e) => {
                    setConfirmPassword(e.target.value)
                    setForgotError('')
                    setForgotSuccess('')
                  }}
                  required
                />
                <button
                  type="button"
                  className="toggle-pw"
                  onClick={() => setShowConfirmPassword((s) => !s)}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </label>

            {forgotError && <p className="login-error">{forgotError}</p>}
            {forgotSuccess && <p className="login-info">{forgotSuccess}</p>}

            <div className="forgot-actions">
              <button type="button" className="ghost forgot-back-btn" onClick={() => backToLogin()}>
                Back to Sign In
              </button>
              <button type="submit" className="login-btn forgot-submit-btn">
                Update Password
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  )
}
