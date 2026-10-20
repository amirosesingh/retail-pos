import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TerminalRegistrationDetails } from "@/components/shared/TerminalRegistrationDetails";
import { registrationOrigin } from "@/lib/registration-origin";

describe("verified terminal registration details", () => {
  it("shows branch, device and connection origins without credentials or token payloads", () => {
    const html = renderToStaticMarkup(createElement(TerminalRegistrationDetails, { details: {
      tokenId: "terminal-id", deviceName: "Counter 2", locationName: "Shop 3 — S3",
      backendUrl: "https://user:secret@beta-pos.example.com/path?key=private",
      supabaseUrl: "https://project.example.com/rest/v1?apikey=private",
    } }));
    for (const value of ["Counter 2", "Shop 3", "terminal-id", "https://beta-pos.example.com", "https://project.example.com"]) expect(html).toContain(value);
    for (const value of ["secret", "private", "apikey", "user:"]) expect(html).not.toContain(value);
    expect(html).toContain("break-all");
  });
  it("does not render invalid addresses or claim a missing assignment", () => {
    expect(registrationOrigin("javascript:alert(1)")).toBe("Not configured");
    expect(registrationOrigin()).toBe("Not configured");
    expect(renderToStaticMarkup(createElement(TerminalRegistrationDetails, { details: { tokenId: "id" } }))).toContain("Not assigned");
  });
});
