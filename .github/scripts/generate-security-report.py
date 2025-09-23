#!/usr/bin/env python3
"""
Security Report Generator for PayMCP-TS
Aggregates results from all security scans and generates comprehensive reports
"""

import os
import json
import glob
from datetime import datetime
from typing import Dict, List, Any, Optional

class SecurityReportGenerator:
    def __init__(self):
        self.report_data = {
            'scan_timestamp': datetime.now().isoformat(),
            'codeql_results': {},
            'dependency_scan': {},
            'eslint_security': {},
            'semgrep_results': {},
            'compliance_scan': {},
            'summary': {
                'total_issues': 0,
                'critical_count': 0,
                'high_count': 0,
                'medium_count': 0,
                'low_count': 0,
                'info_count': 0
            },
            'recommendations': []
        }

    def load_json_file(self, filepath: str) -> Optional[Dict]:
        """Safely load a JSON file."""
        if os.path.exists(filepath):
            try:
                with open(filepath, 'r') as f:
                    return json.load(f)
            except Exception as e:
                print(f"Error loading {filepath}: {e}")
        return None

    def find_artifact_file(self, pattern: str) -> Optional[str]:
        """Find artifact file by pattern."""
        files = glob.glob(pattern, recursive=True)
        return files[0] if files else None

    def process_npm_audit_results(self):
        """Process npm audit results."""
        audit_file = self.find_artifact_file("**/npm-audit.json")
        if audit_file:
            data = self.load_json_file(audit_file)
            if data:
                self.report_data['dependency_scan']['npm_audit'] = data
                
                # Count vulnerabilities
                if 'vulnerabilities' in data:
                    for vuln_name, vuln_data in data['vulnerabilities'].items():
                        severity = vuln_data.get('severity', 'info').lower()
                        self.increment_severity_count(severity)

    def process_audit_ci_results(self):
        """Process audit-ci results."""
        audit_ci_file = self.find_artifact_file("**/audit-ci-results.json")
        if audit_ci_file:
            data = self.load_json_file(audit_ci_file)
            if data:
                self.report_data['dependency_scan']['audit_ci'] = data

    def process_eslint_results(self):
        """Process ESLint security results."""
        eslint_file = self.find_artifact_file("**/eslint-security.json")
        if eslint_file:
            data = self.load_json_file(eslint_file)
            if data and isinstance(data, list):
                self.report_data['eslint_security']['results'] = data
                
                # Count ESLint issues
                for file_result in data:
                    if 'messages' in file_result:
                        for message in file_result['messages']:
                            severity = message.get('severity', 1)
                            if severity == 2:  # Error
                                self.increment_severity_count('high')
                            else:  # Warning
                                self.increment_severity_count('medium')

    def process_compliance_results(self):
        """Process custom compliance scan results."""
        compliance_file = self.find_artifact_file("**/compliance-scan-results.json")
        if compliance_file:
            data = self.load_json_file(compliance_file)
            if data:
                self.report_data['compliance_scan'] = data
                
                # Add to summary counts
                self.report_data['summary']['critical_count'] += data.get('high_severity_count', 0)
                self.report_data['summary']['medium_count'] += data.get('medium_severity_count', 0)
                self.report_data['summary']['low_count'] += data.get('low_severity_count', 0)

    def increment_severity_count(self, severity: str):
        """Increment count for given severity level."""
        severity_map = {
            'critical': 'critical_count',
            'high': 'high_count',
            'medium': 'medium_count',
            'moderate': 'medium_count',
            'low': 'low_count',
            'info': 'info_count'
        }
        
        count_key = severity_map.get(severity.lower(), 'info_count')
        self.report_data['summary'][count_key] += 1
        self.report_data['summary']['total_issues'] += 1

    def generate_recommendations(self):
        """Generate security recommendations based on findings."""
        recommendations = []
        
        # Check for high/critical issues
        if self.report_data['summary']['critical_count'] > 0:
            recommendations.append({
                'priority': 'CRITICAL',
                'message': f"🚨 {self.report_data['summary']['critical_count']} critical security issues found. Immediate action required.",
                'action': 'Review and fix all critical issues before deployment'
            })
            
        if self.report_data['summary']['high_count'] > 0:
            recommendations.append({
                'priority': 'HIGH',
                'message': f"⚠️ {self.report_data['summary']['high_count']} high severity issues found.",
                'action': 'Address high severity issues in current sprint'
            })

        # Check compliance scan results
        compliance = self.report_data.get('compliance_scan', {})
        if compliance.get('secrets_found'):
            recommendations.append({
                'priority': 'CRITICAL',
                'message': f"🔑 {len(compliance['secrets_found'])} potential secrets found in code",
                'action': 'Remove all hardcoded secrets and use environment variables'
            })
            
        if compliance.get('payment_issues'):
            recommendations.append({
                'priority': 'HIGH',
                'message': f"💳 {len(compliance['payment_issues'])} payment data issues found",
                'action': 'Review payment data handling for PCI compliance'
            })

        # Check dependency issues
        dep_scan = self.report_data.get('dependency_scan', {})
        if dep_scan:
            recommendations.append({
                'priority': 'MEDIUM',
                'message': "📦 Run 'npm audit fix' to automatically resolve dependency vulnerabilities",
                'action': 'Update vulnerable dependencies to secure versions'
            })

        # Add general recommendations
        if self.report_data['summary']['total_issues'] == 0:
            recommendations.append({
                'priority': 'INFO',
                'message': "✅ No security issues detected in this scan",
                'action': 'Continue following security best practices'
            })
        
        self.report_data['recommendations'] = recommendations

    def generate_markdown_summary(self) -> str:
        """Generate markdown summary for PR comments."""
        summary = self.report_data['summary']
        
        md = f"""# 🔒 Security Scan Results

## Summary
- **Total Issues:** {summary['total_issues']}
- **Critical:** {summary['critical_count']} 
- **High:** {summary['high_count']}
- **Medium:** {summary['medium_count']}
- **Low:** {summary['low_count']}
- **Info:** {summary['info_count']}

## Scan Coverage
"""

        # Add scan results details
        if self.report_data['compliance_scan']:
            compliance = self.report_data['compliance_scan']
            md += f"""
### 🔍 Compliance Scan
- **Files Scanned:** {compliance.get('scanned_files', 0)}
- **Secrets Found:** {len(compliance.get('secrets_found', []))}
- **Payment Issues:** {len(compliance.get('payment_issues', []))}
- **Dependency Issues:** {len(compliance.get('dependency_issues', []))}
"""

        if self.report_data['dependency_scan']:
            md += "\n### 📦 Dependency Vulnerability Scan\n- ✅ npm audit completed\n- ✅ audit-ci analysis completed\n"

        if self.report_data['eslint_security']:
            md += "\n### 🔧 ESLint Security Scan\n- ✅ Security linting completed\n"

        # Add recommendations
        if self.report_data['recommendations']:
            md += "\n## 🎯 Recommendations\n"
            for rec in self.report_data['recommendations']:
                priority_emoji = {
                    'CRITICAL': '🚨',
                    'HIGH': '⚠️',
                    'MEDIUM': '📋',
                    'INFO': 'ℹ️'
                }.get(rec['priority'], 'ℹ️')
                
                md += f"\n**{priority_emoji} {rec['priority']}:** {rec['message']}\n"
                md += f"*Action:* {rec['action']}\n"

        md += f"\n---\n*Scan completed at {self.report_data['scan_timestamp']}*"
        
        return md

    def generate_reports(self):
        """Generate all security reports."""
        print("📊 Generating Security Reports...")
        
        # Process all scan results
        self.process_npm_audit_results()
        self.process_audit_ci_results()
        self.process_eslint_results()
        self.process_compliance_results()
        
        # Generate recommendations
        self.generate_recommendations()
        
        # Save detailed JSON report
        with open('security-detailed-report.json', 'w') as f:
            json.dump(self.report_data, f, indent=2)
            
        # Generate markdown summary
        markdown_summary = self.generate_markdown_summary()
        with open('security-summary.md', 'w') as f:
            f.write(markdown_summary)
            
        # Print summary to console
        print("\n" + "="*60)
        print("🔒 SECURITY SCAN SUMMARY")
        print("="*60)
        summary = self.report_data['summary']
        print(f"📊 Total Issues: {summary['total_issues']}")
        print(f"🚨 Critical: {summary['critical_count']}")
        print(f"⚠️  High: {summary['high_count']}")
        print(f"📋 Medium: {summary['medium_count']}")
        print(f"ℹ️  Low: {summary['low_count']}")
        print(f"💡 Info: {summary['info_count']}")
        
        if self.report_data['recommendations']:
            print(f"\n🎯 {len(self.report_data['recommendations'])} recommendations generated")
            
        print("="*60)
        print("📄 Reports generated:")
        print("  - security-detailed-report.json")
        print("  - security-summary.md")
        print("="*60)

if __name__ == "__main__":
    generator = SecurityReportGenerator()
    generator.generate_reports()