import {
  createContext,
  useContext,
  useState,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  scratchSchema,
  fileToBase64,
  type ScratchValues,
  type StylePreset,
} from "./types";

type SiteTheme = "dark" | "light" | null;

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
  started: { slug: string; version: number } | undefined;
  statusData: { status: string } | undefined;
  isGenerating: boolean;
  progress: number;

  // Actions
  submit: (values: ScratchValues) => Promise<void>;
};

const ScratchWizardContext = createContext<ScratchWizardContextValue | null>(
  null
);

export function useScratchWizard() {
  const ctx = useContext(ScratchWizardContext);
  if (!ctx) {
    throw new Error(
      "useScratchWizard must be used within a ScratchWizardProvider"
    );
  }
  return ctx;
}

export function ScratchWizardProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const [stylePreset, setStylePreset] = useState<StylePreset | null>(null);
  const [isStyleExact, setIsStyleExact] = useState(false);
  const [siteTheme, setSiteTheme] = useState<SiteTheme>(null);
  const [assets, setAssets] = useState<File[]>([]);
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [started, setStarted] = useState<{ slug: string; version: number }>();

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

  const { mutateAsync: generateFromScratch, isPending: isGenerating } =
    trpc.project.generateFromScratch.useMutation({
      onError: (error) => {
        toast.error("Failed to start generation", {
          description: error.message,
        });
      },
      onSuccess: (data) => {
        setStarted({ slug: data.slug, version: data.version ?? 1 });
        utils.project.list.invalidate();
      },
    });

  const { data: statusData } = trpc.project.status.useQuery(
    started ? { slug: started.slug, version: started.version } : { slug: "" },
    {
      enabled: !!started?.slug,
      refetchInterval: 1500,
    }
  );

  useEffect(() => {
    if (!statusData || !started) return;
    if (statusData.status === "completed") {
      toast.success("Your first draft is ready");
      utils.project.list.invalidate();
      navigate(`/vivd-studio/projects/${started.slug}`);
    }
    if (statusData.status === "failed") {
      toast.error("Generation failed", {
        description: "Try again or adjust your description.",
      });
    }
  }, [
    statusData?.status,
    started?.slug,
    started?.version,
    navigate,
    utils.project.list,
  ]);

  const submit = async (values: ScratchValues) => {
    const assetPayload = await Promise.all(
      assets.map(async (file) => ({
        filename: file.name,
        base64: await fileToBase64(file),
      }))
    );
    const referenceImagePayload = await Promise.all(
      referenceImages.map(async (file) => ({
        filename: file.name,
        base64: await fileToBase64(file),
      }))
    );

    await generateFromScratch({
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
      assets: assetPayload.length ? assetPayload : undefined,
      referenceImages: referenceImagePayload.length
        ? referenceImagePayload
        : undefined,
    });
  };

  const progress = useMemo(() => {
    const status = statusData?.status;
    if (!status) return 0;
    if (status === "pending") return 10;
    if (status === "generating_html") return 60;
    if (status === "completed") return 100;
    if (status === "failed") return 100;
    return 30;
  }, [statusData?.status]);

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
    submit,
  };

  return (
    <ScratchWizardContext.Provider value={value}>
      {children}
    </ScratchWizardContext.Provider>
  );
}
