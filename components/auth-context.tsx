'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'

type AuthUser = { id: string; email?: string | null }
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

type AuthContextValue = {
  token: string | null
  user: AuthUser | null
  status: AuthStatus
  login: () => Promise<void>
  logout: () => void
  headers: () => Record<string, string>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [refreshToken, setRefreshToken] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')

  type RawSession = {
    access_token: string | null
    refresh_token: string | null
    expires_in?: number | null
    expires_at?: number | null
  }

  const persistSession = (session: RawSession) => {
    const accessToken = session.access_token
    if (!accessToken) return

    const refresh = session.refresh_token
    const expirySeconds = session.expires_at
      ? Number(session.expires_at)
      : session.expires_in
        ? Math.round(Date.now() / 1000) + Number(session.expires_in)
        : null

    const expiryMs = expirySeconds ? expirySeconds * 1000 : null

    setToken(accessToken)
    setRefreshToken(refresh || null)
    setExpiresAt(expiryMs)

    if (typeof window !== 'undefined') {
      localStorage.setItem('auth:access_token', accessToken)
      if (refresh) localStorage.setItem('auth:refresh_token', refresh)
      else localStorage.removeItem('auth:refresh_token')
      if (expiryMs) localStorage.setItem('auth:expires_at', String(expiryMs))
      else localStorage.removeItem('auth:expires_at')
    }
  }

  const loadStoredSession = (): RawSession | null => {
    if (typeof window === 'undefined') return null
    const access_token = localStorage.getItem('auth:access_token')
    const refresh_token = localStorage.getItem('auth:refresh_token')
    const expires_raw = localStorage.getItem('auth:expires_at')

    const expires_at = expires_raw ? Number(expires_raw) / 1000 : null

    if (!access_token) return null
    return { access_token, refresh_token, expires_at }
  }

  useEffect(() => {
    const fromUrl = (): RawSession | null => {
      if (typeof window === 'undefined') return null

      const extract = (s: string) => new URLSearchParams(s.startsWith('?') || s.startsWith('#') ? s.slice(1) : s)
      const searchParams = extract(window.location.search)
      const hashParams = extract(window.location.hash)

      const access_token = hashParams.get('access_token') || searchParams.get('access_token')
      const refresh_token = hashParams.get('refresh_token') || searchParams.get('refresh_token')
      const expires_in = Number(hashParams.get('expires_in') || searchParams.get('expires_in') || '') || null
      const expires_at = Number(hashParams.get('expires_at') || searchParams.get('expires_at') || '') || null

      if (access_token || refresh_token) {
        try {
          history.replaceState({}, document.title, window.location.pathname + window.location.search.split('?')[0])
        } catch {}
      }

      if (!access_token) return null
      return { access_token, refresh_token, expires_in, expires_at }
    }

    const initialSession = fromUrl() || loadStoredSession()
    if (initialSession) {
      persistSession(initialSession)
    } else {
      setStatus('unauthenticated')
    }
  }, [])

  useEffect(() => {
    const verify = async () => {
      if (!token) return

      const shouldRefresh = () => {
        if (!refreshToken || !expiresAt) return false
        const now = Date.now()
        const bufferMs = 5 * 60 * 1000
        return now + bufferMs >= expiresAt
      }

      if (shouldRefresh()) {
        try {
          const resp = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
          })

          if (resp.ok) {
            const payload = await resp.json()
            persistSession({
              access_token: payload?.access_token || null,
              refresh_token: payload?.refresh_token || refreshToken,
              expires_in: payload?.expires_in,
              expires_at: payload?.expires_at,
            })
          } else {
            throw new Error('refresh failed')
          }
        } catch {
          setUser(null)
          setStatus('unauthenticated')
          setToken(null)
          setRefreshToken(null)
          setExpiresAt(null)
          if (typeof window !== 'undefined') {
            localStorage.removeItem('auth:access_token')
            localStorage.removeItem('auth:refresh_token')
            localStorage.removeItem('auth:expires_at')
          }
          return
        }
      }

      try {
        const r = await fetch('/api/auth/user', { headers: { Authorization: `Bearer ${token}` } })
        if (r.ok) {
          const j = await r.json()
          setUser(j.user || null)
          setStatus('authenticated')
        } else {
          setUser(null)
          setStatus('unauthenticated')
          if (typeof window !== 'undefined') {
            localStorage.removeItem('auth:access_token')
            localStorage.removeItem('auth:refresh_token')
            localStorage.removeItem('auth:expires_at')
          }
          setToken(null)
          setRefreshToken(null)
          setExpiresAt(null)
        }
      } catch {
        setUser(null)
        setStatus('unauthenticated')
        if (typeof window !== 'undefined') {
          localStorage.removeItem('auth:access_token')
          localStorage.removeItem('auth:refresh_token')
          localStorage.removeItem('auth:expires_at')
        }
        setToken(null)
        setRefreshToken(null)
        setExpiresAt(null)
      }
    }
    verify()
  }, [token, refreshToken, expiresAt])

  const login = async () => {
    const r = await fetch('/api/auth/start')
    const j = await r.json().catch(() => null)
    const url = j?.url
    if (url) window.location.assign(url)
  }

  const logout = () => {
    setUser(null)
    setToken(null)
    setStatus('unauthenticated')
    setRefreshToken(null)
    setExpiresAt(null)
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth:access_token')
      localStorage.removeItem('auth:refresh_token')
      localStorage.removeItem('auth:expires_at')
    }
  }

  const headers = (): Record<string, string> =>
    token ? { Authorization: `Bearer ${token}` } : {}

  const value = useMemo(() => ({ token, user, status, login, logout, headers }), [token, user, status])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
