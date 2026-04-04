import { describe, expect, it } from "vitest";

import {
  resolveAndroidArtifactChannel,
  resolveAndroidDownloadInfo,
} from "../../react-app/services/androidAppDownload";

describe("androidAppDownload", () => {
  it("resolves the development artifact for local environments", () => {
    expect(resolveAndroidArtifactChannel("localhost", "development")).toBe("dev");
    expect(resolveAndroidArtifactChannel("192.168.0.12", "production")).toBe("dev");
  });

  it("resolves the internal artifact for preview-like hosts", () => {
    expect(resolveAndroidArtifactChannel("internal.fitloot.app", "production")).toBe("internal");
    expect(resolveAndroidArtifactChannel("preview-fitloot.vercel.app", "production")).toBe("internal");
  });

  it("resolves the release artifact for the public production host", () => {
    const downloadInfo = resolveAndroidDownloadInfo({
      hostname: "fitloot.vercel.app",
      origin: "https://fitloot.vercel.app",
      mode: "production",
    });

    expect(downloadInfo).not.toBeNull();
    expect(downloadInfo?.channel).toBe("release");
    expect(downloadInfo?.href).toMatch(/^https:\/\/fitloot\.vercel\.app\/FitLoot\.apk\?v=/);
    expect(downloadInfo?.fileName).toBe("FitLoot.apk");
  });
});
