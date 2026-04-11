import type { User } from "@/react-app/auth/types";
import type { NormalizedCameraImage } from "@/react-app/services/native/cameraService";
import { fetchJson } from "@/react-app/utils/api";

const AVATAR_SIZE_PX = 256;
const AVATAR_OUTPUT_MIME_TYPE = "image/jpeg";
const AVATAR_OUTPUT_QUALITY = 0.82;
export const AVATAR_CROP_MIN_ZOOM = 1;
export const AVATAR_CROP_MAX_ZOOM = 3;
export const AVATAR_CROP_VIEWPORT_PX = 280;

export type AvatarCrop = {
  zoom: number;
  offsetX: number;
  offsetY: number;
};

export type AvatarSourceDimensions = {
  width: number;
  height: number;
};

type PreparedAvatarPayload = {
  imageBase64: string;
  imageMimeType: string;
};

export async function uploadUserAvatar(
  image: NormalizedCameraImage,
  crop?: AvatarCrop,
): Promise<User> {
  const prepared = await prepareAvatarPayload(image, crop);
  return fetchJson<User>("/api/users/me/avatar", {
    method: "POST",
    body: JSON.stringify({
      image_base64: prepared.imageBase64,
      image_mime_type: prepared.imageMimeType,
    }),
  });
}

export async function removeUserAvatar(): Promise<User> {
  return fetchJson<User>("/api/users/me/avatar", {
    method: "DELETE",
  });
}

async function prepareAvatarPayload(
  image: NormalizedCameraImage,
  crop?: AvatarCrop,
): Promise<PreparedAvatarPayload> {
  const source = await loadImageElement(image.dataUrl);
  const dimensions = getAvatarSourceDimensions(source);
  const effectiveCrop = clampAvatarCrop(
    dimensions,
    crop ?? createDefaultAvatarCrop(),
    AVATAR_CROP_VIEWPORT_PX,
  );
  const displayRect = getAvatarCropDisplayRect(
    dimensions,
    effectiveCrop,
    AVATAR_CROP_VIEWPORT_PX,
  );
  const viewportScale = AVATAR_SIZE_PX / AVATAR_CROP_VIEWPORT_PX;

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE_PX;
  canvas.height = AVATAR_SIZE_PX;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Nao foi possivel preparar a imagem do avatar.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX);
  context.drawImage(
    source,
    displayRect.left * viewportScale,
    displayRect.top * viewportScale,
    displayRect.width * viewportScale,
    displayRect.height * viewportScale,
  );

  const dataUrl = canvas.toDataURL(AVATAR_OUTPUT_MIME_TYPE, AVATAR_OUTPUT_QUALITY);
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match?.[2]) {
    throw new Error("Nao foi possivel serializar a imagem do avatar.");
  }

  return {
    imageMimeType: match[1] ?? AVATAR_OUTPUT_MIME_TYPE,
    imageBase64: match[2],
  };
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Nao foi possivel carregar a imagem do avatar."));
    image.src = dataUrl;
  });
}

export async function loadAvatarSourceDimensions(
  image: NormalizedCameraImage,
): Promise<AvatarSourceDimensions> {
  const source = await loadImageElement(image.dataUrl);
  return getAvatarSourceDimensions(source);
}

export function createDefaultAvatarCrop(): AvatarCrop {
  return {
    zoom: AVATAR_CROP_MIN_ZOOM,
    offsetX: 0,
    offsetY: 0,
  };
}

export function clampAvatarCrop(
  dimensions: AvatarSourceDimensions,
  crop: AvatarCrop,
  viewportSize: number,
): AvatarCrop {
  const safeWidth = Math.max(1, dimensions.width);
  const safeHeight = Math.max(1, dimensions.height);
  const safeViewportSize = Math.max(1, viewportSize);
  const zoom = clamp(crop.zoom, AVATAR_CROP_MIN_ZOOM, AVATAR_CROP_MAX_ZOOM);
  const scale = Math.max(safeViewportSize / safeWidth, safeViewportSize / safeHeight) * zoom;
  const renderedWidth = safeWidth * scale;
  const renderedHeight = safeHeight * scale;
  const maxOffsetX = Math.max(0, (renderedWidth - safeViewportSize) / 2);
  const maxOffsetY = Math.max(0, (renderedHeight - safeViewportSize) / 2);

  return {
    zoom,
    offsetX: clamp(crop.offsetX, -maxOffsetX, maxOffsetX),
    offsetY: clamp(crop.offsetY, -maxOffsetY, maxOffsetY),
  };
}

export function getAvatarCropDisplayRect(
  dimensions: AvatarSourceDimensions,
  crop: AvatarCrop,
  viewportSize: number,
): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  const clampedCrop = clampAvatarCrop(dimensions, crop, viewportSize);
  const safeWidth = Math.max(1, dimensions.width);
  const safeHeight = Math.max(1, dimensions.height);
  const safeViewportSize = Math.max(1, viewportSize);
  const scale =
    Math.max(safeViewportSize / safeWidth, safeViewportSize / safeHeight) * clampedCrop.zoom;
  const width = safeWidth * scale;
  const height = safeHeight * scale;

  return {
    width,
    height,
    left: (safeViewportSize - width) / 2 + clampedCrop.offsetX,
    top: (safeViewportSize - height) / 2 + clampedCrop.offsetY,
  };
}

function getAvatarSourceDimensions(image: HTMLImageElement): AvatarSourceDimensions {
  return {
    width: image.naturalWidth || image.width || AVATAR_SIZE_PX,
    height: image.naturalHeight || image.height || AVATAR_SIZE_PX,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
