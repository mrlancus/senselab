/** Feature detection only: nothing here asks for permission. */

export type Support = 'yes' | 'no' | 'permission' | 'unknown';

export interface Capability {
  id: string;
  label: string;
  support: Support;
  detail: string;
}

type MotionCtor = typeof DeviceMotionEvent & { requestPermission?: () => Promise<PermissionState> };

export const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function motionNeedsPermission(): boolean {
  return (
    typeof (window.DeviceMotionEvent as MotionCtor | undefined)?.requestPermission === 'function'
  );
}

/** iOS needs this from a tap; elsewhere it resolves immediately. */
export async function requestMotionPermission(): Promise<boolean> {
  const ctor = window.DeviceMotionEvent as MotionCtor | undefined;
  if (!ctor) return false;
  if (typeof ctor.requestPermission !== 'function') return true;
  try {
    return (await ctor.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

export async function detectCapabilities(): Promise<Capability[]> {
  const caps: Capability[] = [];
  const secure = window.isSecureContext;
  caps.push({
    id: 'https',
    label: 'Secure context (HTTPS)',
    support: secure ? 'yes' : 'no',
    detail: secure ? 'Sensors can be used' : 'Open the https:// address; sensors are blocked',
  });

  const hasMic = !!navigator.mediaDevices?.getUserMedia;
  caps.push({
    id: 'mic',
    label: 'Microphone',
    support: hasMic ? 'permission' : 'no',
    detail: hasMic ? 'Asks when you start a test' : 'getUserMedia is unavailable',
  });

  const AC =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const worklet = !!AC && 'audioWorklet' in AC.prototype;
  caps.push({
    id: 'audio',
    label: 'Low-level audio (AudioWorklet)',
    support: worklet ? 'yes' : 'no',
    detail: worklet ? 'Raw sample access for DSP' : 'This browser is too old for audio modes',
  });

  const motion = 'DeviceMotionEvent' in window;
  caps.push({
    id: 'motion',
    label: 'Accelerometer & gyroscope',
    support: !motion ? 'no' : motionNeedsPermission() ? 'permission' : 'yes',
    detail: !motion
      ? 'Not available'
      : motionNeedsPermission()
        ? 'iOS asks when you start the motion test'
        : 'Available',
  });

  const mag = 'Magnetometer' in window;
  caps.push({
    id: 'magnetometer',
    label: 'Magnetometer',
    support: mag ? 'permission' : 'no',
    detail: mag
      ? 'Generic Sensor API present'
      : isIOS()
        ? 'iOS Safari does not expose the magnetometer'
        : 'Not exposed by this browser (Android Chrome only)',
  });

  const cam = !!navigator.mediaDevices?.getUserMedia;
  caps.push({
    id: 'camera',
    label: 'Camera',
    support: cam ? 'permission' : 'no',
    detail: cam ? 'Asks when you start the camera mode' : 'Not available',
  });

  let xr: Support = 'no';
  let xrDetail = isIOS() ? 'iOS Safari has no WebXR; card-for-scale fallback' : 'Not available';
  const nxr = (
    navigator as Navigator & { xr?: { isSessionSupported(m: string): Promise<boolean> } }
  ).xr;
  if (nxr) {
    try {
      xr = (await nxr.isSessionSupported('immersive-ar')) ? 'yes' : 'no';
      xrDetail =
        xr === 'yes' ? 'AR hit-test / depth may be available' : 'WebXR present, AR not supported';
    } catch {
      xr = 'unknown';
      xrDetail = 'Could not query WebXR';
    }
  }
  caps.push({ id: 'webxr', label: 'WebXR AR (depth / hit-test)', support: xr, detail: xrDetail });

  const workers = typeof Worker !== 'undefined';
  caps.push({
    id: 'worker',
    label: 'Background processing (Web Worker)',
    support: workers ? 'yes' : 'no',
    detail: workers ? 'Heavy maths runs off the UI thread' : 'Not available',
  });
  return caps;
}
