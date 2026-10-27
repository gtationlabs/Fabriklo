import * as Sentry from "@sentry/nextjs";
import { baseOptions } from "@/lib/monitoring/sentry-options";

/**
 * Server/edge error reporting. Initialised only when SENTRY_DSN is set, so
 * local QA and CI never talk to Sentry. Source maps are not uploaded (no
 * withSentryConfig): stack traces show minified frames until an auth token is
 * added to the build, see docs/DEPLOYMENT.md.
 */
export async function register() {
  if (!process.env.SENTRY_DSN) return;
  Sentry.init(baseOptions(process.env.SENTRY_DSN));
}

export const onRequestError = Sentry.captureRequestError;
