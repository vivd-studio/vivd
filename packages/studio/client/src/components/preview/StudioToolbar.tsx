import {
  RefreshCw,
  Smartphone,
  Monitor,
  Edit3,
  Loader2,
  GitBranch,
} from "lucide-react";
import { usePreview } from "./PreviewContext";
import { DEVICE_PRESETS } from "./types";
import { trpc } from "@/lib/trpc";

export function StudioToolbar() {
  const {
    mobileView,
    setMobileView,
    selectedDevice,
    setSelectedDevice,
    editMode,
    toggleEditMode,
    handleRefresh,
    iframeLoading,
    isPreviewLoading,
    devServerStatus,
    isSaving,
  } = usePreview();

  const { data: gitStatus } = trpc.git.status.useQuery(undefined, {
    refetchInterval: 5000,
  });

  const isLoading =
    iframeLoading ||
    isPreviewLoading ||
    devServerStatus === "starting" ||
    devServerStatus === "installing";

  return (
    <header className="flex h-12 items-center justify-between border-b border-gray-700 bg-gray-900 px-4">
      {/* Left side - Logo and status */}
      <div className="flex items-center gap-3">
        <span className="font-semibold text-white">Vivd Studio</span>
        {gitStatus?.hasChanges && (
          <div className="flex items-center gap-1.5 text-yellow-400">
            <GitBranch className="h-3.5 w-3.5" />
            <span className="text-xs">Uncommitted changes</span>
          </div>
        )}
      </div>

      {/* Center - View controls */}
      <div className="flex items-center gap-2">
        {/* Device toggle */}
        <div className="flex items-center rounded-lg bg-gray-800 p-1">
          <button
            onClick={() => setMobileView(false)}
            className={`rounded px-2 py-1 text-sm transition-colors ${
              !mobileView
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Monitor className="h-4 w-4" />
          </button>
          <button
            onClick={() => setMobileView(true)}
            className={`rounded px-2 py-1 text-sm transition-colors ${
              mobileView
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <Smartphone className="h-4 w-4" />
          </button>
        </div>

        {/* Device selector (only shown in mobile view) */}
        {mobileView && (
          <select
            value={selectedDevice.name}
            onChange={(e) => {
              const device = DEVICE_PRESETS.find((d) => d.name === e.target.value);
              if (device) setSelectedDevice(device);
            }}
            className="h-8 rounded bg-gray-800 px-2 text-sm text-white border-none focus:ring-2 focus:ring-blue-500"
          >
            {DEVICE_PRESETS.map((device) => (
              <option key={device.name} value={device.name}>
                {device.name}
              </option>
            ))}
          </select>
        )}

        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="rounded p-2 text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-50"
          title="Refresh preview"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Right side - Edit button */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleEditMode}
          disabled={isSaving || isLoading}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            editMode
              ? "bg-blue-600 text-white"
              : "bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white"
          } disabled:opacity-50`}
        >
          <Edit3 className="h-4 w-4" />
          {editMode ? "Editing" : "Edit"}
        </button>
      </div>
    </header>
  );
}
