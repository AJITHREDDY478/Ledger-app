// Google Drive uploader using Google Identity Services (token client) + Drive REST API.
// Requires: VITE_GOOGLE_CLIENT_ID and VITE_GDRIVE_BACKUP_FOLDER_ID set in .env.
// No npm deps; loads the GIS script on demand.

import { APP_CONFIG } from './config'

const GIS_SRC = 'https://accounts.google.com/gsi/client'
// Use full drive scope so we can write into a pre-existing user-owned folder.
// drive.file only sees files the app created, which causes 404 on existing folder IDs.
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

let gisPromise = null
let cachedToken = null // { access_token, expiresAt }

function loadGis() {
  if (gisPromise) return gisPromise
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve()
      return
    }
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services')))
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(script)
  })
  return gisPromise
}

function getAccessToken({ forcePrompt = false } = {}) {
  const clientId = APP_CONFIG.googleDrive.clientId
  if (!clientId) {
    return Promise.reject(
      new Error('Google client ID not configured. Set VITE_GOOGLE_CLIENT_ID in .env.'),
    )
  }

  if (
    !forcePrompt &&
    cachedToken &&
    cachedToken.access_token &&
    Date.now() < cachedToken.expiresAt - 30_000
  ) {
    return Promise.resolve(cachedToken.access_token)
  }

  return loadGis().then(
    () =>
      new Promise((resolve, reject) => {
        const tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          callback: (response) => {
            if (response.error) {
              reject(new Error(response.error_description || response.error))
              return
            }
            cachedToken = {
              access_token: response.access_token,
              expiresAt: Date.now() + Number(response.expires_in || 3600) * 1000,
            }
            resolve(response.access_token)
          },
          error_callback: (err) => {
            reject(new Error(err?.message || 'Google sign-in failed'))
          },
        })
        tokenClient.requestAccessToken({ prompt: forcePrompt ? 'consent' : '' })
      }),
  )
}

export async function uploadHtmlToDrive({ fileName, html, folderId, mimeType = 'text/html' }) {
  const targetFolderId = folderId || APP_CONFIG.googleDrive.backupFolderId
  if (!targetFolderId) {
    throw new Error('Drive folder ID not configured. Set VITE_GDRIVE_BACKUP_FOLDER_ID in .env.')
  }

  const accessToken = await getAccessToken()

  const metadata = {
    name: fileName,
    mimeType,
    parents: [targetFolderId],
  }

  const boundary = '-------ledger-backup-' + Math.random().toString(36).slice(2)
  const delimiter = `\r\n--${boundary}\r\n`
  const closeDelim = `\r\n--${boundary}--`

  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}; charset=UTF-8\r\n\r\n` +
    html +
    closeDelim

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  )

  if (!res.ok) {
    let detail = ''
    try {
      const err = await res.json()
      detail = err.error?.message || JSON.stringify(err)
    } catch {
      detail = await res.text()
    }
    if (res.status === 401 || res.status === 403) {
      cachedToken = null
    }
    throw new Error(`Drive upload failed (${res.status}): ${detail}`)
  }

  return res.json() // { id, name, webViewLink }
}

export function isDriveConfigured() {
  return Boolean(APP_CONFIG.googleDrive.clientId && APP_CONFIG.googleDrive.backupFolderId)
}
