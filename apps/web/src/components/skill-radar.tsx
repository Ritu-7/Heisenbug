"use client";

import { useMemo } from "react";

interface SkillScore {
  name: string;
  score: number; // 0 to 100
}

interface SkillRadarProps {
  skills?: SkillScore[];
  hasData?: boolean;
}

const DEFAULT_SKILLS = [
  { name: "idempotency", score: 0 },
  { name: "concurrency", score: 0 },
  { name: "payments", score: 0 },
  { name: "architecture", score: 0 },
  { name: "debugging", score: 0 },
];

export function SkillRadar({ skills = DEFAULT_SKILLS, hasData = false }: SkillRadarProps) {
  const center = 120;
  const radius = 80;
  const count = skills.length;

  const points = useMemo(() => {
    return skills.map((skill, index) => {
      const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
      const val = hasData ? skill.score / 100 : 0; // if no data, point is at center (0)
      const x = center + radius * val * Math.cos(angle);
      const y = center + radius * val * Math.sin(angle);
      return { x, y, angle, label: skill.name };
    });
  }, [skills, count, radius, center, hasData]);

  // Grid concentric polygons (25%, 50%, 75%, 100%)
  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <div className="relative flex flex-col items-center justify-center p-4 bg-surface rounded-lg border border-border">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary self-start mb-2 font-mono">
        Skill Matrix Radar
      </h3>

      <div className="relative w-[260px] h-[260px] flex items-center justify-center">
        <svg width="260" height="260" viewBox="0 0 240 240" className="overflow-visible">
          {/* Concentric grid lines */}
          {gridLevels.map((level, i) => {
            const levelPoints = skills
              .map((_, idx) => {
                const angle = (Math.PI * 2 * idx) / count - Math.PI / 2;
                const x = center + radius * level * Math.cos(angle);
                const y = center + radius * level * Math.sin(angle);
                return `${x},${y}`;
              })
              .join(" ");

            return (
              <polygon
                key={i}
                points={levelPoints}
                fill="none"
                stroke="var(--border)"
                strokeDasharray={level < 1 ? "2,2" : undefined}
                strokeWidth="1"
              />
            );
          })}

          {/* Axis lines */}
          {skills.map((_, idx) => {
            const angle = (Math.PI * 2 * idx) / count - Math.PI / 2;
            const x = center + radius * Math.cos(angle);
            const y = center + radius * Math.sin(angle);
            return (
              <line
                key={idx}
                x1={center}
                y1={center}
                x2={x}
                y2={y}
                stroke="var(--border)"
                strokeWidth="1"
              />
            );
          })}

          {/* Axis Labels */}
          {skills.map((skill, idx) => {
            const angle = (Math.PI * 2 * idx) / count - Math.PI / 2;
            const labelRadius = radius + 22;
            const lx = center + labelRadius * Math.cos(angle);
            const ly = center + labelRadius * Math.sin(angle);

            return (
              <text
                key={idx}
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="central"
                className="text-[10px] fill-text-secondary font-mono capitalize"
              >
                {skill.name}
              </text>
            );
          })}

          {/* Data Polygon */}
          {hasData && (
            <polygon
              points={points.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="var(--accent-soft)"
              fillOpacity="0.6"
              stroke="var(--accent)"
              strokeWidth="2"
            />
          )}

          {/* Data Points */}
          {hasData &&
            points.map((p, idx) => (
              <circle key={idx} cx={p.x} cy={p.y} r="3" fill="var(--accent)" />
            ))}
        </svg>

        {/* Empty state overlay badge */}
        {!hasData && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-surface/80 backdrop-blur-[1px] p-4 text-center rounded-lg">
            <span className="text-xs font-medium text-text-secondary font-mono mb-1">
              No submission data yet
            </span>
            <p className="text-[11px] text-text-secondary/70 max-w-[180px]">
              Complete a problem to see your skill breakdown.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
