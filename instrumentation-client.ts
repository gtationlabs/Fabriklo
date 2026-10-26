import * as Sentry from "@sentry/nextjs";
import { baseOptions } from "@/lib/monitoring/sentry-options";

// Browser error reporting; off unless NEXT_PUBLIC_SENTRY_DSN is set.
// Replay is deliberately not enabled (it would record customer photos/forms).
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    ...baseOptions(process.env.NEXT_PUBLIC_SENTRY_DSN),
    integrations: [],
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
