export const PREVIEW_BRIDGE_NAME = "vivd-preview-bridge" as const;
export const PREVIEW_BRIDGE_VERSION = 1 as const;

export const PREVIEW_BRIDGE_MESSAGE_TYPES = [
  "vivd:preview:ready",
  "vivd:preview:location-change",
  "vivd:preview:navigation-start",
  "vivd:preview:navigation-complete",
  "vivd:preview:runtime-error",
] as const;

export function buildPreviewBridgeScript(
  options?:
    | {
        parentOrigin?: string | null;
      }
    | string,
): string {
  const parentOrigin =
    typeof options === "string" ? options : options?.parentOrigin;
  const targetOriginExpression =
    typeof parentOrigin === "string" && parentOrigin.length > 0
      ? JSON.stringify(parentOrigin)
      : "window.location.origin";

  return `"use strict";
(function () {
  if (window.__vivdPreviewBridgeInstalled) return;
  window.__vivdPreviewBridgeInstalled = true;

  var BRIDGE_TYPE = "${PREVIEW_BRIDGE_NAME}";
  var BRIDGE_VERSION = ${PREVIEW_BRIDGE_VERSION};
  var parentWindow = window.parent && window.parent !== window ? window.parent : null;
  var parentOrigin = ${targetOriginExpression};

  function snapshotLocation() {
    return {
      href: String(window.location.href || ""),
      pathname: String(window.location.pathname || ""),
      search: String(window.location.search || ""),
      hash: String(window.location.hash || ""),
      origin: window.location.origin,
    };
  }

  function post(type, payload) {
    if (!parentWindow) return;
    try {
      parentWindow.postMessage(
        Object.assign(
          {
            bridge: BRIDGE_TYPE,
            version: BRIDGE_VERSION,
            type: type,
            location: snapshotLocation(),
          },
          payload || {},
        ),
        parentOrigin,
      );
    } catch {
      // Best effort only.
    }
  }

  function emitReady() {
    post("vivd:preview:ready");
  }

  function emitNavigationStart(reason) {
    post("vivd:preview:navigation-start", { reason: reason });
  }

  function emitNavigationComplete(reason) {
    post("vivd:preview:navigation-complete", { reason: reason });
  }

  function emitLocationChange(reason) {
    post("vivd:preview:location-change", { reason: reason });
  }

  function emitRuntimeError(kind, detail) {
    post("vivd:preview:runtime-error", { kind: kind, error: detail });
  }

  function scheduleReady() {
    if (document.readyState === "complete" || document.readyState === "interactive") {
      emitReady();
      emitLocationChange("ready");
      emitNavigationComplete("ready");
      return;
    }

    document.addEventListener(
      "DOMContentLoaded",
      function () {
        emitReady();
        emitLocationChange("DOMContentLoaded");
        emitNavigationComplete("DOMContentLoaded");
      },
      { once: true },
    );
  }

  var queue =
    typeof queueMicrotask === "function"
      ? queueMicrotask
      : function (fn) {
          Promise.resolve().then(fn);
        };

  function wrapHistoryMethod(methodName) {
    var original = window.history && window.history[methodName];
    if (typeof original !== "function") return;

    window.history[methodName] = function () {
      emitNavigationStart(methodName);
      var result = original.apply(this, arguments);
      queue(function () {
        emitLocationChange(methodName);
        emitNavigationComplete(methodName);
      });
      return result;
    };
  }

  wrapHistoryMethod("pushState");
  wrapHistoryMethod("replaceState");

  window.addEventListener("popstate", function () {
    emitNavigationStart("popstate");
    emitLocationChange("popstate");
    emitNavigationComplete("popstate");
  });

  window.addEventListener("hashchange", function () {
    emitNavigationStart("hashchange");
    emitLocationChange("hashchange");
    emitNavigationComplete("hashchange");
  });

  window.addEventListener("pageshow", function () {
    emitReady();
    emitLocationChange("pageshow");
    emitNavigationComplete("pageshow");
  });

  window.addEventListener("beforeunload", function () {
    emitNavigationStart("beforeunload");
  });

  window.addEventListener("pagehide", function () {
    emitNavigationStart("pagehide");
  });

  window.addEventListener("error", function (event) {
    emitRuntimeError("error", {
      message: event && event.message ? String(event.message) : "Preview error",
      filename: event && event.filename ? String(event.filename) : undefined,
      lineno: event && typeof event.lineno === "number" ? event.lineno : undefined,
      colno: event && typeof event.colno === "number" ? event.colno : undefined,
    });
  });

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && "reason" in event ? event.reason : undefined;
    emitRuntimeError("unhandledrejection", {
      message:
        typeof reason === "string"
          ? reason
          : reason && typeof reason.message === "string"
            ? reason.message
            : "Unhandled promise rejection",
      stack: reason && typeof reason.stack === "string" ? reason.stack : undefined,
    });
  });

  scheduleReady();
})();
`;
}
