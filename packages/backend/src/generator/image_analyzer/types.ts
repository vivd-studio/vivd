export interface ImageInfo {
    filename: string;
    relativePath?: string;
    absolutePath?: string;
    width: number;
    height: number;
    description?: string;
    priorityIndex?: number;
    analyzed?: boolean;
}
