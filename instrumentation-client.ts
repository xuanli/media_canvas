// PostHog analytics + session replay. Next.js runs this file once in the
// browser before the app hydrates (instrumentation-client convention), so no
// provider component is needed. Session recording is controlled by the
// project's "Record user sessions" toggle in PostHog and starts automatically
// once posthog-js is initialized here.
import posthog from 'posthog-js'

if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    defaults: '2026-05-30',
    person_profiles: 'identified_only',
    session_recording: {
      // The canvas is the whole product; keep default masking for inputs so
      // the passcode field in PasscodeGate is never recorded.
      maskAllInputs: true,
    },
  })
}
