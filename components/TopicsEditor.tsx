'use client'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'

interface Props {
  topics: string[]
  newTopic: string
  setNewTopic: (v: string) => void
  onAddTopic: () => void
  onRemoveTopic: (topic: string) => void
  onSuggestTopics?: () => void
  suggesting?: boolean
  suggestDisabled?: boolean
}

export default function TopicsEditor({
  topics,
  newTopic,
  setNewTopic,
  onAddTopic,
  onRemoveTopic,
  onSuggestTopics,
  suggesting,
  suggestDisabled
}: Props) {
  return (
    <>
      <div className="flex gap-2 mb-2">
        <Input
          placeholder="Add a topic..."
          value={newTopic}
          onChange={(e) => setNewTopic(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && onAddTopic()}
        />
        <Button onClick={onAddTopic} variant="outline">Add</Button>
        {onSuggestTopics && (
          <Button onClick={onSuggestTopics} variant="outline" disabled={!!suggesting || !!suggestDisabled}>
            {suggesting ? 'Suggesting...' : 'Suggest Topics'}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {topics.map((topic) => (
          <Badge key={topic} variant="secondary" className="cursor-pointer">
            {topic}
            <X className="w-3 h-3 ml-1" onClick={() => onRemoveTopic(topic)} />
          </Badge>
        ))}
      </div>
    </>
  )
}
