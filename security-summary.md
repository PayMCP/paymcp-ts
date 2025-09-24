# 🔒 Security Scan Results

## Summary
- **Total Issues:** 6
- **Critical:** 0
- **High:** 0
- **Moderate:** 6
- **Low:** 0
- **Info:** 0

## Scan Coverage
### 🔧 ESLint Security Scan
- ✅ Security plugins: eslint-plugin-security, eslint-plugin-no-secrets
- ✅ Results format: SARIF (security-lint-results.sarif)

### 📦 Dependency Vulnerability Scan
- ✅ npm audit completed
- ✅ audit-ci analysis completed

## 📦 Detailed Dependency Issues

| Package | Severity | Description | Fix Available |
|---------|----------|-------------|---------------|
| `@vitest/coverage-v8` | MODERATE | Vulnerability detected | Yes |
| `@vitest/mocker` | MODERATE | Vulnerability detected | Yes |
| `esbuild` | MODERATE | Vulnerability detected | Yes |
| `vite` | MODERATE | Vulnerability detected | Yes |
| `vite-node` | MODERATE | Vulnerability detected | Yes |
| `vitest` | MODERATE | Vulnerability detected | Yes |

**Quick Fix:**
```bash
npm audit fix
npm audit fix --force  # For breaking changes
```

## 🎯 Recommendations

**📋 MEDIUM:** 📋 6 moderate issues found
*Action:* Run npm audit fix to resolve moderate vulnerabilities

**📋 MEDIUM:** 📦 Update vulnerable dependencies
*Action:* Run npm update to get latest patches, or npm audit fix for automatic fixes

---
*Scan completed at 2025-09-24T17:23:37.307Z*
