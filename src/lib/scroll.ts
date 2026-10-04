/**
 * How close to the bottom still counts as "at the bottom", in pixels.
 *
 * Not zero, for two reasons: a fractional line height or a rounding error at a
 * fractional display scale can leave a pixel or two of scroll, and treating that
 * as "scrolled away" would silently stop the follow. 24px is under one line, so
 * a deliberate scroll away is still detected immediately.
 */
export const BOTTOM_THRESHOLD = 24;

export interface ScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

/**
 * True when the view is scrolled to (or effectively at) the bottom.
 *
 * Pure so the arithmetic can be tested without a DOM - which matters because
 * this is the rule that decides whether streaming content is allowed to move the
 * view, and getting it wrong in either direction is a visible bug: too eager and
 * the transcript cannot be scrolled at all, too shy and the follow never
 * engages.
 */
export function isAtBottom(
  { scrollHeight, scrollTop, clientHeight }: ScrollMetrics,
  threshold: number = BOTTOM_THRESHOLD,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}
