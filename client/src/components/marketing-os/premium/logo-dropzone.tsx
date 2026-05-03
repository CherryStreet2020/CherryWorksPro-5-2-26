/**
 * LogoDropzone — Sprint 2m premium primitive.
 *
 * Drag-drop OR click-to-pick OR paste-URL. Returns a URL string via
 * `onChange`.
 *
 * Two modes:
 *   - Hosted upload (default when `uploadEndpoint` is set): the picked
 *     file is POSTed as multipart/form-data to that endpoint. The
 *     server-returned `logoUrl` (or `url`) is the value handed to
 *     `onChange`. This is the production path — used by the brand
 *     editor (task #156) so logos live in object storage instead of
 *     bloating rows as base64.
 *   - Data URL fallback (when no `uploadEndpoint`): the file is read
 *     into a base64 data URL via FileReader and handed to `onChange`.
 *     Kept for the showcase page and any draft contexts where no
 *     upload target exists yet.
 *
 * Existing data-URL logoUrl values rendered into `value` keep working
 * — the <img> renderer doesn't care about scheme.
 *
 * Theme behaviour: Dashed border uses `--lux-border-strong` so it stays
 * legible on both light and dark surfaces. Focus indicator on the
 * trigger uses `box-shadow: 0 0 0 2px rgba(var(--lux-accent-rgb), 0.25)`
 * directly on `:focus-visible` (never `var(--lux-focus-ring)`, which is
 * `none` in dark mode).
 */
import * as React from "react";
import { Upload, Link2, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ensureCSRFToken, getCSRFToken } from "@/lib/queryClient";

export interface LogoDropzoneProps {
  value?: string | null;
  onChange?: (value: string | null) => void;
  className?: string;
  label?: string;
  /**
   * When provided, dropped/picked files are uploaded via
   * multipart/form-data POST to this URL. The server should respond
   * with JSON `{ logoUrl: string }` (or `{ url: string }`); that
   * string is what gets handed to `onChange`. When omitted, falls
   * back to the legacy base64 data-URL behaviour.
   */
  uploadEndpoint?: string;
  /** Multipart field name. Defaults to "logo". */
  uploadFieldName?: string;
  /**
   * Externally-set error message rendered in the same red
   * `logo-upload-error` slot used for upload failures. Used by callers
   * (e.g. the brand modal) to surface server-side validation errors
   * about the pasted URL inline instead of only via a toast (task #164).
   * When provided, takes precedence over the dropzone's internal upload
   * error.
   */
  error?: string | null;
  /**
   * Fires when the admin interacts with the URL field, file picker, or
   * remove button in a way that should retire a stale external `error`
   * (e.g. they edited the URL after a server rejection). Internal
   * upload errors are still cleared automatically.
   */
  onErrorClear?: () => void;
}

export function LogoDropzone({
  value,
  onChange,
  className,
  label = "Brand logo",
  uploadEndpoint,
  uploadFieldName = "logo",
  error: externalError,
  onErrorClear,
}: LogoDropzoneProps) {
  const [dragOver, setDragOver] = React.useState(false);
  const [urlInput, setUrlInput] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [internalError, setInternalError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // External error wins over internal upload errors so server-side
  // logoUrl rejections are visible alongside upload feedback.
  const error = externalError ?? internalError;
  const setError = setInternalError;

  const clearErrors = () => {
    setInternalError(null);
    if (externalError) onErrorClear?.();
  };

  const handleFile = async (file: File) => {
    clearErrors();
    if (!uploadEndpoint) {
      const reader = new FileReader();
      reader.onload = () => onChange?.(String(reader.result));
      reader.readAsDataURL(file);
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append(uploadFieldName, file);
      // The app gates non-GET API calls with a CSRF cookie+header
      // pair (see client/src/lib/queryClient.ts). We can't use
      // apiRequest because it serializes JSON, so replicate the
      // header dance manually for this multipart upload.
      await ensureCSRFToken();
      const csrfToken = getCSRFToken();
      const headers: Record<string, string> = {};
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
      const res = await fetch(uploadEndpoint, {
        method: "POST",
        body: fd,
        credentials: "include",
        headers,
      });
      const text = await res.text();
      let body: { logoUrl?: unknown; url?: unknown; message?: unknown } = {};
      try {
        body = text ? (JSON.parse(text) as typeof body) : {};
      } catch {
        body = { message: text };
      }
      if (!res.ok) {
        const message =
          typeof body.message === "string"
            ? body.message
            : `Upload failed (${res.status})`;
        throw new Error(message);
      }
      const url =
        typeof body.logoUrl === "string"
          ? body.logoUrl
          : typeof body.url === "string"
            ? body.url
            : undefined;
      if (!url) throw new Error("Upload response missing logoUrl");
      onChange?.(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setError(message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={cn("space-y-2", className)} data-testid="premium-logo-dropzone">
      <div
        className="text-xs font-medium"
        style={{ color: "var(--lux-text-secondary)" }}
      >
        {label}
      </div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (uploading) return;
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        onClick={() => {
          if (!uploading) inputRef.current?.click();
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !uploading) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className="relative flex h-32 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed transition-all duration-150 ease-out focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(var(--lux-accent-rgb),0.25)]"
        style={{
          borderColor: dragOver
            ? "var(--lux-accent)"
            : "var(--lux-border-strong)",
          background: dragOver
            ? "rgba(var(--lux-accent-rgb), 0.06)"
            : "var(--lux-surface-alt)",
          opacity: uploading ? 0.7 : 1,
          cursor: uploading ? "wait" : "pointer",
        }}
        role="button"
        tabIndex={0}
        aria-busy={uploading || undefined}
        data-testid="dropzone-target"
      >
        {uploading ? (
          <div
            className="flex flex-col items-center gap-1 text-xs"
            style={{ color: "var(--lux-text-muted)" }}
            data-testid="logo-upload-spinner"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Uploading…</span>
          </div>
        ) : value ? (
          <>
            <img
              src={value}
              alt="logo preview"
              className="max-h-24 max-w-[80%] object-contain"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearErrors();
                onChange?.(null);
              }}
              className="absolute right-2 top-2 rounded-full p-1 focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(var(--lux-accent-rgb),0.25)]"
              style={{
                background: "var(--lux-surface)",
                border: "1px solid var(--lux-border)",
                color: "var(--lux-text-muted)",
              }}
              aria-label="Remove logo"
              data-testid="button-remove-logo"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          <div
            className="flex flex-col items-center gap-1 text-xs"
            style={{ color: "var(--lux-text-muted)" }}
          >
            <Upload className="h-5 w-5" />
            <span>Drop, click, or paste a URL</span>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            // reset so picking the same file twice still fires onChange
            e.target.value = "";
          }}
          data-testid="input-logo-file"
        />
      </div>
      {error ? (
        <p
          className="text-xs"
          style={{ color: "var(--lux-accent)" }}
          data-testid="logo-upload-error"
        >
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Input
          value={urlInput}
          onChange={(e) => {
            setUrlInput(e.target.value);
            clearErrors();
          }}
          placeholder="https://example.com/logo.png"
          className="text-xs"
          data-testid="input-logo-url"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const trimmed = urlInput.trim();
            if (!trimmed) return;
            // Task #160: cheap client-side gate so admins don't paste
            // javascript:/data:/file: URLs straight into brand.logoUrl.
            // The server (POST/PATCH /api/brands) re-validates with an
            // SSRF + image-type check; this is just user feedback.
            let parsed: URL;
            try {
              parsed = new URL(trimmed);
            } catch {
              setError("Enter a full URL starting with https://");
              return;
            }
            if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
              setError("Logo URL must use http or https");
              return;
            }
            setError(null);
            onChange?.(trimmed);
            setUrlInput("");
          }}
          data-testid="button-use-url"
        >
          <Link2 className="h-3 w-3" />
          Use
        </Button>
      </div>
    </div>
  );
}

export default LogoDropzone;
