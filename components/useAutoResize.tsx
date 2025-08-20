import { useCallback } from 'react'

export function useAutoResize() {
  const resizeTextarea = useCallback((element: HTMLTextAreaElement | null) => {
    if (element) {
      element.style.height = 'auto'
      element.style.height = `${element.scrollHeight}px`
    }
  }, [])
  const handleAutoResize = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    resizeTextarea(e.currentTarget)
  }, [resizeTextarea])
  return { resizeTextarea, handleAutoResize }
}
