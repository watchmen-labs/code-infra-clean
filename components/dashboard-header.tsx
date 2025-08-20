'use client'

import { Button } from '@/components/ui/button'
import { Download, Plus } from 'lucide-react'
import Link from 'next/link'

interface DashboardHeaderProps {
  onOpenExportDialog: (format: 'json' | 'csv' | 'jsonl') => void
}

export function DashboardHeader({ onOpenExportDialog }: DashboardHeaderProps) {
  return (
    <div className="flex justify-between items-center">
      <div>
        <h1 className="text-3xl font-bold">Competitive Programming Dataset Manager</h1>
        <p className="text-muted-foreground">Manage and analyze your labeled programming problems</p>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => onOpenExportDialog('json')} variant="outline">
          <Download className="w-4 h-4 mr-2" />
          Export JSON
        </Button>
        <Button onClick={() => onOpenExportDialog('csv')} variant="outline">
          <Download className="w-4 h-4 mr-2" />
          Export CSV
        </Button>
        <Button onClick={() => onOpenExportDialog('jsonl')} variant="outline">
          <Download className="w-4 h-4 mr-2" />
          Export JSONL
        </Button>
        <Link href="/review">
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            Add New
          </Button>
        </Link>
      </div>
    </div>
  )
}
