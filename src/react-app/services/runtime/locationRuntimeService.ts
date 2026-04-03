import {
  getAndroidBridge,
  isAndroidNativeAvailable,
  type AndroidLocationDetail,
  type AndroidLocationPermissionDetail,
} from "@/react-app/services/native/androidBridge";

export type RuntimeLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  precision: "precise" | "approximate";
  timestamp: string;
  source: "android-native" | "browser";
};

export type LocationPermissionStatus = {
  permission: "granted" | "denied" | "prompt";
  precision: "precise" | "approximate" | "unavailable";
  granted: boolean;
};

export type LocationRuntimeState = {
  location: RuntimeLocation | null;
  permission: LocationPermissionStatus;
  tracking: boolean;
  error: string | null;
};

type LocationListener = (state: LocationRuntimeState) => void;

const LOCATION_REQUEST_TIMEOUT_MS = 8_000;

function createDefaultPermission(): LocationPermissionStatus {
  return {
    permission: "prompt",
    precision: "unavailable",
    granted: false,
  };
}

function toIsoTimestamp(value: number | undefined): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function buildLocationFromNative(detail: AndroidLocationDetail | null | undefined): RuntimeLocation | null {
  if (!detail) return null;
  if (typeof detail.latitude !== "number" || typeof detail.longitude !== "number") {
    return null;
  }

  return {
    latitude: detail.latitude,
    longitude: detail.longitude,
    accuracyMeters:
      typeof detail.accuracyMeters === "number" && Number.isFinite(detail.accuracyMeters)
        ? Math.max(0, detail.accuracyMeters)
        : 0,
    precision: detail.precision === "approximate" ? "approximate" : "precise",
    timestamp:
      typeof detail.timestamp === "string" && detail.timestamp.trim().length > 0
        ? detail.timestamp
        : new Date().toISOString(),
    source: detail.source === "browser" ? "browser" : "android-native",
  };
}

function buildPermissionFromNative(
  detail: AndroidLocationPermissionDetail | null | undefined,
): LocationPermissionStatus {
  if (!detail) {
    return createDefaultPermission();
  }

  const permission =
    detail.permission === "granted" || detail.permission === "denied"
      ? detail.permission
      : "prompt";
  const precision =
    detail.precision === "precise" || detail.precision === "approximate"
      ? detail.precision
      : "unavailable";

  return {
    permission,
    precision,
    granted: permission === "granted" && precision !== "unavailable",
  };
}

class LocationRuntimeService {
  private state: LocationRuntimeState = {
    location: null,
    permission: createDefaultPermission(),
    tracking: false,
    error: null,
  };
  private listeners = new Set<LocationListener>();
  private browserWatchId: number | null = null;
  private nativeLocationRequestInFlight: Promise<RuntimeLocation | null> | null = null;
  private windowListenersBound = false;

  getState(): LocationRuntimeState {
    return this.state;
  }

  subscribe(listener: LocationListener): () => void {
    this.bindWindowListeners();
    this.listeners.add(listener);
    listener(this.state);

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && !this.state.tracking) {
        this.unbindWindowListeners();
      }
    };
  }

  async getLocationPermissionStatus(): Promise<LocationPermissionStatus> {
    this.bindWindowListeners();

    if (isAndroidNativeAvailable()) {
      const bridge = getAndroidBridge();
      const readStatus = bridge?.getLocationPermissionStatus;
      if (readStatus) {
        try {
          const raw = readStatus.call(bridge);
          const parsed = JSON.parse(raw) as AndroidLocationPermissionDetail;
          const permission = buildPermissionFromNative(parsed);
          this.setState({ ...this.state, permission, error: null });
          return permission;
        } catch {
          return this.state.permission;
        }
      }
    }

    if (typeof navigator === "undefined" || !("permissions" in navigator)) {
      return this.state.permission;
    }

    try {
      const status = await navigator.permissions.query({ name: "geolocation" });
      const permission: LocationPermissionStatus = {
        permission: status.state,
        precision: status.state === "granted" ? "precise" : "unavailable",
        granted: status.state === "granted",
      };
      this.setState({ ...this.state, permission, error: null });
      return permission;
    } catch {
      return this.state.permission;
    }
  }

  async getCurrentLocation(): Promise<RuntimeLocation | null> {
    this.bindWindowListeners();

    if (isAndroidNativeAvailable()) {
      return this.requestAndroidLocation();
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      this.setState({ ...this.state, error: "Geolocalizacao indisponivel neste dispositivo." });
      return null;
    }

    try {
      const location = await new Promise<RuntimeLocation>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (position) =>
            resolve({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracyMeters: Math.max(0, position.coords.accuracy ?? 0),
              precision: position.coords.accuracy > 100 ? "approximate" : "precise",
              timestamp: toIsoTimestamp(position.timestamp),
              source: "browser",
            }),
          reject,
          {
            enableHighAccuracy: true,
            timeout: LOCATION_REQUEST_TIMEOUT_MS,
            maximumAge: 30_000,
          },
        );
      });

      this.setState({
        ...this.state,
        location,
        permission: {
          permission: "granted",
          precision: location.precision,
          granted: true,
        },
        error: null,
      });
      return location;
    } catch (error) {
      this.setState({
        ...this.state,
        error: error instanceof Error ? error.message : "Falha ao obter localizacao.",
      });
      return null;
    }
  }

  async startForegroundLocationTracking(): Promise<void> {
    this.bindWindowListeners();

    if (isAndroidNativeAvailable()) {
      const bridge = getAndroidBridge();
      bridge?.startLocationTracking?.call(bridge);
      this.setState({ ...this.state, tracking: true, error: null });
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation || this.browserWatchId !== null) {
      return;
    }

    this.browserWatchId = navigator.geolocation.watchPosition(
      (position) => {
        const location: RuntimeLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Math.max(0, position.coords.accuracy ?? 0),
          precision: position.coords.accuracy > 100 ? "approximate" : "precise",
          timestamp: toIsoTimestamp(position.timestamp),
          source: "browser",
        };

        this.setState({
          ...this.state,
          tracking: true,
          location,
          permission: {
            permission: "granted",
            precision: location.precision,
            granted: true,
          },
          error: null,
        });
      },
      (error) => {
        this.setState({
          ...this.state,
          tracking: false,
          error: error.message,
        });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: LOCATION_REQUEST_TIMEOUT_MS,
      },
    );

    this.setState({ ...this.state, tracking: true, error: null });
  }

  stopForegroundLocationTracking(): void {
    if (isAndroidNativeAvailable()) {
      const bridge = getAndroidBridge();
      bridge?.stopLocationTracking?.call(bridge);
      this.setState({ ...this.state, tracking: false });
      if (this.listeners.size === 0) {
        this.unbindWindowListeners();
      }
      return;
    }

    if (this.browserWatchId !== null && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.browserWatchId);
      this.browserWatchId = null;
    }

    this.setState({ ...this.state, tracking: false });
    if (this.listeners.size === 0) {
      this.unbindWindowListeners();
    }
  }

  private bindWindowListeners(): void {
    if (this.windowListenersBound || typeof window === "undefined") {
      return;
    }

    this.windowListenersBound = true;
    window.addEventListener("location_updated", this.handleNativeLocationUpdated as EventListener);
    window.addEventListener(
      "location_permission_changed",
      this.handleNativeLocationPermissionChanged as EventListener,
    );
  }

  private unbindWindowListeners(): void {
    if (!this.windowListenersBound || typeof window === "undefined") {
      return;
    }

    this.windowListenersBound = false;
    window.removeEventListener("location_updated", this.handleNativeLocationUpdated as EventListener);
    window.removeEventListener(
      "location_permission_changed",
      this.handleNativeLocationPermissionChanged as EventListener,
    );
  }

  private handleNativeLocationUpdated = (event: Event) => {
    const location = buildLocationFromNative(
      (event as CustomEvent<AndroidLocationDetail>).detail,
    );
    if (!location) {
      return;
    }

    this.setState({
      ...this.state,
      location,
      error: null,
      permission: {
        permission: "granted",
        precision: location.precision,
        granted: true,
      },
    });
  };

  private handleNativeLocationPermissionChanged = (event: Event) => {
    const permission = buildPermissionFromNative(
      (event as CustomEvent<AndroidLocationPermissionDetail>).detail,
    );
    this.setState({
      ...this.state,
      permission,
      error: null,
    });
  };

  private requestAndroidLocation(): Promise<RuntimeLocation | null> {
    if (this.nativeLocationRequestInFlight) {
      return this.nativeLocationRequestInFlight;
    }

    const bridge = getAndroidBridge();
    const requestCurrentLocation = bridge?.requestCurrentLocation;
    if (!requestCurrentLocation || !bridge) {
      return Promise.resolve(this.state.location);
    }

    this.nativeLocationRequestInFlight = new Promise<RuntimeLocation | null>((resolve) => {
      let settled = false;

      const cleanup = (timerId: number) => {
        window.removeEventListener("location_updated", handleUpdate as EventListener);
        window.clearTimeout(timerId);
      };

      const settle = (location: RuntimeLocation | null, timerId: number) => {
        if (settled) return;
        settled = true;
        cleanup(timerId);
        resolve(location);
      };

      const handleUpdate = (event: Event) => {
        const location = buildLocationFromNative(
          (event as CustomEvent<AndroidLocationDetail>).detail,
        );
        settle(location ?? this.state.location, timerId);
      };

      const timerId = window.setTimeout(() => {
        settle(this.state.location, timerId);
      }, LOCATION_REQUEST_TIMEOUT_MS);

      window.addEventListener("location_updated", handleUpdate as EventListener);

      try {
        requestCurrentLocation.call(bridge);
      } catch {
        settle(this.state.location, timerId);
      }
    }).finally(() => {
      this.nativeLocationRequestInFlight = null;
    });

    return this.nativeLocationRequestInFlight;
  }

  private setState(nextState: LocationRuntimeState): void {
    this.state = nextState;
    this.listeners.forEach((listener) => listener(this.state));
  }
}

export const locationRuntimeService = new LocationRuntimeService();

export default locationRuntimeService;
