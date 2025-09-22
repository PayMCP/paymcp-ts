# Testing Guide

This guide covers the testing setup, organization, and best practices for the PayMCP TypeScript library.

## Test Structure

The test suite is organized into logical directories that mirror the application architecture:

```
tests/
├── comprehensive/          # Comprehensive test suites
│   ├── edge-cases.test.ts  # Edge cases and 100% coverage tests
│   └── final.test.ts       # Final coverage verification tests
├── scenarios/              # End-to-end scenario tests
│   └── delayed-payment.test.ts  # ENG-114 delayed payment scenarios
├── core/                   # Core PayMCP functionality
│   ├── paymcp.test.ts      # Main PayMCP class tests
│   └── paymcp-extra.test.ts # Additional PayMCP functionality
├── flows/                  # Payment flow tests
│   ├── elicitation.test.ts # Elicitation flow tests
│   ├── progress.test.ts    # Progress flow tests
│   ├── two-step.test.ts    # Two-step flow tests
│   └── index.test.ts       # Flow factory tests
├── providers/              # Payment provider tests
│   ├── adyen.test.ts       # Adyen provider
│   ├── base.test.ts        # Base provider functionality
│   ├── coinbase.test.ts    # Coinbase Commerce provider
│   ├── paypal.test.ts      # PayPal provider
│   ├── square.test.ts      # Square provider
│   ├── stripe.test.ts      # Stripe provider
│   ├── walleot.test.ts     # Walleot provider
│   └── index.test.ts       # Provider factory tests
├── session/                # Session management tests
│   ├── manager.test.ts     # Session manager tests
│   └── memory.test.ts      # In-memory storage tests
└── utils/                  # Utility function tests
    ├── messages.test.ts    # Message utility tests
    └── payment.test.ts     # Payment utility tests
```

## Running Tests

### All Tests
```bash
npm test
```

### Watch Mode (Development)
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

### Specific Test File
```bash
npx vitest run tests/providers/stripe.test.ts
```

### Specific Test Pattern
```bash
npx vitest run --grep "PayPal"
```

## Test Framework

We use **Vitest** as our test framework for the following reasons:

- **Fast execution** with modern ES modules support
- **Native TypeScript support** without additional configuration
- **Compatible API** with Jest for easy migration
- **Built-in mocking** capabilities
- **Fake timers** for testing timeout scenarios

### Key Testing Utilities

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocking
vi.fn()                    // Create mock function
vi.spyOn(obj, 'method')   // Spy on existing method
vi.mock('module')         // Mock entire module

// Fake Timers
vi.useFakeTimers()        // Enable fake timers
vi.useRealTimers()        // Restore real timers
vi.advanceTimersByTime()  // Advance time
vi.runAllTimersAsync()    // Run all timers to completion
```

## Testing Patterns

### 1. Provider Testing

All payment providers follow a consistent testing pattern:

```typescript
describe('ProviderName', () => {
  beforeEach(() => {
    // Setup mocks
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ /* mock response */ })
    } as Response);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should create payment successfully', async () => {
    // Test implementation
  });
});
```

### 2. Flow Testing with Fake Timers

For timeout-based flows, we use fake timers to speed up tests:

```typescript
describe('ProgressFlow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should handle timeout scenario', async () => {
    const promise = wrapper(args, extra);
    
    // Fast-forward through timeout
    await vi.runAllTimersAsync();
    
    const result = await promise;
    expect(result.status).toBe('pending');
  });
});
```

### 3. Session Management Testing

Session tests verify persistence and cleanup:

```typescript
it('should persist session for delayed payments', async () => {
  // Create payment and session
  await wrapper(args, extra);
  
  // Verify session exists
  const storage = SessionManager.getStorage();
  const sessionKey = { provider: 'mock', paymentId: 'test_123' };
  const session = await storage.get(sessionKey);
  
  expect(session).toBeDefined();
  expect(session?.args).toEqual(args);
});
```

## Mocking Strategy

### 1. Network Requests

All external API calls are mocked to prevent real network requests:

```typescript
beforeEach(() => {
  vi.spyOn(global, 'fetch').mockImplementation((url, options) => {
    if (url.includes('/create-payment')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ 
          id: 'mock_payment_123',
          url: 'https://mock.provider.com/pay/123'
        })
      } as Response);
    }
    // Handle other endpoints...
  });
});
```

### 2. Provider Status Simulation

For testing payment flows, we simulate status changes:

```typescript
let statusCallCount = 0;
mockProvider.getPaymentStatus = vi.fn().mockImplementation(() => {
  statusCallCount++;
  // After 40 calls (~2 minutes), payment is approved
  return statusCallCount > 40 ? 'paid' : 'pending';
});
```

### 3. MCP Server Mocking

Mock MCP server interactions:

```typescript
const mockServer = {
  registerTool: vi.fn(),
  reportProgress: vi.fn(),
  requestElicitation: vi.fn().mockResolvedValue({ action: 'accept' }),
} as any;
```

## Test Scenarios

### 1. Basic Functionality Tests

- Provider initialization and configuration
- Payment creation with various parameters
- Payment status checking
- Error handling (API errors, network errors)

### 2. Flow Integration Tests

- **Elicitation Flow**: User prompt → payment → tool execution
- **Progress Flow**: Background polling → status updates → completion
- **Two-Step Flow**: Payment creation → manual confirmation → execution

### 3. Edge Cases and Error Scenarios

- Invalid payment IDs
- Network timeouts
- API rate limiting
- Malformed responses
- Session expiration

### 4. Delayed Payment Scenarios (ENG-114)

Test realistic user behavior where payment approval is delayed:

```typescript
it('should handle 2-minute payment delay', async () => {
  // User initiates payment
  const promise = wrapper(args, extra);
  
  // Simulate user going to payment URL (2 minutes)
  await vi.runAllTimersAsync();
  
  // User returns and confirms payment
  mockProvider.getPaymentStatus.mockResolvedValue('paid');
  const confirmResult = await confirmHandler({ payment_id: 'test_123' });
  
  expect(confirmResult.content[0].text).toBe('Tool executed successfully');
});
```

## Coverage Requirements

We maintain high test coverage with specific focus on:

- **Provider compatibility**: All payment providers tested
- **Flow completeness**: All payment flows covered
- **Error handling**: All error paths tested
- **Edge cases**: Boundary conditions and unusual inputs
- **Session management**: Timeout and resume scenarios

### Coverage Reports

Generate detailed coverage reports:

```bash
npm run test:coverage
```

This generates reports in multiple formats:
- Terminal summary
- HTML report in `coverage/` directory
- LCOV format for CI integration

## Debugging Tests

### 1. Verbose Output
```bash
npx vitest run --reporter=verbose
```

### 2. Debug Specific Test
```bash
npx vitest run tests/providers/stripe.test.ts --reporter=verbose
```

### 3. Debug with Node Inspector
```bash
node --inspect-brk ./node_modules/.bin/vitest run
```

## Continuous Integration

Tests are configured to run in CI with:

- **Parallel execution** for faster builds
- **Coverage thresholds** to maintain quality
- **Retry logic** for flaky network-dependent tests
- **Artifact collection** for failed test debugging

### CI Configuration

```yaml
- name: Run Tests
  run: npm test -- --coverage --reporter=junit
  
- name: Upload Coverage
  uses: codecov/codecov-action@v3
  with:
    file: ./coverage/lcov.info
```

## Best Practices

### 1. Test Naming
- Use descriptive test names that explain the scenario
- Follow pattern: "should [expected behavior] when [condition]"
- Group related tests with `describe` blocks

### 2. Test Isolation
- Each test should be independent
- Use `beforeEach`/`afterEach` for setup/cleanup
- Avoid shared state between tests

### 3. Mock Management
- Reset mocks between tests
- Use specific mocks for specific scenarios
- Avoid over-mocking (test real code paths when possible)

### 4. Async Testing
- Always `await` async operations
- Use fake timers for timeout testing
- Handle promise rejections properly

### 5. Error Testing
- Test both success and failure scenarios
- Verify error messages and codes
- Test edge cases and boundary conditions

## Troubleshooting

### Common Issues

1. **Tests hanging**: Usually due to unmocked async operations
   - Check for real network calls
   - Ensure all timers are properly managed

2. **Flaky tests**: Often related to timing issues
   - Use fake timers instead of real delays
   - Ensure proper async/await usage

3. **Import errors**: Path issues after file reorganization
   - Verify relative import paths
   - Check for circular dependencies

4. **Mock conflicts**: Multiple tests affecting each other
   - Use `vi.clearAllMocks()` in `afterEach`
   - Isolate mock scope to specific tests

### Getting Help

- Check existing test patterns in similar files
- Review Vitest documentation for advanced features
- Use `console.log` sparingly for debugging (clean up afterward)
- Consider adding integration tests for complex scenarios

## Performance

The test suite is optimized for speed:

- **~10 seconds** total execution time
- **Fake timers** eliminate real delays
- **Parallel execution** where possible
- **Smart mocking** prevents external dependencies

This allows for rapid development iteration and reliable CI/CD pipelines.