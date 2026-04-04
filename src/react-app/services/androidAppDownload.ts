import {
  ANDROID_ARTIFACTS,
  type AndroidArtifactChannel,
  type AndroidArtifactDescriptor,
} from "@/react-app/generated/androidArtifacts";

export type AndroidDownloadInfo = {
  channel: AndroidArtifactChannel;
  href: string;
  fileName: string;
  label: string;
  updatedAt: string | null;
  sizeBytes: number | null;
};

type AndroidDownloadResolutionParams = {
  hostname: string;
  origin?: string | undefined;
  mode?: string | undefined;
};

let cachedEnvironmentDownloadInfo: AndroidDownloadInfo | null | undefined;

function isLikelyLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

function resolveArtifactDescriptor(channel: AndroidArtifactChannel): AndroidArtifactDescriptor | null {
  const descriptor = ANDROID_ARTIFACTS.byChannel[channel];
  return descriptor?.available ? descriptor : null;
}

export function resolveAndroidArtifactChannel(
  hostname: string,
  mode = "production",
): AndroidArtifactChannel {
  const normalizedHostname = hostname.trim().toLowerCase();

  if (mode === "development" || isLikelyLocalHost(normalizedHostname)) {
    return "dev";
  }

  if (
    normalizedHostname.includes("internal") ||
    normalizedHostname.includes("preview") ||
    normalizedHostname.includes("staging") ||
    normalizedHostname.includes("homolog")
  ) {
    return "internal";
  }

  return "release";
}

export function buildAndroidDownloadHref(
  descriptor: AndroidArtifactDescriptor,
  origin?: string | undefined,
): string {
  const relativePath = descriptor.cacheBust
    ? `${descriptor.publicPath}?v=${encodeURIComponent(descriptor.cacheBust)}`
    : descriptor.publicPath;

  if (!origin) {
    return relativePath;
  }

  return new URL(relativePath, origin).toString();
}

export function resolveAndroidDownloadInfo(
  params: AndroidDownloadResolutionParams,
): AndroidDownloadInfo | null {
  const channel = resolveAndroidArtifactChannel(params.hostname, params.mode);
  const descriptor = resolveArtifactDescriptor(channel);
  if (!descriptor) {
    return null;
  }

  return {
    channel: descriptor.channel,
    href: buildAndroidDownloadHref(descriptor, params.origin),
    fileName: descriptor.fileName,
    label: descriptor.label,
    updatedAt: descriptor.updatedAt,
    sizeBytes: descriptor.sizeBytes,
  };
}

export function getAndroidDownloadInfoForCurrentEnvironment(): AndroidDownloadInfo | null {
  if (cachedEnvironmentDownloadInfo !== undefined) {
    return cachedEnvironmentDownloadInfo;
  }

  if (typeof window === "undefined") {
    cachedEnvironmentDownloadInfo = null;
    return cachedEnvironmentDownloadInfo;
  }

  cachedEnvironmentDownloadInfo = resolveAndroidDownloadInfo({
    hostname: window.location.hostname,
    origin: window.location.origin,
    mode: import.meta.env.MODE,
  });

  return cachedEnvironmentDownloadInfo;
}
