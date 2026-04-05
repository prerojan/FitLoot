import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "public");
const GENERATED_DIR = path.join(PROJECT_ROOT, "src", "react-app", "generated");
const GENERATED_TS_PATH = path.join(GENERATED_DIR, "androidArtifacts.ts");
const PUBLIC_MANIFEST_PATH = path.join(PUBLIC_DIR, "android-artifacts.json");
const IS_HOSTED_BUILD =
  process.env.VERCEL === "1" || process.env.CI === "true";

/**
 * @typedef {"dev" | "internal" | "release"} AndroidArtifactChannel
 */

/**
 * @typedef {{
 *   channel: AndroidArtifactChannel;
 *   label: string;
 *   publicPath: string;
 *   fileName: string;
 *   available: boolean;
 *   sizeBytes: number | null;
 *   updatedAt: string | null;
 *   cacheBust: string | null;
 *   sourceFingerprint: string | null;
 * }} AndroidArtifactDescriptor
 */

const ARTIFACT_CONFIG = /** @type {const} */ ([
  {
    channel: "dev",
    label: "APK Android de desenvolvimento",
    fileName: "FitLoot-Dev.apk",
    publicPath: "/FitLoot-Dev.apk",
    legacyAliases: ["app-dev-debug.apk"],
    candidates: [
      "android/app/build/outputs/apk/dev/debug/app-dev-debug.apk",
    ],
  },
  {
    channel: "internal",
    label: "APK Android interno",
    fileName: "FitLoot-Internal.apk",
    publicPath: "/FitLoot-Internal.apk",
    legacyAliases: ["app-internal-debug.apk"],
    candidates: [
      "android/app/build/outputs/apk/internal/debug/app-internal-debug.apk",
    ],
  },
  {
    channel: "release",
    label: "APK Android FitLoot",
    fileName: "FitLoot.apk",
    publicPath: "/FitLoot.apk",
    legacyAliases: ["app-release.apk"],
    candidates: [
      "android/app/build/outputs/apk/prod/release/app-prod-release.apk",
      "android/app/build/outputs/apk/release/app-release.apk",
    ],
  },
]);

const ANDROID_FINGERPRINT_INPUTS = [
  "android/app/src",
  "android/app/build.gradle",
  "android/gradle.properties",
  "android/app/proguard-rules.pro",
];

async function collectFingerprintFiles(relativePath) {
  const absolutePath = path.join(PROJECT_ROOT, relativePath);
  try {
    const fileStats = await stat(absolutePath);
    if (fileStats.isFile()) {
      return [{ absolutePath, relativePath, mtimeMs: fileStats.mtimeMs }];
    }
    if (!fileStats.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const directoryEntries = await readdir(absolutePath, { withFileTypes: true });
  const collected = [];
  for (const entry of directoryEntries) {
    const entryRelativePath = path.posix.join(relativePath.replace(/\\/g, "/"), entry.name);
    if (entry.isDirectory()) {
      collected.push(...(await collectFingerprintFiles(entryRelativePath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const entryAbsolutePath = path.join(PROJECT_ROOT, entryRelativePath);
    const entryStats = await stat(entryAbsolutePath);
    collected.push({
      absolutePath: entryAbsolutePath,
      relativePath: entryRelativePath,
      mtimeMs: entryStats.mtimeMs,
    });
  }

  return collected.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function computeAndroidSourceFingerprint() {
  const files = [];
  for (const inputPath of ANDROID_FINGERPRINT_INPUTS) {
    files.push(...(await collectFingerprintFiles(inputPath)));
  }

  const hash = createHash("sha256");
  let latestSourceMtimeMs = 0;
  for (const file of files) {
    latestSourceMtimeMs = Math.max(latestSourceMtimeMs, file.mtimeMs);
    const content = await readFile(file.absolutePath);
    hash.update(file.relativePath.replace(/\\/g, "/"));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }

  return {
    fingerprint: hash.digest("hex"),
    latestSourceMtimeMs,
  };
}

async function fileExists(filePath) {
  try {
    const fileStats = await stat(filePath);
    return fileStats.isFile() ? fileStats : null;
  } catch {
    return null;
  }
}

async function resolveSourceArtifact(candidates) {
  for (const candidate of candidates) {
    const absoluteCandidatePath = path.join(PROJECT_ROOT, candidate);
    const candidateStats = await fileExists(absoluteCandidatePath);
    if (candidateStats) {
      return {
        absolutePath: absoluteCandidatePath,
        stats: candidateStats,
      };
    }
  }

  return null;
}

async function resolvePublicFallbackArtifact(fileName) {
  const publicFilePath = path.join(PUBLIC_DIR, fileName);
  const publicFileStats = await fileExists(publicFilePath);
  if (!publicFileStats) {
    return null;
  }

  return {
    absolutePath: publicFilePath,
    stats: publicFileStats,
  };
}

async function readExistingManifest() {
  try {
    const content = await readFile(PUBLIC_MANIFEST_PATH, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || !parsed.byChannel || typeof parsed.byChannel !== "object") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function resolveExistingDescriptor(existingManifest, config) {
  const descriptor = existingManifest?.byChannel?.[config.channel];
  if (!descriptor || typeof descriptor !== "object" || descriptor.available !== true) {
    return null;
  }

  return {
    channel: config.channel,
    label: config.label,
    publicPath: config.publicPath,
    fileName: config.fileName,
    available: true,
    sizeBytes: Number.isFinite(descriptor.sizeBytes) ? descriptor.sizeBytes : null,
    updatedAt: typeof descriptor.updatedAt === "string" ? descriptor.updatedAt : null,
    cacheBust: typeof descriptor.cacheBust === "string" ? descriptor.cacheBust : null,
    sourceFingerprint:
      typeof descriptor.sourceFingerprint === "string" ? descriptor.sourceFingerprint : null,
  };
}

function buildDescriptor(config, resolvedSource, sourceFingerprint) {
  if (!resolvedSource) {
    return {
      channel: config.channel,
      label: config.label,
      publicPath: config.publicPath,
      fileName: config.fileName,
      available: false,
      sizeBytes: null,
      updatedAt: null,
      cacheBust: null,
      sourceFingerprint: null,
    };
  }

  const updatedAt = resolvedSource.stats.mtime.toISOString();
  const cacheBust = `${Math.trunc(resolvedSource.stats.mtimeMs)}-${resolvedSource.stats.size}`;

  return {
    channel: config.channel,
    label: config.label,
    publicPath: config.publicPath,
    fileName: config.fileName,
    available: true,
    sizeBytes: resolvedSource.stats.size,
    updatedAt,
    cacheBust,
    sourceFingerprint,
  };
}

function buildTypeScriptManifest(manifest) {
  return `// Auto-generated by scripts/sync-android-artifacts.mjs. Do not edit manually.
export type AndroidArtifactChannel = "dev" | "internal" | "release";

export type AndroidArtifactDescriptor = {
  channel: AndroidArtifactChannel;
  label: string;
  publicPath: string;
  fileName: string;
  available: boolean;
  sizeBytes: number | null;
  updatedAt: string | null;
  cacheBust: string | null;
  sourceFingerprint: string | null;
};

export type AndroidArtifactManifest = {
  generatedAt: string;
  byChannel: Record<AndroidArtifactChannel, AndroidArtifactDescriptor>;
};

export const ANDROID_ARTIFACTS: AndroidArtifactManifest = ${JSON.stringify(manifest, null, 2)};\n`;
}

async function syncArtifacts() {
  await mkdir(PUBLIC_DIR, { recursive: true });
  await mkdir(GENERATED_DIR, { recursive: true });
  const existingManifest = await readExistingManifest();
  const androidSourceFingerprint = await computeAndroidSourceFingerprint();

  /** @type {Record<AndroidArtifactChannel, AndroidArtifactDescriptor>} */
  const byChannel = {
    dev: {
      channel: "dev",
      label: "",
      publicPath: "",
      fileName: "",
      available: false,
      sizeBytes: null,
      updatedAt: null,
      cacheBust: null,
      sourceFingerprint: null,
    },
    internal: {
      channel: "internal",
      label: "",
      publicPath: "",
      fileName: "",
      available: false,
      sizeBytes: null,
      updatedAt: null,
      cacheBust: null,
      sourceFingerprint: null,
    },
    release: {
      channel: "release",
      label: "",
      publicPath: "",
      fileName: "",
      available: false,
      sizeBytes: null,
      updatedAt: null,
      cacheBust: null,
      sourceFingerprint: null,
    },
  };

  for (const artifact of ARTIFACT_CONFIG) {
    const resolvedSource =
      (!IS_HOSTED_BUILD ? await resolveSourceArtifact(artifact.candidates) : null) ??
      (await resolvePublicFallbackArtifact(artifact.fileName));
    const preservedDescriptor = resolveExistingDescriptor(existingManifest, artifact);
    const publicFilePaths = [
      path.join(PUBLIC_DIR, artifact.fileName),
      ...(artifact.legacyAliases ?? []).map((alias) => path.join(PUBLIC_DIR, alias)),
    ];
    const isBuildOutputArtifact = Boolean(
      resolvedSource &&
        resolvedSource.absolutePath.includes(
          `${path.sep}android${path.sep}app${path.sep}build${path.sep}outputs${path.sep}`,
        ),
    );
    const isPublicFallbackArtifact = Boolean(
      resolvedSource &&
        resolvedSource.absolutePath.startsWith(PUBLIC_DIR + path.sep),
    );

    if (
      !IS_HOSTED_BUILD &&
      isBuildOutputArtifact &&
      resolvedSource &&
      resolvedSource.stats.mtimeMs < androidSourceFingerprint.latestSourceMtimeMs
    ) {
      throw new Error(
        `[sync-android-artifacts] ${artifact.channel} APK esta desatualizado em relacao ao codigo Android. Rebuild necessario antes do sync.`,
      );
    }

    if (
      isPublicFallbackArtifact &&
      preservedDescriptor?.sourceFingerprint &&
      preservedDescriptor.sourceFingerprint !== androidSourceFingerprint.fingerprint
    ) {
      throw new Error(
        `[sync-android-artifacts] ${artifact.channel} APK publicado nao corresponde ao fingerprint atual do codigo Android. Rebuild necessario antes do sync.`,
      );
    }

    if (resolvedSource) {
      for (const publicFilePath of publicFilePaths) {
        if (resolvedSource.absolutePath !== publicFilePath) {
          await copyFile(resolvedSource.absolutePath, publicFilePath);
        }
      }
    } else {
      if (!preservedDescriptor) {
        for (const publicFilePath of publicFilePaths) {
          await rm(publicFilePath, { force: true });
        }
      }
    }

    byChannel[artifact.channel] = resolvedSource
      ? buildDescriptor(artifact, resolvedSource, androidSourceFingerprint.fingerprint)
      : preservedDescriptor ?? buildDescriptor(artifact, null, null);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    byChannel,
  };

  await writeFile(PUBLIC_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(GENERATED_TS_PATH, buildTypeScriptManifest(manifest), "utf8");

  for (const artifact of ARTIFACT_CONFIG) {
    const descriptor = manifest.byChannel[artifact.channel];
    if (descriptor.available) {
      console.log(
        `[sync-android-artifacts] ${artifact.channel}: ${descriptor.fileName} (${descriptor.sizeBytes} bytes)`,
      );
    } else {
      console.log(`[sync-android-artifacts] ${artifact.channel}: unavailable`);
    }
  }
}

await syncArtifacts();
