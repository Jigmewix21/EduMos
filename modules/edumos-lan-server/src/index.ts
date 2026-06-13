import { Platform } from "react-native";
import { requireNativeModule } from "expo";

type StartResult = {
  ok: boolean;
  url: string;
  port: number;
  addresses: string[];
};

type LanServerModule = {
  startServer(port: number, packageJson: string): Promise<StartResult>;
  stopServer(): Promise<{ ok: boolean }>;
  isRunning(): boolean;
  getBaseUrl(): string;
  connectToWifiNetwork(ssid: string, password: string): Promise<{ ok: boolean; message?: string }>;
};

let nativeModule: LanServerModule | null = null;

if (Platform.OS === "android") {
  try {
    nativeModule = requireNativeModule<LanServerModule>("EduMosLanServer");
  } catch (_error) {
    nativeModule = null;
  }
}

export function isLanServerAvailable() {
  return !!nativeModule;
}

export async function startLanServer(port: number, payload: unknown) {
  if (!nativeModule) {
    return { ok: false, url: "", port, addresses: [], message: "LAN server is available only in the Android APK." };
  }
  return nativeModule.startServer(port, JSON.stringify(payload));
}

export async function stopLanServer() {
  if (!nativeModule) return { ok: false };
  return nativeModule.stopServer();
}

export function getLanServerBaseUrl() {
  return nativeModule?.getBaseUrl() || "";
}

export function isLanServerRunning() {
  return nativeModule?.isRunning() || false;
}

export async function connectToWifiNetwork(ssid: string, password: string) {
  if (!nativeModule) return { ok: false, message: "Wi-Fi connection prompt is available only in the Android APK." };
  return nativeModule.connectToWifiNetwork(ssid, password);
}
