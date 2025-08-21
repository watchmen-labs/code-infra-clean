// components/HeaderControls.tsx
"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ChevronLeft, ChevronRight, History, Stamp } from "lucide-react";

interface Props {
  groupQuery: string;
  currentIndex: number;
  totalItems: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  isAuthenticated: boolean;
  onStamp: () => void;
  onShowHistory: () => void;
  headDisplay: string | null;
  headStamped: boolean;
}

export default function HeaderControls({
  groupQuery,
  currentIndex,
  totalItems,
  canPrev,
  canNext,
  onPrev,
  onNext,
  isAuthenticated,
  onStamp,
  onShowHistory,
  headDisplay,
  headStamped
}: Props) {
  return (
    <header className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <Link href={`/${groupQuery}`}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <p className="text-muted-foreground">
            Item {currentIndex + 1} of {totalItems}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrev}
          disabled={!canPrev}
        >
          <ChevronLeft className="w-4 h-4" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onNext}
          disabled={!canNext}
        >
          Next
          <ChevronRight className="w-4 h-4" />
        </Button>
        {isAuthenticated && (
          <Button
            variant="default"
            size="sm"
            onClick={onStamp}
            title="Stamp current node or branch"
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            <Stamp className="w-4 h-4 mr-1" /> Stamp
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onShowHistory}
          title="View version history"
        >
          <History className="w-4 h-4 mr-1" /> History
        </Button>
        {headDisplay ? (
          <Badge className={headStamped ? "bg-blue-100 text-blue-700" : "bg-secondary text-secondary-foreground"}>
            HEAD: {headDisplay}
          </Badge>
        ) : null}
      </div>
    </header>
  );
}
