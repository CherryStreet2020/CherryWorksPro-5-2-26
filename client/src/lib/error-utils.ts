const STATUS_MESSAGES: Record<number, string> = {
  400: "Invalid request",
  401: "Session expired, please log in again",
  403: "You don't have permission",
  404: "Not found",
  409: "Conflict — this resource may have been modified",
  413: "Upload too large",
  422: "Please check your input and try again",
  429: "Too many requests, please wait a moment",
  500: "Something went wrong, please try again",
  502: "Server temporarily unavailable",
  503: "Service unavailable, please try again later",
};

export function extractErrorMessage(error: unknown): string {
  if (!error) return "An unexpected error occurred";

  if (error instanceof Error) {
    const msg = error.message;
    const statusMatch = msg.match(/^(\d{3}):\s*(.*)/);
    if (statusMatch) {
      const status = parseInt(statusMatch[1], 10);
      const body = statusMatch[2].trim();
      try {
        const parsed = JSON.parse(body);
        if (parsed.message && typeof parsed.message === "string") {
          return parsed.message;
        }
        if (parsed.error && typeof parsed.error === "string") {
          return parsed.error;
        }
      } catch {}
      if (body && body !== "undefined" && body !== "null") {
        return body;
      }
      return STATUS_MESSAGES[status] || `Request failed (${status})`;
    }

    if (msg === "Failed to fetch" || msg === "NetworkError when attempting to fetch resource.") {
      return "Network error — check your connection and try again";
    }
    if (msg.startsWith("Request timed out")) {
      return "Request timed out, please try again";
    }
    return msg;
  }

  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
  }

  return "An unexpected error occurred";
}

export function getHttpStatusMessage(status: number): string {
  return STATUS_MESSAGES[status] || `Request failed (${status})`;
}
