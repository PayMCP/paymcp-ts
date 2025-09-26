# Changelog

## 0.2.0
### Added
- Extensible provider system. Providers can now be supplied in multiple ways:
  - As config mapping `{ name: { apiKey: "..." } }` (existing behavior).
  - As ready-made instances:  
    ```ts
    { 
      stripe: new StripeProvider({ apiKey: "..." }), 
      custom: new MyProvider({ apiKey: "..." }) 
    }
    ```
  - As a list of instances:  
    ```ts
    [
      new WalleotProvider({ apiKey: "..." }), 
      new MyProvider({ apiKey: "..." })
    ]
    ```