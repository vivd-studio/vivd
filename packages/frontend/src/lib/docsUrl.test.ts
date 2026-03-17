import { describe, expect, it } from "vitest";
import { buildDocsUrl } from "./docsUrl";

describe("buildDocsUrl", () => {
  it("maps localhost app access to docs.localhost", () => {
    expect(
      buildDocsUrl({
        currentHost: "localhost:5173",
        pathname: "/getting-started/",
      }),
    ).toBe("http://docs.localhost/getting-started/");
  });

  it("prefers the configured control-plane host when present", () => {
    expect(
      buildDocsUrl({
        currentHost: "acme.vivd.studio",
        controlPlaneHost: "app.vivd.studio",
        pathname: "/publish-your-site/",
      }),
    ).toBe("https://docs.vivd.studio/publish-your-site/");
  });

  it("keeps nip.io-based local hosts on http", () => {
    expect(
      buildDocsUrl({
        controlPlaneHost: "app.127.0.0.1.nip.io",
      }),
    ).toBe("http://docs.127.0.0.1.nip.io/");
  });
});
