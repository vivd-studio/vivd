import {
  StatTile,
  StatTileHelper,
  StatTileLabel,
  StatTileValue,
} from "@vivd/ui";

export function StatCard({
  label,
  value,
  caption,
}: {
  label: string;
  value: string;
  caption?: string;
}) {
  return (
    <StatTile>
      <StatTileLabel>{label}</StatTileLabel>
      <StatTileValue>{value}</StatTileValue>
      {caption ? <StatTileHelper>{caption}</StatTileHelper> : null}
    </StatTile>
  );
}
