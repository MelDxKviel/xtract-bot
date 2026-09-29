import { describe, expect, it } from "vitest";

import { safeError } from "@/logging";

describe("safeError", () => {
  it("does not expose exception messages, stacks, or attached secrets", () => {
    const error = Object.assign(new Error("request failed with token super-secret"), {
      code: "ETIMEDOUT",
      authorization: "Bearer super-secret",
    });

    expect(safeError(error)).toEqual({ type: "Error", code: "ETIMEDOUT" });
    expect(JSON.stringify(safeError(error))).not.toContain("super-secret");
  });

  it("rejects unbounded error codes and non-error values", () => {
    const error = Object.assign(new Error("nope"), { code: "secret value with spaces" });
    expect(safeError(error)).toEqual({ type: "Error" });
    expect(safeError("sensitive string")).toEqual({ type: "UnknownError" });
  });
});
