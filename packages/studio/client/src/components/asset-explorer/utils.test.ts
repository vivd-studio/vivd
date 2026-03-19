import { describe, expect, it } from "vitest";
import { File, FileCode, FileText, Image as ImageIcon } from "lucide-react";
import { getFileTreeIconComponent } from "./utils";

describe("getFileTreeIconComponent", () => {
  it("uses chevrons only for folders by omitting a folder icon", () => {
    expect(
      getFileTreeIconComponent({
        name: "src",
        type: "folder",
        path: "src",
      })
    ).toBeNull();
  });

  it("returns neutral file icons for common asset types", () => {
    expect(
      getFileTreeIconComponent({
        name: "hero.png",
        type: "file",
        path: "hero.png",
        isImage: true,
      })
    ).toMatchObject({
      icon: ImageIcon,
      className: "text-muted-foreground",
    });

    expect(
      getFileTreeIconComponent({
        name: "index.tsx",
        type: "file",
        path: "src/index.tsx",
      })
    ).toMatchObject({
      icon: FileCode,
      className: "text-muted-foreground",
    });

    expect(
      getFileTreeIconComponent({
        name: "deck.pdf",
        type: "file",
        path: "deck.pdf",
        mimeType: "application/pdf",
      })
    ).toMatchObject({
      icon: FileText,
      className: "text-muted-foreground",
    });

    expect(
      getFileTreeIconComponent({
        name: "archive.zip",
        type: "file",
        path: "archive.zip",
      })
    ).toMatchObject({
      icon: File,
      className: "text-muted-foreground",
    });
  });
});
