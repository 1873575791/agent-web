import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_DURATION_MS = 3000;

/**
 * @returns {{ toast: { text: string, variant?: string } | null, showToast: (text: string, variant?: string) => void, dismissToast: () => void }}
 */
export function useToast(durationMs = DEFAULT_DURATION_MS) {
  const [toast, setToast] = useState(null);
  const timerRef = useRef(null);

  const dismissToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback(
    (text, variant = "info") => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast({ text, variant });
      timerRef.current = setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, durationMs);
    },
    [durationMs],
  );

  useEffect(() => () => dismissToast(), [dismissToast]);

  return { toast, showToast, dismissToast };
}
