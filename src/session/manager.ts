import { ISessionStorage, SessionStorageConfig } from "./types.js";
import { InMemorySessionStorage } from "./memory.js";

export class SessionManager {
  private static instance: ISessionStorage | undefined;

  static getStorage(config?: SessionStorageConfig): ISessionStorage {
    if (!this.instance) {
      this.instance = this.createStorage(config);
    }
    return this.instance;
  }

  static createStorage(config?: SessionStorageConfig): ISessionStorage {
    const storageConfig = config || { type: "memory" };

    switch (storageConfig.type) {
      case "memory":
        return new InMemorySessionStorage();

      case "redis":
        throw new Error(
          "Redis storage not yet implemented. Use memory storage for now.",
        );

      case "custom":
        if (storageConfig.options?.implementation) {
          return storageConfig.options.implementation as ISessionStorage;
        }
        throw new Error(
          "Custom storage requires an implementation in options.implementation",
        );

      default:
        throw new Error(`Unknown storage type: ${storageConfig.type}`);
    }
  }

  static reset(): void {
    if (this.instance) {
      // Clean up any resources (like intervals) if the storage has a destroy method
      if (
        "destroy" in this.instance &&
        typeof this.instance.destroy === "function"
      ) {
        this.instance.destroy();
      }
    }
    this.instance = undefined;
  }
}
