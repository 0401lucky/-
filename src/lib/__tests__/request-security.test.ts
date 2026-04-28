import { describe, expect, it } from "vitest";
import { enforceTrustedApiRequest } from "../request-security";

function createRequest(
  headers: HeadersInit,
  url = "https://example.com/api/cards/draw",
): Request {
  return new Request(url, {
    method: "POST",
    headers,
  });
}

describe("request security guard", () => {
  it("allows unsafe API requests from the same origin", () => {
    const result = enforceTrustedApiRequest(
      createRequest({ origin: "https://example.com" }),
    );

    expect(result).toBeNull();
  });

  it("blocks unsafe API requests from untrusted origins", async () => {
    const result = enforceTrustedApiRequest(
      createRequest({ origin: "https://evil.example" }),
    );

    expect(result?.status).toBe(403);
    await expect(result?.json()).resolves.toMatchObject({
      success: false,
      message: "请求来源不合法",
    });
  });

  it("allows same-origin browser requests without an Origin header", () => {
    const result = enforceTrustedApiRequest(
      createRequest({ "sec-fetch-site": "same-origin" }),
    );

    expect(result).toBeNull();
  });

  it("blocks requests without a trustworthy browser or service signal", async () => {
    const result = enforceTrustedApiRequest(createRequest({}));

    expect(result?.status).toBe(403);
    await expect(result?.json()).resolves.toMatchObject({
      success: false,
      message: "缺少可信请求来源",
    });
  });

  it("allows internal service routes without browser headers", () => {
    const result = enforceTrustedApiRequest(
      createRequest({}, "https://example.com/api/internal/raffle/delivery"),
    );

    expect(result).toBeNull();
  });
});
