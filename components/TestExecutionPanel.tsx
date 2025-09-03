'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Play, CheckCircle, XCircle, Clock, Copy, ClipboardCheck, ClipboardList } from 'lucide-react'
import { useState } from 'react'

interface TestResult {
  success: boolean
  output: string
  error?: string
  timeout?: boolean
}

interface CopyPayload {
  prompt: string
  inputs: string
  outputs: string
  solution?: string
  unit_tests?: string
  sota_solution?: string
}

interface Props {
  lastRunSuccessful?: boolean
  sotaCorrect?: boolean
  running: boolean
  onRun: () => void
  runDisabled?: boolean
  testResultRef: TestResult | null
  testResultSota: TestResult | null
  /** Added: source text for the three copy actions */
  copyPayload?: CopyPayload
}

export default function TestExecutionPanel({
  lastRunSuccessful,
  sotaCorrect,
  running,
  onRun,
  runDisabled,
  testResultRef,
  testResultSota,
  copyPayload,
}: Props) {
  const [copied, setCopied] = useState<null | 'qio' | 'solution' | 'tests' | 'sota'>(null)

  const baseText = () => {
    const p = copyPayload?.prompt?.trim() ?? ''
    const i = copyPayload?.inputs?.trim() ?? ''
    const o = copyPayload?.outputs?.trim() ?? ''
    return [
      p && `Problem:\n${p}`,
      i && `Inputs:\n${i}`,
      o && `Outputs:\n${o}`,
    ].filter(Boolean).join('\n\n')
  }

  const withRefSolution = () => {
    const s = copyPayload?.solution ?? ''
    return `${baseText()}\n\nSolution:\n\`\`\`\n${s}\n\`\`\``
  }

  const withSotaSolution = () => {
    const s = copyPayload?.sota_solution ?? ''
    return `${baseText()}\n\nSOTA Solution:\n\`\`\`\n${s}\n\`\`\``
  }

  const withTests = () => {
    const t = copyPayload?.unit_tests ?? ''
    return `${baseText()}\n\nTests:\n\`\`\`\n${t}\n\`\`\``
  }

  const doCopy = async (kind: 'qio' | 'solution' | 'tests' | 'sota') => {
    let text = ''
    if (kind === 'qio') text = baseText()
    if (kind === 'solution') text = withRefSolution()
    if (kind === 'sota') text = withSotaSolution()
    if (kind === 'tests') text = withTests()

    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      setTimeout(() => setCopied(null), 1200)
    } catch {
      // no-op; clipboard failed (e.g., insecure context)
    }
  }

  return (
    <Card className="grid grid-rows-[auto_1fr] overflow-hidden">
      <CardHeader className="flex flex-col gap-2 py-0">
        <div className="flex items-center justify-between">
          <CardTitle>Test Execution</CardTitle>
          <div className="flex items-center gap-2">
            {sotaCorrect === true && (
              <Badge variant="outline" className="text-green-600 border-green-600">
                <CheckCircle className="w-3 h-3 mr-1" />
                SOTA Pass
              </Badge>
            )}
            {sotaCorrect === false && (
              <Badge variant="outline" className="text-gray-600 border-gray-600">
                <XCircle className="w-3 h-3 mr-1" />
                SOTA Not Verified
              </Badge>
            )}
            {lastRunSuccessful === true && (
              <Badge variant="outline" className="text-green-600 border-green-600">
                <CheckCircle className="w-3 h-3 mr-1" />
                Ref Pass
              </Badge>
            )}
            {lastRunSuccessful === false && (
              <Badge variant="outline" className="text-gray-600 border-gray-600">
                <XCircle className="w-3 h-3 mr-1" />
                Ref Not Verified
              </Badge>
            )}
          </div>
        </div>

        {/* Toolbar: copy actions + run */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="whitespace-nowrap bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
              onClick={() => doCopy('qio')}
              title="Copy Problem + Inputs + Outputs"
              aria-label="Copy Problem, Inputs, and Outputs"
            >
              <Copy className="w-4 h-4 mr-1" />
              Copy Q/I/O
              {copied === 'qio' && (
                <Badge className="ml-2 bg-blue-600 text-white">Copied</Badge>
              )}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="whitespace-nowrap bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100"
              onClick={() => doCopy('sota')}
              title="Copy with SOTA Solution (triple backticks)"
              aria-label="Copy with SOTA Solution"
            >
              <ClipboardCheck className="w-4 h-4 mr-1" />
              Copy + SOTA
              {copied === 'sota' && (
                <Badge className="ml-2 bg-orange-600 text-white">Copied</Badge>
              )}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="whitespace-nowrap bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
              onClick={() => doCopy('solution')}
              title="Copy with Reference Solution (triple backticks)"
              aria-label="Copy with Reference Solution"
            >
              <ClipboardCheck className="w-4 h-4 mr-1" />
              Copy + Ref
              {copied === 'solution' && (
                <Badge className="ml-2 bg-green-600 text-white">Copied</Badge>
              )}
            </Button>

            <Button
              type="button"
              size="sm"
              variant="outline"
              className="whitespace-nowrap bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100"
              onClick={() => doCopy('tests')}
              title="Copy with Tests (triple backticks)"
              aria-label="Copy with Tests"
            >
              <ClipboardList className="w-4 h-4 mr-1" />
              Copy + Tests
              {copied === 'tests' && (
                <Badge className="ml-2 bg-purple-600 text-white">Copied</Badge>
              )}
            </Button>
          </div>

          <div>
            <Button onClick={onRun} disabled={running || !!runDisabled}>
              {running ? (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Run Tests
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="overflow-y-auto">
        <div className="grid grid-cols-2 gap-2">
          <div>
            {testResultSota && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {testResultSota.success ? (
                    <Badge className="bg-green-100 text-green-800">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Tests Passed
                    </Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-800">
                      <XCircle className="w-3 h-3 mr-1" />
                      Tests Failed
                    </Badge>
                  )}
                  {testResultSota.timeout && (
                    <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                      <Clock className="w-3 h-3 mr-1" />
                      Timeout
                    </Badge>
                  )}
                </div>
                <div className="bg-gray-50 p-3 rounded-md">
                  <pre className="text-sm whitespace-pre-wrap">
                    {testResultSota.output || testResultSota.error || 'No output'}
                  </pre>
                </div>
              </div>
            )}
          </div>
          <div>
            {testResultRef && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {testResultRef.success ? (
                    <Badge className="bg-green-100 text-green-800">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Tests Passed
                    </Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-800">
                      <XCircle className="w-3 h-3 mr-1" />
                      Tests Failed
                    </Badge>
                  )}
                  {testResultRef.timeout && (
                    <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                      <Clock className="w-3 h-3 mr-1" />
                      Timeout
                    </Badge>
                  )}
                </div>
                <div className="bg-gray-50 p-3 rounded-md">
                  <pre className="text-sm whitespace-pre-wrap">
                    {testResultRef.output || testResultRef.error || 'No output'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
