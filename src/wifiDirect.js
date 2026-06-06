import { PermissionsAndroid, Platform } from "react-native";

let wifiP2p = null;

function getWifiP2p() {
  if (Platform.OS !== "android") return null;
  if (wifiP2p) return wifiP2p;
  try {
    wifiP2p = require("react-native-wifi-p2p");
  } catch (_error) {
    wifiP2p = null;
  }
  return wifiP2p;
}

async function requestWifiDirectPermissions() {
  if (Platform.OS !== "android" || !PermissionsAndroid?.requestMultiple) return true;
  const permissions = [
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION
  ].filter(Boolean);
  if (PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES) {
    permissions.push(PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES);
  }
  const result = await PermissionsAndroid.requestMultiple(permissions);
  return Object.values(result).every(value => value === PermissionsAndroid.RESULTS.GRANTED);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isWifiDirectAvailable() {
  return !!getWifiP2p();
}

export async function startTeacherWifiDirectGroup() {
  const p2p = getWifiP2p();
  if (!p2p) return { ok: false, message: "Wi-Fi Direct is only available in the Android APK." };
  const allowed = await requestWifiDirectPermissions();
  if (!allowed) return { ok: false, message: "Wi-Fi Direct permissions were denied." };
  await p2p.initialize();
  await p2p.removeGroup().catch(() => {});
  await p2p.createGroup();
  await delay(2500);
  const connection = await p2p.getConnectionInfo().catch(() => null);
  const group = await p2p.getGroupInfo().catch(() => null);
  const hostAddress = connection?.groupOwnerAddress?.hostAddress || "192.168.49.1";
  return {
    ok: true,
    hostUrl: `http://${hostAddress}:10000`,
    group,
    connection
  };
}

export async function discoverWifiDirectTeachers() {
  const p2p = getWifiP2p();
  if (!p2p) return { ok: false, devices: [], message: "Wi-Fi Direct is only available in the Android APK." };
  const allowed = await requestWifiDirectPermissions();
  if (!allowed) return { ok: false, devices: [], message: "Wi-Fi Direct permissions were denied." };
  await p2p.initialize();
  await p2p.startDiscoveringPeers();
  await delay(3500);
  const peers = await p2p.getAvailablePeers().catch(() => ({ devices: [] }));
  return { ok: true, devices: peers.devices || [] };
}

export async function connectToWifiDirectTeacher(deviceAddress) {
  const p2p = getWifiP2p();
  if (!p2p) throw new Error("Wi-Fi Direct is only available in the Android APK.");
  const allowed = await requestWifiDirectPermissions();
  if (!allowed) throw new Error("Wi-Fi Direct permissions were denied.");
  await p2p.initialize();
  await p2p.connectWithConfig({ deviceAddress, groupOwnerIntent: 0 });
  await delay(3500);
  const connection = await p2p.getConnectionInfo();
  const hostAddress = connection?.groupOwnerAddress?.hostAddress || "192.168.49.1";
  return {
    ok: true,
    hostUrl: `http://${hostAddress}:10000`,
    connection
  };
}
