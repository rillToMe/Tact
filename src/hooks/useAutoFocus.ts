import { useEffect, useRef } from "react";

export function useAutoFocus<T extends HTMLElement>(enabled = true): React.RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (enabled && ref.current) {
      ref.current.focus();
      if ("select" in ref.current && typeof ref.current.select === "function") {
        ref.current.select();
      }
    }
  }, [enabled]);

  return ref;
}

export function useMountFocus<T extends HTMLElement>(): React.RefObject<T | null> {
  return useAutoFocus<T>(true);
}
