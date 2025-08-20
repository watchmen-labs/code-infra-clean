'use client'

import Editor from 'react-simple-code-editor'
import Prism from 'prismjs'
import 'prismjs/components/prism-clike'
import 'prismjs/components/prism-python'
import 'prismjs/themes/prism-tomorrow.css'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Eraser } from 'lucide-react'

interface Props {
  title: string
  code: string
  onChange: (code: string) => void
  onClear: () => void
  clearDisabled: boolean
  placeholder: string
}

export default function CodeEditorPanel({ title, code, onChange, onClear, clearDisabled, placeholder }: Props) {
  return (
    <Card className="grid grid-rows-[auto_1fr] overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between py-0">
        <CardTitle>{title}</CardTitle>
        <Button variant="outline" size="sm" onClick={onClear} disabled={clearDisabled}>
          <Eraser className="w-4 h-4 mr-2" />
          Clear Comments
        </Button>
      </CardHeader>
      <CardContent className="relative p-0">
        <div className="absolute inset-0 overflow-auto">
          <Editor
            value={code}
            onValueChange={onChange}
            highlight={c => (Prism.languages.python ? Prism.highlight(c, Prism.languages.python, 'python') : c)}
            padding={10}
            className="font-mono text-sm bg-background"
            style={{ fontFamily: '"Fira code", "Fira Mono", monospace', fontSize: 14, lineHeight: '1.5rem' }}
            textareaClassName="outline-none bg-transparent"
            placeholder={placeholder}
          />
        </div>
      </CardContent>
    </Card>
  )
}
