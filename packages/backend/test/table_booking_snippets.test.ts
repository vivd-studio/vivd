import { describe, expect, it } from "vitest";
import { tableBookingPluginConfigSchema } from "@vivd/plugin-table-booking/backend/config";
import { getTableBookingSnippets } from "@vivd/plugin-table-booking/backend/snippets";

describe("table booking snippets", () => {
  it("renders inline availability loading and booking submission", () => {
    const token = "ppi_test.tablebooking";
    const endpoints = {
      availabilityEndpoint:
        "https://api.vivd.studio/plugins/table-booking/v1/availability",
      bookEndpoint: "https://api.vivd.studio/plugins/table-booking/v1/book",
    };

    const snippets = getTableBookingSnippets(
      token,
      endpoints,
      tableBookingPluginConfigSchema.parse({
        timezone: "Europe/Berlin",
        collectNotes: true,
      }),
    );

    expect(snippets.html).toContain(token);
    expect(snippets.html).toContain(endpoints.availabilityEndpoint);
    expect(snippets.html).toContain(endpoints.bookEndpoint);
    expect(snippets.html).toContain('data-vivd-table-booking-form');
    expect(snippets.html).toContain('data-vivd-booking-slots');
    expect(snippets.html).toContain('fetch(url.toString()');
    expect(snippets.html).toContain('fetch(form.action');
    expect(snippets.html).toContain('name="notes"');
    expect(snippets.html).toContain("Your booking request was confirmed. Please check your email.");
  });

  it("omits notes when disabled and keeps Astro inline script support", () => {
    const snippets = getTableBookingSnippets(
      "ppi_test.tablebooking",
      {
        availabilityEndpoint:
          "https://api.vivd.studio/plugins/table-booking/v1/availability",
        bookEndpoint: "https://api.vivd.studio/plugins/table-booking/v1/book",
      },
      tableBookingPluginConfigSchema.parse({
        timezone: "Europe/Berlin",
        collectNotes: false,
      }),
    );

    expect(snippets.astro).toContain("<script is:inline>");
    expect(snippets.astro).not.toContain('name="notes"');
    expect(snippets.astro).toContain("Book table");
  });
});
