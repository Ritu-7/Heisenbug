import { cn } from "@/lib/utils";

type DifficultyColor = {
  easy: string;
  medium: string;
  hard: string;
};

const difficultyColors: DifficultyColor = {
  easy: "bg-pass-soft text-pass border border-pass/30",
  medium: "bg-warning-soft text-warning border border-warning/30",
  hard: "bg-fail-soft text-fail border border-fail/30",
};

interface DifficultyBadgeProps {
  difficulty: string;
  className?: string;
}

export function DifficultyBadge({ difficulty, className }: DifficultyBadgeProps) {
  const normalized = difficulty.toLowerCase() as keyof DifficultyColor;
  const colorClass = difficultyColors[normalized] ?? "bg-surface-2 text-text-secondary border border-border";
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium font-mono capitalize",
        colorClass,
        className,
      )}
    >
      {difficulty}
    </span>
  );
}

interface SkillBadgeProps {
  skill: string;
  className?: string;
}

export function SkillBadge({ skill, className }: SkillBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium font-mono",
        "bg-accent-soft text-accent border border-accent/20",
        className,
      )}
    >
      {skill}
    </span>
  );
}

interface TrackBadgeProps {
  track: string;
  className?: string;
}

export function TrackBadge({ track, className }: TrackBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wide",
        "bg-surface-2 text-text-secondary border border-border",
        className,
      )}
    >
      {track}
    </span>
  );
}
