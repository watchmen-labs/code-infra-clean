'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart3, Play, FileText } from 'lucide-react'

import { Analytics } from './types'

interface AnalyticsCardsProps {
  analytics: Analytics
}

export function AnalyticsCards({ analytics }: AnalyticsCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total Problems</CardTitle>
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{analytics.totalItems}</div>
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Successful Runs</CardTitle>
          <Play className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{analytics.successfulRuns}</div>
          <p className="text-xs text-muted-foreground">
            {analytics.totalItems > 0 ? Math.round((analytics.successfulRuns / analytics.totalItems) * 100) : 0}% success rate
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">With Notes</CardTitle>
          <FileText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{analytics.itemsWithNotes}</div>
          <p className="text-xs text-muted-foreground">
            {analytics.totalItems > 0 ? Math.round((analytics.itemsWithNotes / analytics.totalItems) * 100) : 0}% documented
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">By Difficulty</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {Object.entries(analytics.byDifficulty).map(([difficulty, count]) => (
            <div key={difficulty} className="flex justify-between text-sm">
              <span>{difficulty}</span>
              <span className="font-medium">{count}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Topics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 max-h-40 overflow-y-auto">
          {Object.entries(analytics.byTopic)
            .sort(([,a], [,b]) => b - a)
            .map(([topic, count]) => (
              <div key={topic} className="flex justify-between text-sm">
                <span>{topic}</span>
                <span className="font-medium">{count}</span>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  )
}
