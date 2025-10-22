/**
 * PayMCP version information
 */

// Import version from package.json dynamically
import pkg from '../package.json' with { type: 'json' };

export const VERSION = pkg.version;
