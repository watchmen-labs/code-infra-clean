// components/ItemForm.tsx
"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import TopicsEditor from "@/components/TopicsEditor";
import { DatasetItem } from "@/components/types";

interface Props {
  item: DatasetItem;
  selectedVersionId: string | null;
  newTopic: string;
  setNewTopic: (v: string) => void;
  isSuggestingTopics: boolean;
  updateItem: (updates: Partial<DatasetItem>) => void;
  addTopic: () => void;
  removeTopic: (topic: string) => void;
  suggestTopics: () => Promise<void>;
  onAutoResize: (e: React.FormEvent<HTMLTextAreaElement>) => void;
}

export default function ItemForm({
  item,
  selectedVersionId,
  newTopic,
  setNewTopic,
  isSuggestingTopics,
  updateItem,
  addTopic,
  removeTopic,
  suggestTopics,
  onAutoResize,
}: Props) {
  // coalesce nulls -> empty strings at the edge
  const v = <T extends string | null | undefined>(x: T) => (x ?? "") as string;

  return (
    <Card className="grid grid-rows-[auto_1fr] overflow-y-scroll">
      <CardContent className="space-y-4 p-1">
        <div>
          <Label htmlFor="prompt">Problem Prompt</Label>
          <Textarea
            key={`${item.id}-${selectedVersionId}-prompt`}
            id="prompt"
            placeholder="Enter the problem statement..."
            value={v(item.prompt)}
            onChange={e => updateItem({ prompt: e.target.value })}
            onInput={onAutoResize}
            className="resize-none overflow-y-hidden"
          />
        </div>
        <div>
          <Label htmlFor="inputs">Inputs</Label>
          <Textarea
            key={`${item.id}-${selectedVersionId}-inputs`}
            id="inputs"
            placeholder="Describe inputs or provide examples..."
            value={v(item.inputs)}
            onChange={e => updateItem({ inputs: e.target.value })}
            onInput={onAutoResize}
            className="resize-none overflow-y-hidden"
          />
        </div>
        <div>
          <Label htmlFor="outputs">Outputs</Label>
          <Textarea
            key={`${item.id}-${selectedVersionId}-outputs`}
            id="outputs"
            placeholder="Describe expected outputs or provide examples..."
            value={v(item.outputs)}
            onChange={e => updateItem({ outputs: e.target.value })}
            onInput={onAutoResize}
            className="resize-none overflow-y-hidden"
          />
        </div>
        <div>
          <Label htmlFor="code_file">Code File</Label>
          <Input
            id="code_file"
            value={v(item.code_file)}
            onChange={e => updateItem({ code_file: e.target.value })}
            placeholder="e.g., def solve(...)"
          />
        </div>
        <div>
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            key={`${item.id}-${selectedVersionId}-notes`}
            id="notes"
            placeholder="Add any notes..."
            value={v(item.notes)}
            onChange={e => updateItem({ notes: e.target.value })}
            onInput={onAutoResize}
            className="resize-none overflow-y-hidden"
          />
        </div>
        <div>
          <Label htmlFor="difficulty">Difficulty</Label>
          <Select
            value={item.difficulty}
            onValueChange={(value: "Easy" | "Medium" | "Hard") => updateItem({ difficulty: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Easy">Easy</SelectItem>
              <SelectItem value="Medium">Medium</SelectItem>
              <SelectItem value="Hard">Hard</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="time_complexity">Time Complexity</Label>
          <Textarea
            key={`${item.id}-${selectedVersionId}-time`}
            id="time_complexity"
            value={v(item.time_complexity)}
            onChange={e => updateItem({ time_complexity: e.target.value })}
            placeholder="e.g., O(n log n)..."
            onInput={onAutoResize}
            className="resize-none overflow-y-hidden"
          />
        </div>
        <div>
          <Label htmlFor="space_complexity">Space Complexity</Label>
          <Textarea
            key={`${item.id}-${selectedVersionId}-space`}
            id="space_complexity"
            value={v(item.space_complexity)}
            onChange={e => updateItem({ space_complexity: e.target.value })}
            placeholder="e.g., O(n)..."
            onInput={onAutoResize}
            className="resize-none overflow-y-hidden"
          />
        </div>
        <div>
          <Label>Topics</Label>
          <TopicsEditor
            topics={item.topics || []}
            newTopic={newTopic}
            setNewTopic={setNewTopic}
            onAddTopic={addTopic}
            onRemoveTopic={removeTopic}
            onSuggestTopics={suggestTopics}
            suggesting={isSuggestingTopics}
            suggestDisabled={!v(item.prompt) || !v(item.solution)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
