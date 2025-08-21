'use client'

import { useAuth } from './auth-context'
import { Button } from './ui/button'

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth()
  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent" />
      </div>
    )
  }
  if (status === 'unauthenticated') {
    return <SignInCard />
  }
  return <>{children}</>
}

export function SignInCard() {
  const { login } = useAuth()
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-full max-w-sm border rounded-lg p-6 space-y-4">
        <h1 className="text-xl font-semibold">Sign in</h1>
        <p className="text-sm text-muted-foreground">Use Google to continue</p>
        <Button className="w-full" onClick={login}>Continue with Google</Button>
      </div>
    </div>
  )
}
