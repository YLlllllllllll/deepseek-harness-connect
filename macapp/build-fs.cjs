// The signing scanner opens many runtime files concurrently. Queue EMFILE retries
// in the build process only; no patch is applied in the shipped App.
require('graceful-fs').gracefulify(require('node:fs'));
