// components/dashboard/ImportControls.tsx
'use client'

import { Button } from '@/components/ui/button'
import React from 'react'

type Props = {
  importBusy: boolean
  importErrors: string[]
  importProgress: { done: number; total: number }
  triggerImport: (fmt: 'csv' | 'jsonl') => void
  fileInputRef: React.RefObject<HTMLInputElement>
  fileInputKey: number
  handleFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export default function ImportControls({
  importBusy,
  importErrors,
  importProgress,
  triggerImport,
  fileInputRef,
  fileInputKey,
  handleFileSelected
}: Props) {
  const [accept, setAccept] = React.useState('.csv,text/csv')

  const onChooseCsv = () => {
    setAccept('.csv,text/csv')
    triggerImport('csv')
  }
  const onChooseJsonl = () => {
    setAccept('.jsonl,.json,text/plain,application/json')
    triggerImport('jsonl')
  }

  return (
    <div className="flex items-center gap-2">
      <input
        key={fileInputKey}
        ref={fileInputRef}
        type="file"
        onChange={handleFileSelected}
        accept={accept}
        className="hidden"
      />
      <Button size="sm" variant="outline" onClick={onChooseCsv}>Import CSV</Button>
      <Button size="sm" variant="outline" onClick={onChooseJsonl}>Import JSONL</Button>
      {importBusy ? (
        <span className="text-sm text-muted-foreground">{importProgress.done}/{importProgress.total}</span>
      ) : null}
      {!importBusy && importErrors.length > 0 ? (
        <span className="text-sm text-red-500">{importErrors.length} failed</span>
      ) : null}
    </div>
  )
}
