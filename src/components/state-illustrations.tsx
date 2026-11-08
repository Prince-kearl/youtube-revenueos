import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Soft, grey illustrations for empty, no-results and error states: light objects with a gentle
// gradient, a thin outline, a ground shadow and a few floating dots. Colours come from the
// --illus-* tokens in styles.css, so they follow light and dark mode.

export type StateIllustrationName = "box" | "search" | "error" | "inbox" | "chart" | "folder";

const LINE = "var(--illus-line)";
const MARK = "var(--illus-mark)";
const BACK = "var(--illus-back)";

function Scene({ children }: { children: ReactNode }) {
  return (
    <>
      <ellipse cx="100" cy="134" rx="60" ry="6.5" fill="var(--illus-ground)" />
      <circle cx="34" cy="54" r="4.5" fill="var(--illus-dot)" />
      <circle cx="44" cy="76" r="3" fill="var(--illus-dot)" />
      <circle cx="166" cy="44" r="3.5" fill="var(--illus-dot)" />
      <circle cx="158" cy="68" r="5.5" fill="var(--illus-dot)" />
      {children}
    </>
  );
}

function Folder({ face }: { face: string }) {
  return (
    <>
      <path
        d="M58 46h24a4 4 0 0 1 3 1.4L92 56h48a6 6 0 0 1 6 6v60a6 6 0 0 1-6 6H58a6 6 0 0 1-6-6V52a6 6 0 0 1 6-6z"
        fill={BACK}
        stroke={LINE}
        strokeWidth="1.5"
      />
      <path d="M62 60h70v14H62z" fill="var(--illus-hi)" stroke={LINE} strokeWidth="1.2" />
      <rect
        x="48"
        y="70"
        width="104"
        height="58"
        rx="7"
        fill={`url(#${face})`}
        stroke={LINE}
        strokeWidth="1.5"
      />
    </>
  );
}

export function StateIllustration({
  name,
  className,
}: {
  name: StateIllustrationName;
  className?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const face = `illus-face-${id}`;
  const lens = `illus-lens-${id}`;

  return (
    <svg
      viewBox="0 0 200 150"
      className={cn("h-[120px] w-auto shrink-0", className)}
      aria-hidden="true"
      focusable="false"
      data-illustration={name}
    >
      <defs>
        <linearGradient id={face} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--illus-hi)" />
          <stop offset="100%" stopColor="var(--illus-lo)" />
        </linearGradient>
        <linearGradient id={lens} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--illus-hi)" stopOpacity="0.95" />
          <stop offset="100%" stopColor="var(--illus-lo)" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <Scene>
        {name === "box" && (
          <>
            {/* inside of the box, then the open flaps, then the front */}
            <path d="M60 70h80l-9-12H69z" fill={BACK} stroke={LINE} strokeWidth="1.5" />
            <path
              d="M60 70l9-12-17-14-11 13z"
              fill={`url(#${face})`}
              stroke={LINE}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="M140 70l-9-12 18-15 11 13z"
              fill={`url(#${face})`}
              stroke={LINE}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <rect
              x="60"
              y="70"
              width="80"
              height="58"
              rx="5"
              fill={`url(#${face})`}
              stroke={LINE}
              strokeWidth="1.5"
            />
            <rect x="86" y="88" width="28" height="7" rx="3.5" fill={BACK} />
          </>
        )}

        {name === "folder" && (
          <>
            <Folder face={face} />
            <rect x="84" y="94" width="32" height="6" rx="3" fill={BACK} />
          </>
        )}

        {name === "search" && (
          <>
            <Folder face={face} />
            {/* sparkle */}
            <path
              d="M128 36v-7M138 40l5-5M118 40l-5-5"
              stroke={MARK}
              strokeWidth="2"
              strokeLinecap="round"
            />
            {/* magnifier with a puzzled face */}
            <path d="M139 93l17 17" stroke={LINE} strokeWidth="9" strokeLinecap="round" />
            <path
              d="M141 95l13 13"
              stroke="var(--illus-hi)"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle cx="126" cy="78" r="21" fill={`url(#${lens})`} stroke={LINE} strokeWidth="5" />
            <circle cx="119" cy="74" r="2.2" fill={MARK} />
            <circle cx="133" cy="74" r="2.2" fill={MARK} />
            <path
              d="M119 87q7-6 14 0"
              fill="none"
              stroke={MARK}
              strokeWidth="2"
              strokeLinecap="round"
            />
          </>
        )}

        {name === "inbox" && (
          <>
            <path
              d="M66 56h68l16 40v26a6 6 0 0 1-6 6H56a6 6 0 0 1-6-6V96z"
              fill={`url(#${face})`}
              stroke={LINE}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="M50 96h30a20 11 0 0 0 40 0h30"
              fill="none"
              stroke={LINE}
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path d="M70 64h60l11 28h-21a20 11 0 0 1-40 0H59z" fill={BACK} />
            <path
              d="M80 74h40M76 82h48"
              stroke={LINE}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray="1 6"
            />
          </>
        )}

        {name === "chart" && (
          <>
            <rect
              x="46"
              y="38"
              width="108"
              height="90"
              rx="8"
              fill={`url(#${face})`}
              stroke={LINE}
              strokeWidth="1.5"
            />
            <rect x="58" y="50" width="34" height="6" rx="3" fill={BACK} />
            {[
              [62, 88, 24],
              [83, 76, 36],
              [104, 96, 16],
              [125, 68, 44],
            ].map(([x, y, h]) => (
              <rect
                key={x}
                x={x}
                y={y}
                width="13"
                height={h}
                rx="3"
                fill="none"
                stroke={MARK}
                strokeWidth="1.5"
                strokeDasharray="3 3"
              />
            ))}
            <path d="M56 113h88" stroke={LINE} strokeWidth="1.5" strokeLinecap="round" />
          </>
        )}

        {name === "error" && (
          <>
            <rect
              x="46"
              y="38"
              width="108"
              height="90"
              rx="8"
              fill={`url(#${face})`}
              stroke={LINE}
              strokeWidth="1.5"
            />
            <path d="M46 46a8 8 0 0 1 8-8h92a8 8 0 0 1 8 8v8H46z" fill={BACK} />
            <circle cx="56" cy="46" r="2.2" fill={LINE} />
            <circle cx="64" cy="46" r="2.2" fill={LINE} />
            <circle cx="72" cy="46" r="2.2" fill={LINE} />
            {/* an unplugged cable: two ends that don't meet */}
            <path
              d="M58 98h18a6 6 0 0 0 6-6v-2"
              fill="none"
              stroke={LINE}
              strokeWidth="3"
              strokeLinecap="round"
            />
            <rect x="77" y="78" width="10" height="12" rx="2.5" fill={MARK} />
            <path d="M80 78v-5M84 78v-5" stroke={MARK} strokeWidth="2" strokeLinecap="round" />
            <path
              d="M142 98h-18a6 6 0 0 1-6-6v-2"
              fill="none"
              stroke={LINE}
              strokeWidth="3"
              strokeLinecap="round"
            />
            <rect x="113" y="70" width="10" height="20" rx="2.5" fill={MARK} />
            <path
              d="M96 70l4 6M104 70l-4 6M100 64v4"
              stroke={MARK}
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </>
        )}
      </Scene>
    </svg>
  );
}
