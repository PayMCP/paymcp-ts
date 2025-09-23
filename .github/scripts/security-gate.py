#!/usr/bin/env python3
"""
Security Gate Checker for PayMCP-TS
Enforces security quality gates based on scan results
"""

import os
import json
import sys
from typing import Dict, Any, List

class SecurityGate:
    def __init__(self):
        self.gate_config = {
            # Security thresholds that will fail the build
            'max_critical_issues': 0,
            'max_high_issues': 0,
            'max_secrets': 0,
            'max_payment_issues': 0,
            
            # Warning thresholds (won't fail build but will warn)
            'warn_medium_issues': 5,
            'warn_dependency_issues': 10,
            
            # Required scans that must complete
            'required_scans': [
                'compliance_scan',
                'dependency_scan',
            ]
        }
        
        self.violations = []
        self.warnings = []
        self.passed_checks = []

    def load_security_report(self) -> Dict[str, Any]:
        """Load the detailed security report."""
        report_file = 'security-detailed-report.json'
        if not os.path.exists(report_file):
            self.violations.append(f"❌ Security report not found: {report_file}")
            return {}
            
        try:
            with open(report_file, 'r') as f:
                return json.load(f)
        except Exception as e:
            self.violations.append(f"❌ Failed to load security report: {e}")
            return {}

    def check_critical_issues(self, report: Dict[str, Any]):
        """Check for critical security issues."""
        summary = report.get('summary', {})
        
        critical_count = summary.get('critical_count', 0)
        high_count = summary.get('high_count', 0)
        
        if critical_count > self.gate_config['max_critical_issues']:
            self.violations.append(
                f"❌ Critical issues found: {critical_count} "
                f"(max allowed: {self.gate_config['max_critical_issues']})"
            )
        else:
            self.passed_checks.append(f"✅ Critical issues: {critical_count}")
            
        if high_count > self.gate_config['max_high_issues']:
            self.violations.append(
                f"❌ High severity issues found: {high_count} "
                f"(max allowed: {self.gate_config['max_high_issues']})"
            )
        else:
            self.passed_checks.append(f"✅ High severity issues: {high_count}")

    def check_compliance_issues(self, report: Dict[str, Any]):
        """Check compliance scan results."""
        compliance = report.get('compliance_scan', {})
        
        if not compliance:
            self.violations.append("❌ Compliance scan results not found")
            return
            
        # Check secrets
        secrets_count = len(compliance.get('secrets_found', []))
        if secrets_count > self.gate_config['max_secrets']:
            self.violations.append(
                f"❌ Secrets found in code: {secrets_count} "
                f"(max allowed: {self.gate_config['max_secrets']})"
            )
        else:
            self.passed_checks.append(f"✅ Secrets in code: {secrets_count}")
            
        # Check payment issues
        payment_issues = len(compliance.get('payment_issues', []))
        if payment_issues > self.gate_config['max_payment_issues']:
            self.violations.append(
                f"❌ Payment data issues: {payment_issues} "
                f"(max allowed: {self.gate_config['max_payment_issues']})"
            )
        else:
            self.passed_checks.append(f"✅ Payment data issues: {payment_issues}")

    def check_dependency_issues(self, report: Dict[str, Any]):
        """Check dependency vulnerability issues."""
        dependency_scan = report.get('dependency_scan', {})
        
        if not dependency_scan:
            self.warnings.append("⚠️ Dependency scan results not found")
            return
            
        # Count npm audit vulnerabilities
        npm_audit = dependency_scan.get('npm_audit', {})
        total_vulnerabilities = 0
        
        if 'vulnerabilities' in npm_audit:
            total_vulnerabilities = len(npm_audit['vulnerabilities'])
            
        if total_vulnerabilities > self.gate_config['warn_dependency_issues']:
            self.warnings.append(
                f"⚠️ High number of dependency vulnerabilities: {total_vulnerabilities} "
                f"(warning threshold: {self.gate_config['warn_dependency_issues']})"
            )
        else:
            self.passed_checks.append(f"✅ Dependency vulnerabilities: {total_vulnerabilities}")

    def check_required_scans(self, report: Dict[str, Any]):
        """Verify all required scans completed."""
        for scan_name in self.gate_config['required_scans']:
            if scan_name not in report or not report[scan_name]:
                self.violations.append(f"❌ Required scan missing: {scan_name}")
            else:
                self.passed_checks.append(f"✅ Required scan completed: {scan_name}")

    def check_medium_issues(self, report: Dict[str, Any]):
        """Check medium severity issues (warning only)."""
        summary = report.get('summary', {})
        medium_count = summary.get('medium_count', 0)
        
        if medium_count > self.gate_config['warn_medium_issues']:
            self.warnings.append(
                f"⚠️ High number of medium issues: {medium_count} "
                f"(warning threshold: {self.gate_config['warn_medium_issues']})"
            )
        else:
            self.passed_checks.append(f"✅ Medium severity issues: {medium_count}")

    def run_security_gate(self):
        """Run all security gate checks."""
        print("🚪 Running Security Gate Checks...")
        print("="*60)
        
        # Load security report
        report = self.load_security_report()
        if not report:
            print("❌ SECURITY GATE FAILED: Cannot load security report")
            sys.exit(1)
            
        # Run all checks
        self.check_critical_issues(report)
        self.check_compliance_issues(report)
        self.check_dependency_issues(report)
        self.check_required_scans(report)
        self.check_medium_issues(report)
        
        # Print results
        self.print_results()
        
        # Determine exit code
        if self.violations:
            print("\n❌ SECURITY GATE FAILED")
            print("The following violations must be addressed:")
            for violation in self.violations:
                print(f"  {violation}")
            sys.exit(1)
        else:
            print("\n✅ SECURITY GATE PASSED")
            print("All security requirements met.")
            
            if self.warnings:
                print("\nWarnings (not blocking):")
                for warning in self.warnings:
                    print(f"  {warning}")
                    
            sys.exit(0)

    def print_results(self):
        """Print detailed gate check results."""
        print(f"📊 Security Gate Results:")
        print(f"  ✅ Passed Checks: {len(self.passed_checks)}")
        print(f"  ❌ Violations: {len(self.violations)}")
        print(f"  ⚠️  Warnings: {len(self.warnings)}")
        
        if self.passed_checks:
            print("\n✅ PASSED CHECKS:")
            for check in self.passed_checks:
                print(f"  {check}")
                
        if self.violations:
            print("\n❌ VIOLATIONS:")
            for violation in self.violations:
                print(f"  {violation}")
                
        if self.warnings:
            print("\n⚠️  WARNINGS:")
            for warning in self.warnings:
                print(f"  {warning}")

class SecurityGateConfig:
    """Configuration management for security gates."""
    
    @staticmethod
    def create_default_config():
        """Create a default security gate configuration file."""
        config = {
            "description": "Security Gate Configuration for PayMCP-TS",
            "version": "1.0",
            "gates": {
                "critical_issues": {
                    "max_allowed": 0,
                    "description": "Maximum critical security issues allowed"
                },
                "high_issues": {
                    "max_allowed": 0,
                    "description": "Maximum high security issues allowed"
                },
                "secrets": {
                    "max_allowed": 0,
                    "description": "Maximum secrets in code allowed"
                },
                "payment_data": {
                    "max_allowed": 0,
                    "description": "Maximum payment data issues allowed"
                }
            },
            "warnings": {
                "medium_issues": {
                    "threshold": 5,
                    "description": "Warn if medium issues exceed this threshold"
                },
                "dependency_vulnerabilities": {
                    "threshold": 10,
                    "description": "Warn if dependency vulnerabilities exceed this threshold"
                }
            },
            "required_scans": [
                "compliance_scan",
                "dependency_scan"
            ]
        }
        
        with open('.github/security-gate-config.json', 'w') as f:
            json.dump(config, f, indent=2)
            
        print("📝 Created security gate configuration at .github/security-gate-config.json")

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--create-config":
        SecurityGateConfig.create_default_config()
    else:
        gate = SecurityGate()
        gate.run_security_gate()