export type ProjectSource = "url" | "scratch";

export interface VersionInfo {
  version: number;
  createdAt: string;
  status: string;
  errorMessage?: string;
}

export interface Project {
  slug: string;
  url: string;
  source?: ProjectSource;
  title?: string;
  tags?: string[];
  status: string;
  createdAt: string;
  currentVersion?: number;
  totalVersions?: number;
  versions?: VersionInfo[];
  publishedDomain?: string | null;
  publishedVersion?: number | null;
  thumbnailUrl?: string | null;
  publicPreviewEnabled?: boolean;
  enabledPlugins?: string[];
}

export interface ProjectCardProps {
  project: Project;
  availableTags: string[];
  tagColorMap: Record<string, string>;
  onRegenerate: (slug: string, version?: number) => void;
  onDelete: (slug: string) => void;
  isRegenerating: boolean;
}
