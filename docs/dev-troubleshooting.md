# Development Troubleshooting Notes

## Stale Next.js vendor chunk / Internal Server Error

If the browser shows `Internal Server Error` with missing vendor chunks (for example `vendor-chunks/next.js`), the local dev runtime is usually stale.

Use this sequence:

1. Stop all running `next dev` terminals.
2. Delete the local build cache:
   - Windows PowerShell: `Remove-Item -Recurse -Force .next`
3. Start a single dev server:
   - `npm run dev`
4. Refresh the browser tab (or open a fresh tab on the new port).

This is a local development issue only; production builds are unaffected.

