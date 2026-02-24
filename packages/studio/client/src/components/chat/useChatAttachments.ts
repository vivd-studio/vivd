import { useCallback, useState } from "react";
import { getVivdStudioToken, VIVD_STUDIO_TOKEN_HEADER } from "@/lib/studioAuth";
import { formatMessageWithSelector } from "./SelectedElementPill";
import type { AttachedElement, AttachedFile, AttachedImage } from "./chatTypes";

const DEFAULT_TASK = "I want to change this element";

type UseChatAttachmentsArgs = {
  projectSlug: string;
  version?: number;
};

export function useChatAttachments({
  projectSlug,
  version,
}: UseChatAttachmentsArgs) {
  const [attachedElement, setAttachedElement] =
    useState<AttachedElement | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

  const addAttachedImages = useCallback((images: AttachedImage[]) => {
    setAttachedImages((prev) => [...prev, ...images]);
  }, []);

  const removeAttachedImage = useCallback((tempId: string) => {
    setAttachedImages((prev) => {
      const toRemove = prev.find((img) => img.tempId === tempId);
      if (toRemove) {
        URL.revokeObjectURL(toRemove.previewUrl);
      }
      return prev.filter((img) => img.tempId !== tempId);
    });
  }, []);

  const addAttachedFile = useCallback((file: AttachedFile) => {
    setAttachedFiles((prev) => {
      if (prev.some((f) => f.path === file.path)) {
        return prev;
      }
      return [...prev, file];
    });
  }, []);

  const removeAttachedFile = useCallback((id: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const buildTaskWithAttachments = useCallback(
    async (rawInput: string): Promise<string> => {
      let task = rawInput.trim() || DEFAULT_TASK;

      if (attachedElement) {
        task = formatMessageWithSelector(
          task,
          attachedElement.selector,
          attachedElement.filename,
          attachedElement.text,
          attachedElement.astroSourceFile,
          attachedElement.astroSourceLoc,
        );
      }

      if (attachedImages.length > 0 && version) {
        try {
          const uploadedPaths: string[] = [];
          for (const image of attachedImages) {
            const formData = new FormData();
            formData.append("file", image.file);

            const token = getVivdStudioToken();
            const headers = new Headers();
            if (token) {
              headers.set(VIVD_STUDIO_TOKEN_HEADER, token);
            }

            const response = await fetch(
              `/vivd-studio/api/upload-dropped-file/${projectSlug}/${version}`,
              {
                method: "POST",
                body: formData,
                credentials: "include",
                headers,
              },
            );

            if (!response.ok) {
              console.error("Failed to upload file:", image.file.name);
              continue;
            }

            const data = await response.json();
            uploadedPaths.push(data.path);
          }

          for (const imagePath of uploadedPaths) {
            const filename = imagePath.split("/").pop() || "file";
            task += `\n<vivd-internal type="dropped-file" filename="${filename}" path="${imagePath}" />`;
          }

          for (const image of attachedImages) {
            URL.revokeObjectURL(image.previewUrl);
          }
          setAttachedImages([]);
        } catch (error) {
          console.error("Error uploading dropped images:", error);
        }
      }

      if (attachedFiles.length > 0) {
        for (const file of attachedFiles) {
          task += `\n<vivd-internal type="attached-file" filename="${file.filename}" path="${file.path}" />`;
        }
        setAttachedFiles([]);
      }

      return task;
    },
    [attachedElement, attachedFiles, attachedImages, projectSlug, version],
  );

  return {
    attachedElement,
    setAttachedElement,
    attachedImages,
    addAttachedImages,
    removeAttachedImage,
    attachedFiles,
    addAttachedFile,
    removeAttachedFile,
    buildTaskWithAttachments,
  };
}
