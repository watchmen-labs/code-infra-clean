export interface DatasetItem {
  id: string
  prompt: string
  inputs: string
  outputs: string
  unit_tests: string
  solution: string
  sota_solution: string
  code_file?: string
  language?: string
  group?: string | null
  time_complexity: string
  space_complexity: string
  sota_time_complexity: string
  sota_space_complexity: string
  sota_correct: boolean
  topics: string[]
  difficulty: 'Easy' | 'Medium' | 'Hard'
  notes: string
  lastRunSuccessful: boolean
  createdAt: string
  updatedAt: string
  currentVersionId?: string | null
}

export interface Analytics {
  totalItems: number
  byDifficulty: Record<string, number>
  byTopic: Record<string, number>
  successfulRuns: number
  itemsWithNotes: number
}

export type SortKey = 'difficulty' | 'lastRunSuccessful' | 'createdAt';

export interface TestResult {
  success: boolean;
  output: string;
  error?: string;
  timeout?: boolean;
}

export interface VersionNode {
  id: string;
  itemId?: string;
  parentId?: string | null;
  label?: string | null;
  data?: Partial<DatasetItem>;
  authorId?: string | null;
  createdAt?: string;
}