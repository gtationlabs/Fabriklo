/**
 * Provider-agnostic virtual try-on contract. The worker (trusted server) is
 * the only caller. Images are passed as bytes and come back as bytes; the
 * provider adapter decides how to transport them (FASHN: base64 data URIs,
 * which it deletes after processing, with base64 output that is not kept on
 * a public CDN). Adapters must never log image bytes or data URIs.
 */
export type TryonProviderId = "fashn" | "mock";

export type TryonRequest = {
  jobId: string;
  /** Customer photo (already validated, EXIF-stripped, resized). */
  modelImage: { bytes: Uint8Array; mime: "image/jpeg" | "image/png" | "image/webp" };
  /** Garment reference photo from the catalogue. */
  garmentImage: { bytes: Uint8Array; mime: string };
  settings: { category?: "auto" | "tops" | "bottoms" | "one-pieces"; mode?: "performance" | "balanced" | "quality"; garmentPhotoType?: "auto" | "flat-lay" | "model" };
};

export type TryonSubmit =
  | { ok: true; providerJobId: string }
  | { ok: false; code: string; message: string; retryable: boolean };

export type TryonPoll =
  | { state: "pending"; status: string }
  | { state: "completed"; output: { bytes: Uint8Array; mime: "image/png" | "image/jpeg" }; credits: number; raw: Record<string, unknown> }
  | { state: "failed"; code: string; message: string; retryable: boolean; raw: Record<string, unknown> };

export interface TryonProvider {
  readonly id: TryonProviderId;
  /** Shown to customers in the consent text and to staff. Never calls a mock "live". */
  readonly label: string;
  readonly isMock: boolean;
  /** What we tell the customer about the provider's handling of their photo. */
  readonly disclosure: string;
  submit(req: TryonRequest): Promise<TryonSubmit>;
  poll(providerJobId: string): Promise<TryonPoll>;
}

/** Customer-facing wording for failure codes (never raw provider text). */
export const TRYON_ERROR_MESSAGES: Record<string, string> = {
  PoseError: "We couldn't find a full body pose in your photo. Use a clear, front-facing photo with your whole torso visible.",
  ImageLoadError: "We couldn't read one of the images. Try another photo (JPEG, PNG or WebP).",
  ContentModerationError: "This photo was declined by the safety filter. Please use a different photo.",
  InputValidationError: "Something about the photo wasn't accepted. Try a different, well-lit photo.",
  OutOfCredits: "Try-on is temporarily unavailable. Please try again later.",
  RateLimitExceeded: "Try-on is busy right now. Please try again in a minute.",
  ConcurrencyLimitExceeded: "Try-on is busy right now. Please try again in a minute.",
  UnauthorizedAccess: "Try-on is temporarily unavailable.",
  timeout: "The try-on took too long. Please try again.",
  storage: "We couldn't save the result. Please try again.",
  unavailable: "Try-on is temporarily unavailable. Please try again later.",
};

export function tryonMessageFor(code: string | null | undefined): string {
  return (code && TRYON_ERROR_MESSAGES[code]) || "The try-on didn't work this time. Please try again with a different photo.";
}
