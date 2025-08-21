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
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<AuthStatus>('loading')

  useEffect(() => {
    const fromUrl = () => {
      if (typeof window === 'undefined') return null
      const extract = (s: string) => {
        const p = new URLSearchParams(s.startsWith('?') || s.startsWith('#') ? s.slice(1) : s)
        return p.get('access_token')
      }
      const t = extract(window.location.hash) || extract(window.location.search)
      if (t) {
        try {
          history.replaceState({}, document.title, window.location.pathname + window.location.search.split('?')[0])
        } catch {}
      }
      return t
    }
    const t = fromUrl() || (typeof window !== 'undefined' ? localStorage.getItem('auth:access_token') : null)
    if (t) {
      setToken(t)
      if (typeof window !== 'undefined') localStorage.setItem('auth:access_token', t)
    } else {
      setStatus('unauthenticated')
    }
  }, [])

  useEffect(() => {
    const verify = async () => {
      if (!token) return
      try {
        const r = await fetch('/api/auth/user', { headers: { Authorization: `Bearer ${token}` } })
        if (r.ok) {
          const j = await r.json()
          setUser(j.user || null)
          setStatus('authenticated')
        } else {
          setUser(null)
          setStatus('unauthenticated')
          if (typeof window !== 'undefined') localStorage.removeItem('auth:access_token')
          setToken(null)
        }
      } catch {
        setUser(null)
        setStatus('unauthenticated')
        if (typeof window !== 'undefined') localStorage.removeItem('auth:access_token')
        setToken(null)
      }
    }
    verify()
  }, [token])

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
    if (typeof window !== 'undefined') localStorage.removeItem('auth:access_token')
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
