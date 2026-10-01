import { useEffect, useRef, useState } from "react";

/** An element's width as it resizes; 0 until it is laid out. */
export const useElementWidth = <E extends HTMLElement>() => {
  const ref = useRef<E>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
};
