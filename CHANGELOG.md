# Changelog

## 0.3.3
### Changed
- Kept original tool UI in ChatGPT Apps by removing `_meta` from the initial tool and applying it only to confirmation tools in TWO_STEP payment flow. 

## 0.3.1 
### Added
- Experimental payment flow `DYNAMIC_TOOLS`.

## 0.2.1
### Added
- Support for pluggable state storage in TWO_STEP flow.
  - Default is in-memory.
  - New `RedisStateStore` implementation allows persisting state in Redis.

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