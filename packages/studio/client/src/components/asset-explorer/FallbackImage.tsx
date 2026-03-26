import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from "react";

interface FallbackImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> {
  srcs: string[];
  fallback?: ReactNode;
}

export function FallbackImage({
  srcs,
  fallback = null,
  onError,
  ...imgProps
}: FallbackImageProps) {
  const candidates = Array.from(
    new Set(
      srcs.filter((src): src is string => typeof src === "string" && src.length > 0),
    ),
  );
  const candidateKey = candidates.join("\n");
  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidateKey]);

  const currentSrc = candidates[candidateIndex];
  if (!currentSrc) {
    return <>{fallback}</>;
  }

  return (
    <img
      {...imgProps}
      src={currentSrc}
      onError={(event) => {
        if (candidateIndex < candidates.length - 1) {
          setCandidateIndex((index) => index + 1);
          return;
        }
        onError?.(event);
      }}
    />
  );
}
