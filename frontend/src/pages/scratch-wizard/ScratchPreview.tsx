import { Card } from "@/components/ui/card";
import { Palette } from "lucide-react";
import { useScratchWizard } from "./ScratchWizardContext";
import { useTheme } from "@/components/theme";

export function ScratchPreview() {
  const { watchedTitle, stylePreset, siteTheme } = useScratchWizard();
  const { theme } = useTheme();

  // When siteTheme is null (Auto), follow the vivd UI theme
  const effectiveTheme = siteTheme ?? (theme === "light" ? "light" : "dark");
  const isDark = effectiveTheme === "dark";
  const bgClass = isDark ? "bg-zinc-900" : "bg-white";
  const textClass = isDark ? "text-white" : "text-zinc-900";
  const mutedTextClass = isDark ? "text-zinc-400" : "text-zinc-500";
  const mutedBgClass = isDark ? "bg-zinc-800" : "bg-zinc-200";
  const cardBgClass = isDark ? "bg-zinc-800/50" : "bg-zinc-100/80";
  const borderClass = isDark ? "border-zinc-700" : "border-zinc-200";

  return (
    <div className="flex-[6] p-8 flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <Palette className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Preview Idea</h2>
      </div>

      {/* Large preview card */}
      <Card
        className={`flex-1 relative overflow-hidden ${bgClass} ${borderClass} border transition-colors duration-300`}
      >
        {/* Dynamic background based on selected palette */}
        {stylePreset ? (
          <div
            className="absolute inset-0 opacity-20 transition-all duration-700"
            style={{
              background: `
                radial-gradient(ellipse at 20% 20%, ${stylePreset.palette[1]}40 0%, transparent 50%),
                radial-gradient(ellipse at 80% 80%, ${stylePreset.palette[2]}30 0%, transparent 50%),
                radial-gradient(ellipse at 50% 50%, ${stylePreset.palette[3]}20 0%, transparent 60%)
              `,
            }}
          />
        ) : null}

        <div className="relative h-full p-8 flex flex-col">
          {/* Mock header */}
          <div className="flex items-center justify-between mb-8">
            <div
              className={`text-xl font-bold tracking-tight transition-colors duration-300 ${textClass}`}
              style={{ color: stylePreset?.palette[1] }}
            >
              {watchedTitle || "Your Brand"}
            </div>
            <div className="flex items-center gap-4">
              {["Home", "About", "Services", "Contact"].map((item) => (
                <div
                  key={item}
                  className={`text-sm transition-colors duration-300 ${mutedTextClass}`}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          {/* Mock hero */}
          <div className="flex-1 flex flex-col justify-center max-w-xl">
            <div
              className={`h-12 w-4/5 rounded-lg mb-4 transition-all duration-500 ${mutedBgClass}`}
              style={{
                backgroundColor: stylePreset
                  ? `${stylePreset.palette[1]}30`
                  : undefined,
              }}
            />
            <div className="space-y-2 mb-6">
              <div className={`h-3 w-full rounded ${mutedBgClass}`} />
              <div className={`h-3 w-11/12 rounded ${mutedBgClass}`} />
              <div className={`h-3 w-9/12 rounded ${mutedBgClass}`} />
            </div>
            <div className="flex gap-3">
              <div
                className="h-11 w-32 rounded-lg transition-all duration-500"
                style={{
                  backgroundColor:
                    stylePreset?.palette[1] || "hsl(var(--primary))",
                }}
              />
              <div className={`h-11 w-32 rounded-lg border ${borderClass}`} />
            </div>
          </div>

          {/* Mock feature cards */}
          <div className="grid grid-cols-3 gap-4 mt-8">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`h-28 rounded-xl border transition-all duration-500 ${borderClass} ${cardBgClass}`}
                style={{
                  backgroundColor: stylePreset
                    ? `${stylePreset.palette[(i % 3) + 1]}08`
                    : undefined,
                }}
              />
            ))}
          </div>
        </div>

        {/* Style indicator */}
        <div
          className={`absolute bottom-4 right-4 flex items-center gap-2 px-3 py-1.5 rounded-full border ${borderClass} ${cardBgClass}`}
        >
          <span
            className={`h-2 w-2 rounded-full ${
              stylePreset ? "bg-primary" : mutedTextClass
            }`}
          />
          <span className={`text-xs ${mutedTextClass}`}>
            {stylePreset?.name || "No style selected"} • {siteTheme || "auto"}
          </span>
        </div>
      </Card>
    </div>
  );
}
