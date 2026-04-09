export type DetailedFileDiff = {
  file: string;
  additions: number;
  deletions: number;
  status?: "added" | "deleted" | "modified";
  patch?: string;
  before?: string;
  after?: string;
};
