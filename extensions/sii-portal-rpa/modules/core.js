"use strict";

export const EXT_SOURCE = "app-contable-extension";
export const PROTOCOL_VERSION = 1;
export const EXTENSION_VERSION = "0.1.0";

export function isAllowedAppUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://app-contable-five.vercel.app" || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(parsed.origin);
  } catch {
    return false;
  }
}

export function baseMessage(message) {
  return {
    source: EXT_SOURCE,
    protocol_version: PROTOCOL_VERSION,
    ...message,
  };
}
