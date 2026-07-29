import { describe, expect, it } from "vitest";
import {
  EXTENSION_ZIP_DOWNLOAD_PROPS,
  EXTENSION_ZIP_FILENAME,
  EXTENSION_ZIP_URL,
} from "./extension";

describe("extension installer download", () => {
  it("points the install action to the public Motor Local ZIP", () => {
    expect(EXTENSION_ZIP_URL).toBe("/descargas/masstest-motor-local.zip");
    expect(EXTENSION_ZIP_FILENAME).toBe("masstest-motor-local.zip");
    expect(EXTENSION_ZIP_DOWNLOAD_PROPS).toEqual({
      href: "/descargas/masstest-motor-local.zip",
      download: "masstest-motor-local.zip",
    });
  });
});
