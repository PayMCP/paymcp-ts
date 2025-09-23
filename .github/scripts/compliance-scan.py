#!/usr/bin/env python3
"""
Custom Compliance Scanner for PayMCP-TS
Adapted from PayMCP Python version for TypeScript/JavaScript projects
"""

import os
import re
import json
import glob
import sys
from typing import Dict, List, Any
import subprocess

class ComplianceScanner:
    def __init__(self):
        self.results = {
            'secrets_found': [],
            'payment_issues': [],
            'dependency_issues': [],
            'high_severity_count': 0,
            'medium_severity_count': 0,
            'low_severity_count': 0,
            'scan_timestamp': None,
            'scanned_files': 0
        }
        
        # Secret patterns for TypeScript/JavaScript
        self.secret_patterns = {
            'api_key': re.compile(r'(?i)(api[_-]?key|apikey)\s*[:=]\s*["\']([a-zA-Z0-9_\-]{16,})["\']'),
            'secret_key': re.compile(r'(?i)(secret[_-]?key|secretkey)\s*[:=]\s*["\']([a-zA-Z0-9_\-]{16,})["\']'),
            'password': re.compile(r'(?i)password\s*[:=]\s*["\']([^"\']{8,})["\']'),
            'jwt_token': re.compile(r'eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*'),
            'private_key': re.compile(r'-----BEGIN (RSA )?PRIVATE KEY-----'),
            'aws_access_key': re.compile(r'AKIA[0-9A-Z]{16}'),
            'aws_secret_key': re.compile(r'(?i)aws[_-]?secret[_-]?access[_-]?key.*["\']([A-Za-z0-9/+=]{40})["\']'),
            'github_token': re.compile(r'gh[ps]_[A-Za-z0-9_]{36}'),
            'bearer_token': re.compile(r'(?i)bearer\s+[A-Za-z0-9_\-\.]{20,}'),
            'stripe_key': re.compile(r'(?i)(sk|pk)_(test|live)_[A-Za-z0-9]{24,}'),
        }
        
        # Payment data patterns
        self.payment_patterns = {
            'credit_card': re.compile(r'\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|3[0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b'),
            'cvv': re.compile(r'(?i)(cvv|cvc|security[_-]?code)\s*[:=]\s*["\']?(\d{3,4})["\']?'),
            'expiry': re.compile(r'(?i)(exp|expiry|expiration)[_-]?(date|month|year)?\s*[:=]\s*["\']?(\d{1,2}[\/\-]\d{2,4}|\d{4})["\']?'),
            'payment_logging': re.compile(r'(?i)(console\.log|logger\.|log\.)\s*\([^)]*(?:card|payment|cvv|ssn|credit)[^)]*\)'),
        }
        
        # Vulnerable package patterns
        self.vulnerable_packages = {
            'lodash': r'"lodash"\s*:\s*"[^4]',  # Versions before 4.x have vulnerabilities
            'moment': r'"moment"\s*:\s*"',      # Moment.js is deprecated
            'node-uuid': r'"node-uuid"',        # Deprecated in favor of uuid
            'request': r'"request"\s*:\s*"',    # Deprecated package
        }

    def scan_file(self, filepath: str) -> Dict[str, Any]:
        """Scan a single file for compliance issues."""
        file_results = {
            'secrets': [],
            'payment_issues': [],
            'file_path': filepath
        }
        
        try:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
                
            # Scan for secrets
            for secret_type, pattern in self.secret_patterns.items():
                matches = pattern.finditer(content)
                for match in matches:
                    secret_info = {
                        'type': secret_type,
                        'file': filepath,
                        'line': content[:match.start()].count('\n') + 1,
                        'severity': 'high',
                        'message': f'Potential {secret_type} found'
                    }
                    file_results['secrets'].append(secret_info)
                    self.results['high_severity_count'] += 1
            
            # Scan for payment data issues
            for payment_type, pattern in self.payment_patterns.items():
                matches = pattern.finditer(content)
                for match in matches:
                    payment_info = {
                        'type': payment_type,
                        'file': filepath,
                        'line': content[:match.start()].count('\n') + 1,
                        'severity': 'high' if payment_type in ['credit_card', 'cvv'] else 'medium',
                        'message': f'Potential {payment_type} data found'
                    }
                    file_results['payment_issues'].append(payment_info)
                    if payment_info['severity'] == 'high':
                        self.results['high_severity_count'] += 1
                    else:
                        self.results['medium_severity_count'] += 1
                        
        except Exception as e:
            print(f"Error scanning file {filepath}: {e}")
            
        return file_results

    def scan_dependencies(self):
        """Scan package.json for vulnerable dependencies."""
        package_files = ['package.json', 'package-lock.json', 'yarn.lock']
        
        for package_file in package_files:
            if os.path.exists(package_file):
                try:
                    with open(package_file, 'r') as f:
                        content = f.read()
                        
                    for package_name, pattern in self.vulnerable_packages.items():
                        if re.search(pattern, content):
                            dependency_issue = {
                                'type': 'vulnerable_dependency',
                                'package': package_name,
                                'file': package_file,
                                'severity': 'medium',
                                'message': f'Potentially vulnerable package: {package_name}'
                            }
                            self.results['dependency_issues'].append(dependency_issue)
                            self.results['medium_severity_count'] += 1
                            
                except Exception as e:
                    print(f"Error scanning {package_file}: {e}")

    def get_typescript_files(self) -> List[str]:
        """Get all TypeScript and JavaScript files to scan."""
        patterns = [
            'src/**/*.ts',
            'src/**/*.tsx', 
            'src/**/*.js',
            'src/**/*.jsx',
            'lib/**/*.ts',
            'lib/**/*.js',
            '*.ts',
            '*.js'
        ]
        
        files = []
        for pattern in patterns:
            files.extend(glob.glob(pattern, recursive=True))
            
        # Filter out node_modules, build directories, and test files
        filtered_files = []
        for file in files:
            if not any(exclude in file for exclude in [
                'node_modules', 
                'dist/', 
                'build/', 
                '.test.', 
                '.spec.',
                'coverage/'
            ]):
                filtered_files.append(file)
                
        return filtered_files

    def run_npm_audit(self):
        """Run npm audit and parse results."""
        try:
            # Run npm audit
            result = subprocess.run(
                ['npm', 'audit', '--json'],
                capture_output=True,
                text=True,
                cwd='.'
            )
            
            if result.stdout:
                audit_data = json.loads(result.stdout)
                
                # Parse vulnerabilities
                if 'vulnerabilities' in audit_data:
                    for vuln_name, vuln_data in audit_data['vulnerabilities'].items():
                        severity = vuln_data.get('severity', 'unknown')
                        dependency_issue = {
                            'type': 'npm_audit_vulnerability',
                            'package': vuln_name,
                            'severity': severity,
                            'message': f'npm audit found {severity} vulnerability in {vuln_name}',
                            'via': vuln_data.get('via', [])
                        }
                        self.results['dependency_issues'].append(dependency_issue)
                        
                        if severity == 'high' or severity == 'critical':
                            self.results['high_severity_count'] += 1
                        elif severity == 'moderate':
                            self.results['medium_severity_count'] += 1
                        else:
                            self.results['low_severity_count'] += 1
                            
        except Exception as e:
            print(f"Error running npm audit: {e}")

    def scan_project(self):
        """Run complete compliance scan on the project."""
        print("🔍 Starting PayMCP-TS Compliance Scan...")
        
        # Get files to scan
        files_to_scan = self.get_typescript_files()
        print(f"📁 Found {len(files_to_scan)} TypeScript/JavaScript files to scan")
        
        # Scan each file
        for filepath in files_to_scan:
            file_results = self.scan_file(filepath)
            self.results['secrets_found'].extend(file_results['secrets'])
            self.results['payment_issues'].extend(file_results['payment_issues'])
            self.results['scanned_files'] += 1
            
        # Scan dependencies
        print("📦 Scanning dependencies...")
        self.scan_dependencies()
        self.run_npm_audit()
        
        # Add timestamp
        import datetime
        self.results['scan_timestamp'] = datetime.datetime.now().isoformat()
        
        return self.results

    def generate_report(self):
        """Generate and save compliance report."""
        results = self.scan_project()
        
        # Save detailed results
        with open('compliance-scan-results.json', 'w') as f:
            json.dump(results, f, indent=2)
            
        # Print summary
        print("\n" + "="*60)
        print("🔒 PAYMCP-TS COMPLIANCE SCAN RESULTS")
        print("="*60)
        print(f"📊 Files Scanned: {results['scanned_files']}")
        print(f"🔑 Secrets Found: {len(results['secrets_found'])}")
        print(f"💳 Payment Issues: {len(results['payment_issues'])}")
        print(f"📦 Dependency Issues: {len(results['dependency_issues'])}")
        print(f"🚨 High Severity: {results['high_severity_count']}")
        print(f"⚠️  Medium Severity: {results['medium_severity_count']}")
        print(f"ℹ️  Low Severity: {results['low_severity_count']}")
        
        # Print details if issues found
        if results['secrets_found']:
            print("\n🔑 SECRETS FOUND:")
            for secret in results['secrets_found']:
                print(f"  - {secret['type']} in {secret['file']}:{secret['line']}")
                
        if results['payment_issues']:
            print("\n💳 PAYMENT ISSUES:")
            for issue in results['payment_issues']:
                print(f"  - {issue['type']} in {issue['file']}:{issue['line']}")
                
        if results['dependency_issues']:
            print("\n📦 DEPENDENCY ISSUES:")
            for issue in results['dependency_issues']:
                print(f"  - {issue['severity']}: {issue['package']} - {issue['message']}")
        
        print("="*60)
        
        # Exit with error code if high severity issues found
        if results['high_severity_count'] > 0:
            print("❌ High severity issues found. Please address before proceeding.")
            sys.exit(1)
        else:
            print("✅ No high severity compliance issues found.")
            sys.exit(0)

if __name__ == "__main__":
    scanner = ComplianceScanner()
    scanner.generate_report()