import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { isAtBottom } from "../lib/scroll";

/**
 * Keeps a scroll container pinned to the bottom while content streams in, but
 * only while the user is already there.
 *
 * This replaces an unconditional `scrollTop = scrollHeight` on every content
 * change, which made the view impossible to scroll: streaming updates every
 * frame, so any attempt to scroll up was overwritten on the next frame. The
 * content was not just snapping back, it was actively fighting the user.
 *
 * The rule now is the one every chat UI uses: follow new content while the user
 * is at the bottom, and stop the moment they scroll away. `jumpToBottom` is
 * offered so returning is one click rather than a long drag.
 *
 * The listener is attached through a callback ref rather than an effect with an
 * empty dependency list, because the container is conditionally rendered in some
 * callers - an effect would run once while the node was still `null` and never
 * attach.
 */
export function useStickToBottom<T extends HTMLElement>() {
  const [pinned, setPinned] = useState(true);

  // Read inside the layout effect, which must not re-subscribe when this flips.
  const pinnedRef = useRef(true);
  const nodeRef = useRef<T | null>(null);
  const detachRef = useRef<(() => void) | null>(null);

  const scrollRef = useCallback((node: T | null) => {
    detachRef.current?.();
    detachRef.current = null;
    nodeRef.current = node;

    if (!node) return;

    const onScroll = () => {
      const atBottom = isAtBottom(node);
      pinnedRef.current = atBottom;
      setPinned(atBottom);
    };

    node.addEventListener("scroll", onScroll, { passive: true });
    detachRef.current = () => node.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => () => detachRef.current?.(), []);

  // Runs after every render, which is exactly when content may have grown. It
  // writes scrollTop only while pinned, so a user who scrolled away is left
  // alone - no scroll event fires, so no state churn either.
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (node && pinnedRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  });

  const jumpToBottom = useCallback(() => {
    const node = nodeRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    pinnedRef.current = true;
    setPinned(true);
  }, []);

  return { scrollRef, pinned, jumpToBottom };
}
