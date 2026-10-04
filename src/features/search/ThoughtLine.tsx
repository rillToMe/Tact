import { useEffect, useState } from "react";
import { useStickToBottom } from "../../hooks/useStickToBottom";
import { splitReasoningSteps } from "./reasoningSteps";
/** The glyph, inlined instead of pulling in an 80 MB icon package for one shape. */
function SparkleGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 3.5c.6 4.2 2.3 5.9 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5 4.2-.6 5.9-2.3 6.5-6.5Z" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function TickGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

interface ThoughtLineProps {
  /** The reasoning text streamed so far. */
  text: string;
  /** True while the model is still thinking; false once the reply has landed. */
  working: boolean;
}

/**
 * The live "thinking" indicator shown above an AI reply.
 *
 * Adapted from the React Bits `ThoughtLine` micro-interaction; the styling and
 * animation live in `index.css` under the same name.
 *
 * Two deliberate departures from the original:
 *
 * * The original drives its animations with `motion`. Both are plain opacity and
 *   transform keyframes, so they are CSS here - a 750 KB animation runtime would
 *   buy nothing.
 * * The original imports three Hugeicons glyphs, which is 80 MB of package for
 *   three shapes. They are inlined SVG.
 *
 * The steps are the model's own sentences, split on its own punctuation: the
 * last one pulses while it is being written, the ones before it are ticked. The
 * timer is kept because it makes a slow model look busy rather than stuck.
 */
export function ThoughtLine({ text, working }: ThoughtLineProps) {
  // A live turn starts expanded so the user can watch it think; a finished one
  // is reconstructed from history and starts collapsed, so an old trace cannot
  // push the answer it belongs to off screen.
  const [open, setOpen] = useState(working);
  const [elapsed, setElapsed] = useState(0);

  // Adjusting state during render is React's documented way to react to a prop
  // change. Doing it in an effect would render the previous turn's state first
  // and then immediately render again.
  const [wasWorking, setWasWorking] = useState(working);
  if (wasWorking !== working) {
    setWasWorking(working);
    if (working) {
      // A new turn: expand the trace and restart the clock.
      setOpen(true);
      setElapsed(0);
    } else {
      // The reply has started arriving, so collapse the trace. It stays one
      // click away rather than disappearing.
      setOpen(false);
    }
  }

  useEffect(() => {
    if (!working) return;
    const startedAt = performance.now();
    const id = window.setInterval(() => {
      setElapsed((performance.now() - startedAt) / 1000);
    }, 100);
    return () => window.clearInterval(id);
  }, [working]);

  const steps = splitReasoningSteps(text);
  const hasTrace = steps.length > 0;
  const label = working ? "Thinking…" : "Thought";

  // Keep the step being written in view as the list grows past the fold - but
  // only while the user is already at the bottom. An unconditional scroll here
  // had the same fault as the transcript's: the trace updates every frame, so
  // scrolling back to read an earlier step was overwritten immediately.
  //
  // No jump button here: the fold is a small, capped well inside a reply, and a
  // floating control inside it would be more clutter than help. The scroll
  // position alone is enough.
  const { scrollRef: foldAttach } = useStickToBottom<HTMLDivElement>();

  // A finished turn that was reconstructed from history has no measured
  // duration, and showing "0.0s" would be a lie. The timer is only rendered
  // when there is a real number behind it.
  const showTimer = working || elapsed > 0;

  return (
    <div
      className="thought-line"
      data-working={working ? "" : undefined}
      data-open={open && hasTrace ? "" : undefined}
    >
      <button
        type="button"
        className="thought-line__head"
        data-toggle={hasTrace ? "" : undefined}
        aria-expanded={hasTrace ? open : undefined}
        tabIndex={hasTrace ? 0 : -1}
        onClick={() => {
          if (hasTrace) setOpen((current) => !current);
        }}
      >
        <span className="thought-line__glyph" aria-hidden="true">
          <SparkleGlyph />
        </span>

        <span className="thought-line__label" aria-hidden="true">
          <span className="thought-line__text" data-active={working ? "" : undefined}>
            <span className="thought-line__breath">{label}</span>
          </span>
          <span
            className="thought-line__text thought-line__text--done"
            data-active={working ? undefined : ""}
          >
            {label}
          </span>
        </span>

        {showTimer && (
          <span
            className="thought-line__timer"
            data-done={working ? undefined : ""}
            aria-hidden="true"
          >
            {elapsed.toFixed(1)}s
          </span>
        )}

        <span
          className="thought-line__chevron"
          data-on={hasTrace ? "" : undefined}
          aria-hidden="true"
        >
          <ChevronGlyph />
        </span>

        {/* Announced once rather than per token: a screen reader reading every
            reasoning token would be unusable. */}
        <span className="thought-line__sr" role="status">
          {working
            ? "Thinking"
            : showTimer
              ? `Thought for ${elapsed.toFixed(1)} seconds`
              : "Thought"}
        </span>
      </button>

      {hasTrace && (
        <div className="thought-line__trace" data-open={open ? "" : undefined} aria-hidden={!open}>
          <div ref={foldAttach} className="thought-line__fold">
            <div className="thought-line__steps">
              {steps.map((step, index) => {
                // The last step is still being written while the model works;
                // every step is complete once it stops.
                const isActive = working && index === steps.length - 1;
                return (
                  <div
                    key={index}
                    className="thought-line__step"
                    data-active={isActive ? "" : undefined}
                  >
                    <span className="thought-line__mark" aria-hidden="true">
                      {isActive ? <i className="thought-line__pulse" /> : <TickGlyph />}
                    </span>
                    <span className="thought-line__step-text">{step}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
