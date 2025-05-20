import { IShared } from "./types";
import { uuid } from "./utils";

// Helper type for LogLevel
type LogLevel = "debug" | "info" | "warn" | "error";

// Helper type for Listener functions
type Listener<T extends unknown[] = any[]> = (
  ...args: T
) => void | Promise<void>;

export class Shared<Data = unknown> implements IShared<Data> {
  public readonly id = uuid();

  /**
   * Application-specific shared data.
   */
  public data: Data;

  /**
   * AbortSignal to listen for cancellation requests.
   * Nodes should check `this.abortSignal.aborted` in long-running operations.
   */
  public readonly abortSignal: AbortSignal;
  protected abortController: AbortController; // Keep the controller to allow aborting from shared if needed

  // --- Logger Section ---
  protected logListeners: Map<LogLevel, Listener<[string, ...any[]]>[]> =
    new Map();
  protected allLogsListeners: Listener<[LogLevel, string, ...any[]]>[] = [];

  public logger = {
    debug: (message: string, ...args: any[]): void =>
      this._log("debug", message, ...args),
    info: (message: string, ...args: any[]): void =>
      this._log("info", message, ...args),
    warn: (message: string, ...args: any[]): void =>
      this._log("warn", message, ...args),
    error: (message: string, ...args: any[]): void =>
      this._log("error", message, ...args),

    /**
     * Attaches a listener that fires for a specific log level.
     * Can be used as a "middleware" or hook for logging.
     */
    on: (level: LogLevel, listener: Listener<[string, ...any[]]>): void => {
      if (!this.logListeners.has(level)) {
        this.logListeners.set(level, []);
      }
      this.logListeners.get(level)!.push(listener);
    },
    /**
     * Attaches a listener that fires for any log message.
     * The listener receives the level as the first argument.
     */
    onAll: (listener: Listener<[LogLevel, string, ...any[]]>): void => {
      this.allLogsListeners.push(listener);
    },
  };

  // --- Locker Section ---
  protected _locks: Map<string, (() => void)[]> = new Map(); // resourceId -> array of resolve functions for waiting promises

  public locker = {
    /**
     * Acquires a lock for a given resource ID.
     * If the lock is already held, it waits until the lock is released.
     * @param resourceId A unique identifier for the resource to lock.
     * @returns A Promise that resolves when the lock is acquired.
     */
    acquire: async (resourceId: string): Promise<void> => {
      // eslint-disable-next-line no-async-promise-executor
      return new Promise(async (resolve) => {
        if (
          !this._locks.has(resourceId) ||
          this._locks.get(resourceId)!.length === 0
        ) {
          this._locks.set(resourceId, []); // Mark as locked by creating an empty array
          resolve();
        } else {
          // Add this resolve to the queue for this resourceId
          this._locks.get(resourceId)!.push(resolve);
        }
      });
    },

    /**
     * Releases a lock for a given resource ID.
     * If there are other operations waiting for this lock, the next one in queue will acquire it.
     * @param resourceId The unique identifier for the resource to unlock.
     */
    release: (resourceId: string): void => {
      if (!this._locks.has(resourceId)) {
        // console.warn(`[Locker] Attempted to release a lock that was not acquired or already released: ${resourceId}`);
        return;
      }

      const waitingResolvers = this._locks.get(resourceId)!;
      if (waitingResolvers.length > 0) {
        const nextResolver = waitingResolvers.shift(); // Get the next waiting promise's resolve function
        if (nextResolver) {
          nextResolver(); // Allow the next in line to acquire the lock
        }
      } else {
        // If no one is waiting, simply mark the lock as available by deleting the entry
        // Or, if we shifted the last resolver, the array is empty, so we can delete.
        this._locks.delete(resourceId);
      }
      // If waitingResolvers is now empty, it means the lock is effectively free for the next acquirer
      // If it wasn't empty after shift, it means it was passed to the next in queue.
      if (waitingResolvers.length === 0) {
        this._locks.delete(resourceId);
      }
    },

    /**
     * Executes a critical section of code with a lock.
     * Ensures the lock is acquired before execution and released afterwards, even if an error occurs.
     * @param resourceId The unique identifier for the resource to lock.
     * @param criticalSection A function returning a Promise, representing the code to execute.
     * @returns A Promise that resolves with the result of the criticalSection.
     */
    withLock: async <T>(
      resourceId: string,
      criticalSection: () => Promise<T>
    ): Promise<T> => {
      await this.locker.acquire(resourceId);
      try {
        return await criticalSection();
      } finally {
        this.locker.release(resourceId);
      }
    },
  };

  // --- Event Emitter Section for general purpose hooks ---
  protected _eventListeners: Map<string, Listener[]> = new Map();

  /**
   * Registers an event listener for a given event name.
   * @param eventName The name of the event.
   * @param listener The callback function to execute when the event is emitted.
   * @returns A function that can be used to remove the listener.
   */
  public on<Args extends unknown[] = any[]>(
    eventName: string,
    listener: Listener<Args>
  ): () => void {
    if (!this._eventListeners.has(eventName)) {
      this._eventListeners.set(eventName, []);
    }
    this._eventListeners.get(eventName)!.push(listener as Listener);

    return () => {
      this.off(eventName, listener);
    };
  }

  /**
   * Removes an event listener for a given event name.
   * @param eventName The name of the event.
   * @param listener The callback function to remove.
   */
  public off<Args extends unknown[] = any[]>(
    eventName: string,
    listener: Listener<Args>
  ): void {
    if (!this._eventListeners.has(eventName)) {
      return;
    }
    const listeners = this._eventListeners.get(eventName)!;
    const index = listeners.indexOf(listener as Listener);
    if (index > -1) {
      listeners.splice(index, 1);
    }
  }

  /**
   * Emits an event, calling all registered listeners for that event.
   * @param eventName The name of the event to emit.
   * @param args Arguments to pass to the listeners.
   */
  public async emit<Args extends unknown[] = any[]>(
    eventName: string,
    ...args: Args
  ): Promise<void> {
    if (this.abortSignal.aborted) {
      this.logger.debug(
        `[Shared.emit] Aborted. Skipping event emit for: ${eventName}`
      );
      return;
    }
    if (this._eventListeners.has(eventName)) {
      // Iterate over a copy in case listeners modify the array (e.g., by calling off)
      const listeners = [...this._eventListeners.get(eventName)!];
      for (const listener of listeners) {
        try {
          await listener(...args);
        } catch (error) {
          this.logger.error(
            `[Shared.emit] Error in listener for event '${eventName}':`,
            error
          );
        }
        if (this.abortSignal.aborted) {
          this.logger.debug(
            `[Shared.emit] Aborted during event '${eventName}' processing.`
          );
          break; // Stop processing further listeners for this event if aborted
        }
      }
    }
  }

  constructor(initialData: Data, parentAbortController?: AbortController) {
    this.data = initialData;
    this.abortController = parentAbortController || new AbortController();
    this.abortSignal = this.abortController.signal;
  }

  /**
   * Triggers the abort signal.
   * Useful if the cancellation logic originates from within a flow controlled by this Shared instance.
   */
  public abort(reason?: any): void {
    if (!this.abortController.signal.aborted) {
      this.logger.info(
        `[Shared] Abort requested. Reason: ${reason || "No reason provided"}`
      );
      this.abortController.abort(reason);
    }
  }

  protected _log(level: LogLevel, message: string, ...args: any[]): void {
    if (this.abortSignal.aborted && level !== "error") {
      // Still log errors even if aborted
      // Optionally, log that a log attempt was skipped due to abort
      // console.debug(`[Shared.Logger] Aborted. Skipping log [${level}]: ${message}`);
      return;
    }

    // Basic console logging
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (args.length > 0) {
      console[level](logMessage, ...args);
    } else {
      console[level](logMessage);
    }

    // Call specific level listeners
    if (this.logListeners.has(level)) {
      this.logListeners.get(level)!.forEach((listener) => {
        try {
          Promise.resolve(listener(message, ...args)).catch((err) =>
            console.error(`Error in log listener for level ${level}:`, err)
          );
        } catch (err) {
          console.error(
            `Immediate error in log listener for level ${level}:`,
            err
          );
        }
      });
    }
    // Call all-logs listeners
    this.allLogsListeners.forEach((listener) => {
      try {
        Promise.resolve(listener(level, message, ...args)).catch((err) =>
          console.error(`Error in all-logs listener:`, err)
        );
      } catch (err) {
        console.error(`Immediate error in all-logs listener:`, err);
      }
    });

    // Emit a general 'log' event via the main event emitter
    // This provides another hook point if desired.
    this.emit("log", level, message, ...args).catch((err) => {
      console.error(`[Shared._log] Error emitting 'log' event:`, err);
    });
  }
}
