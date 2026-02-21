import { afterEach, describe, expect, it, vi } from "vitest";
import { getEmailDeliveryService } from "../src/services/integrations/EmailDeliveryService";

describe("EmailDeliveryService", () => {
  afterEach(() => {
    delete process.env.EMAIL_PROVIDER;
    vi.restoreAllMocks();
  });

  it("uses noop provider by default", async () => {
    const service = getEmailDeliveryService();
    const result = await service.send({
      to: ["team@example.com"],
      subject: "Test",
      text: "Hello",
    });

    expect(service.providerName).toBe("noop");
    expect(result.accepted).toBe(true);
    expect(result.provider).toBe("noop");
  });

  it("falls back to noop for unsupported providers", async () => {
    process.env.EMAIL_PROVIDER = "unknown-provider";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const service = getEmailDeliveryService();
    expect(service.providerName).toBe("noop");
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
