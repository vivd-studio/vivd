import {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trpc } from "@/lib/trpc";
import { BRAND_NAME, formatDocumentTitle } from "@/lib/brand";
import { toast } from "sonner";
import { ROUTES } from "@/app/router";
import { useAppConfig } from "@/lib/AppConfigContext";
import { scratchSchema, type ScratchValues, type StylePreset } from "./types";

type SiteTheme = "dark" | "light" | null;

type UploadPhase =
  | "idle"
  | "creating"
  | "uploading"
  | "starting"
  | "generating";

type UploadProgress = {
  uploadedBytes: number;
  totalBytes: number;
  uploadedFiles: number;
  totalFiles: number;
};

// Limits
const MAX_TOTAL_FILES = 200;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024; // 500MB
const BATCH_SIZE = 20;

type ScratchWizardContextValue = {
  // Form
  form: UseFormReturn<ScratchValues>;
  watchedTitle: string;
  referenceUrls: string[];

  // Style
  stylePreset: StylePreset | null;
  setStylePreset: (preset: StylePreset | null) => void;
  isStyleExact: boolean;
  setIsStyleExact: (exact: boolean) => void;
  siteTheme: SiteTheme;
  setSiteTheme: (theme: SiteTheme) => void;

  // Assets
  assets: File[];
  setAssets: React.Dispatch<React.SetStateAction<File[]>>;
  referenceImages: File[];
  setReferenceImages: React.Dispatch<React.SetStateAction<File[]>>;

  // Generation state
  started:
    | {
        slug: string;
        version: number;
        expectsStudioHandoff?: boolean;
        initialSessionId?: string | null;
      }
    | undefined;
  statusData: { status: string } | undefined;
  isGenerating: boolean;
  progress: number;

  // Upload state (new)
  uploadPhase: UploadPhase;
  uploadProgress: UploadProgress;
  validationError: string | null;

  // Actions
  submit: (values: ScratchValues) => Promise<void>;
};

const ScratchWizardContext = createContext<ScratchWizardContextValue | null>(
  null,
);

export function useScratchWizard() {
  const ctx = useContext(ScratchWizardContext);
  if (!ctx) {
    throw new Error(
      "useScratchWizard must be used within a ScratchWizardProvider",
    );
  }
  return ctx;
}

/**
 * Upload files in batches using XHR for progress tracking.
 */
async function uploadFilesBatched(
  files: File[],
  slug: string,
  version: number,
  pathPrefix: string,
  onProgress: (uploaded: number, total: number) => void,
  abortSignal?: AbortSignal,
): Promise<void> {
  if (files.length === 0) return;

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  let completedBytes = 0;

  // Split into batches
  const batches: File[][] = [];
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    batches.push(files.slice(i, i + BATCH_SIZE));
  }

  for (const batch of batches) {
    if (abortSignal?.aborted) {
      throw new Error("Upload cancelled");
    }

    const batchBytes = batch.reduce((sum, f) => sum + f.size, 0);

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();

      for (const file of batch) {
        formData.append("files", file);
      }

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const inFlightProgress = e.loaded / e.total;
          const currentTotal = completedBytes + batchBytes * inFlightProgress;
          onProgress(currentTotal, totalBytes);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          completedBytes += batchBytes;
          onProgress(completedBytes, totalBytes);
          resolve();
        } else {
          let message = "Upload failed";
          try {
            const resp = JSON.parse(xhr.responseText);
            message = resp.error || message;
          } catch {
            // ignore
          }
          reject(new Error(message));
        }
      };

      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.onabort = () => reject(new Error("Upload cancelled"));

      if (abortSignal) {
        abortSignal.addEventListener("abort", () => xhr.abort());
      }

      xhr.open(
        "POST",
        `/vivd-studio/api/upload/${slug}/${version}?path=${pathPrefix}`,
      );
      xhr.withCredentials = true;
      xhr.send(formData);
    });
  }
}

export function ScratchWizardProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const utils = trpc.useUtils();
  const { config } = useAppConfig();
  const lastHandoffDestinationRef = useRef<string | null>(null);

  // Set document title
  useEffect(() => {
    document.title = formatDocumentTitle("Create Site");
    return () => {
      document.title = BRAND_NAME;
    };
  }, []);

  const [stylePreset, setStylePreset] = useState<StylePreset | null>(null);
  const [isStyleExact, setIsStyleExact] = useState(false);
  const [siteTheme, setSiteTheme] = useState<SiteTheme>(null);
  const [assets, setAssets] = useState<File[]>([]);
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [started, setStarted] = useState<{
    slug: string;
    version: number;
    expectsStudioHandoff?: boolean;
    initialSessionId?: string | null;
  }>();

  // New upload state
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    uploadedBytes: 0,
    totalBytes: 0,
    uploadedFiles: 0,
    totalFiles: 0,
  });
  const [validationError, setValidationError] = useState<string | null>(null);

  const form = useForm<ScratchValues>({
    resolver: zodResolver(scratchSchema),
    defaultValues: {
      title: "",
      businessType: "",
      description: "",
      referenceUrlsText: "",
    },
  });

  const watchedTitle = form.watch("title");
  const referenceUrlsText = form.watch("referenceUrlsText") || "";
  const referenceUrls = useMemo(() => {
    return referenceUrlsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [referenceUrlsText]);

  // Mutations for 3-step flow
  const { mutateAsync: createDraft } =
    trpc.project.createScratchDraft.useMutation({
      onError: (error) => {
        toast.error("Failed to create project", { description: error.message });
      },
    });

  const { mutateAsync: startGeneration } =
    trpc.project.startScratchGeneration.useMutation({
      onError: (error) => {
        toast.error("Failed to start generation", {
          description: error.message,
        });
      },
    });

  const { data: statusData } = trpc.project.status.useQuery(
    started ? { slug: started.slug, version: started.version } : { slug: "" },
    {
      enabled: !!started?.slug,
      refetchInterval: 1500,
    },
  );

  const navigateToStartedProjectStudio = useCallback(
    (slug: string, version: number, initialSessionId?: string | null) => {
      utils.project.list.invalidate();

      const params = new URLSearchParams({
        version: String(version),
        initialGeneration: "1",
      });
      if (initialSessionId) {
        params.set("sessionId", initialSessionId);
      }

      const destination = config.singleProjectMode
        ? `${ROUTES.PROJECT_STUDIO_FULLSCREEN(slug)}?${params.toString()}`
        : `${ROUTES.PROJECT(slug)}?view=studio&${params.toString()}`;

      const currentLocation = `${location.pathname}${location.search}`;
      if (
        currentLocation === destination ||
        lastHandoffDestinationRef.current === destination
      ) {
        return;
      }

      lastHandoffDestinationRef.current = destination;
      navigate(destination, { replace: true });
    },
    [
      config.singleProjectMode,
      location.pathname,
      location.search,
      navigate,
      utils.project.list,
    ],
  );

  const polledInitialSessionId =
    statusData && "studioHandoff" in statusData
      ? statusData.studioHandoff?.sessionId ?? null
      : null;

  useEffect(() => {
    if (!statusData || !started) return;
    const initialSessionId = started.initialSessionId ?? polledInitialSessionId;
    const studioHandoffRequested =
      started.expectsStudioHandoff ||
      ("studioHandoff" in statusData &&
        statusData.studioHandoff?.mode === "studio_astro");
    const studioStartupObserved =
      statusData.status === "starting_studio" ||
      statusData.status === "generating_initial_site" ||
      statusData.status === "completed";
    if (
      studioHandoffRequested &&
      studioStartupObserved
    ) {
      navigateToStartedProjectStudio(
        started.slug,
        started.version,
        initialSessionId,
      );
      return;
    }
    if (statusData.status === "completed") {
      toast.success("Your first draft is ready");
      utils.project.list.invalidate();
      navigate(ROUTES.PROJECT(started.slug));
    }
    if (statusData.status === "failed") {
      setUploadPhase("idle");
      const errorMessage =
        (statusData as { errorMessage?: string }).errorMessage ||
        "Try again or adjust your description.";
      toast.error("Generation failed", {
        description: errorMessage,
      });
    }
  }, [
    statusData?.status,
    polledInitialSessionId,
    started?.slug,
    started?.version,
    started?.initialSessionId,
    navigateToStartedProjectStudio,
    navigate,
    utils.project.list,
  ]);

  const isGenerating = uploadPhase !== "idle";

  const submit = useCallback(
    async (values: ScratchValues) => {
      // Client-side validation
      const totalFiles = assets.length + referenceImages.length;
      const totalBytes = [...assets, ...referenceImages].reduce(
        (sum, f) => sum + f.size,
        0,
      );

      if (totalFiles > MAX_TOTAL_FILES) {
        setValidationError(
          `Too many files (${totalFiles}). Maximum is ${MAX_TOTAL_FILES} files.`,
        );
        toast.error("Too many files", {
          description: `Maximum is ${MAX_TOTAL_FILES} files.`,
        });
        return;
      }

      if (totalBytes > MAX_TOTAL_BYTES) {
        const mb = Math.round(totalBytes / (1024 * 1024));
        setValidationError(
          `Files too large (${mb}MB). Maximum is ${MAX_TOTAL_BYTES / (1024 * 1024)}MB.`,
        );
        toast.error("Files too large", {
          description: `Maximum is ${MAX_TOTAL_BYTES / (1024 * 1024)}MB total.`,
        });
        return;
      }

      setValidationError(null);

      try {
        // Step 1: Create draft
        setUploadPhase("creating");
        const draftResult = await createDraft({
          title: values.title,
          description: values.description,
          businessType: values.businessType || undefined,
          stylePreset: stylePreset?.name,
          stylePalette: stylePreset?.palette,
          styleMode: stylePreset
            ? isStyleExact
              ? "exact"
              : "reference"
            : undefined,
          siteTheme: siteTheme || undefined,
          referenceUrls: referenceUrls.length ? referenceUrls : undefined,
        });

        const { slug, version } = draftResult;
        setStarted({ slug, version });
        utils.project.list.invalidate();

        // Step 2: Upload files
        if (assets.length > 0 || referenceImages.length > 0) {
          setUploadPhase("uploading");
          const totalUploadFiles = assets.length + referenceImages.length;
          const totalUploadBytes = [...assets, ...referenceImages].reduce(
            (sum, f) => sum + f.size,
            0,
          );

          setUploadProgress({
            uploadedBytes: 0,
            totalBytes: totalUploadBytes,
            uploadedFiles: 0,
            totalFiles: totalUploadFiles,
          });

          let completedAssetBytes = 0;
          const assetBytes = assets.reduce((sum, f) => sum + f.size, 0);

          // Upload brand assets
          if (assets.length > 0) {
            await uploadFilesBatched(
              assets,
              slug,
              version,
              "images",
              (uploaded, _total) => {
                setUploadProgress((prev) => ({
                  ...prev,
                  uploadedBytes: uploaded,
                  uploadedFiles: Math.floor(
                    (uploaded / assetBytes) * assets.length,
                  ),
                }));
              },
            );
            completedAssetBytes = assetBytes;
          }

          // Upload reference images
          if (referenceImages.length > 0) {
            await uploadFilesBatched(
              referenceImages,
              slug,
              version,
              "references",
              (uploaded, _total) => {
                setUploadProgress((prev) => ({
                  ...prev,
                  uploadedBytes: completedAssetBytes + uploaded,
                  uploadedFiles:
                    assets.length +
                    Math.floor(
                      (uploaded /
                        referenceImages.reduce((s, f) => s + f.size, 0)) *
                        referenceImages.length,
                    ),
                }));
              },
            );
          }
        }

        // Step 3: Start generation
        setUploadPhase("starting");
        const generationResult = await startGeneration({ slug, version });
        const initialSessionId =
          "studioHandoff" in generationResult
            ? generationResult.studioHandoff?.sessionId ?? null
            : null;
        if (
          "studioHandoff" in generationResult &&
          generationResult.studioHandoff?.mode === "studio_astro"
        ) {
          setStarted((current) =>
            current && current.slug === slug && current.version === version
              ? {
                  ...current,
                  expectsStudioHandoff: true,
                  initialSessionId,
                }
              : current,
          );
        }

        setUploadPhase("generating");

        if (
          "studioHandoff" in generationResult &&
          generationResult.studioHandoff?.mode === "studio_astro"
        ) {
          navigateToStartedProjectStudio(slug, version, initialSessionId);
          return;
        }
      } catch (error) {
        setUploadPhase("idle");
        console.error("Scratch generation error:", error);
        if (error instanceof Error && error.message !== "Upload cancelled") {
          toast.error("Generation failed", { description: error.message });
        }
      }
    },
    [
      assets,
      referenceImages,
      stylePreset,
      isStyleExact,
      siteTheme,
      referenceUrls,
      createDraft,
      startGeneration,
      navigateToStartedProjectStudio,
      utils.project.list,
    ],
  );

  const progress = useMemo(() => {
    // Upload phase progress
    if (uploadPhase === "creating") return 5;
    if (uploadPhase === "uploading") {
      const uploadPct =
        uploadProgress.totalBytes > 0
          ? (uploadProgress.uploadedBytes / uploadProgress.totalBytes) * 30
          : 0;
      return 5 + uploadPct; // 5-35%
    }
    if (uploadPhase === "starting") return 40;

    // Generation phase progress
    const status = statusData?.status;
    if (!status) return 0;
    if (status === "pending") return 45;
    if (status === "uploading_assets") return 35;
    if (status === "capturing_references") return 50;
    if (status === "analyzing_images") return 60;
    if (status === "starting_studio") return 70;
    if (status === "generating_initial_site") return 85;
    if (status === "generating_html") return 75;
    if (status === "completed") return 100;
    if (status === "failed") return 100;
    return 50;
  }, [uploadPhase, uploadProgress, statusData?.status]);

  const value: ScratchWizardContextValue = {
    form,
    watchedTitle,
    referenceUrls,
    stylePreset,
    setStylePreset,
    isStyleExact,
    setIsStyleExact,
    siteTheme,
    setSiteTheme,
    assets,
    setAssets,
    referenceImages,
    setReferenceImages,
    started,
    statusData,
    isGenerating,
    progress,
    uploadPhase,
    uploadProgress,
    validationError,
    submit,
  };

  return (
    <ScratchWizardContext.Provider value={value}>
      {children}
    </ScratchWizardContext.Provider>
  );
}
