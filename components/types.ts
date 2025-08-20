export interface DatasetItem {
  id: string
  prompt: string
  inputs: string
  outputs: string
  unit_tests: string
  solution: string
  code_file?: string
  language?: string
  group?: string | null
  time_complexity: string
  space_complexity: string
  topics: string[]
  difficulty: 'Easy' | 'Medium' | 'Hard'
  notes: string
  lastRunSuccessful: boolean
  createdAt: string
  updatedAt: string
}

export interface Analytics {
  totalItems: number
  byDifficulty: Record<string, number>
  byTopic: Record<string, number>
  successfulRuns: number
  itemsWithNotes: number
}

export type SortKey = 'difficulty' | 'lastRunSuccessful' | 'createdAt';
