/**
 * Version tracking for paymcp-ts
 * This random hash changes whenever source code is modified
 */

// Generate a unique build identifier based on current timestamp
// This will change every time the package is rebuilt
export const BUILD_HASH = `build_${Date.now()}_${Math.random().toString(36).substring(7)}`;

// Package version from package.json
export const VERSION = '0.1.0';

// Export version info
export function getVersionInfo() {
    return {
        version: VERSION,
        buildHash: BUILD_HASH,
        buildTime: new Date().toISOString()
    };
}
