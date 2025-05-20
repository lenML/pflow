/**
 * Represents an object that is not iterable.
 * It's a partial record of string keys to unknown values,
 * and explicitly states that it should not have a `Symbol.iterator` property.
 * @template K - The type of keys in the record (defaults to string).
 * @template V - The type of values in the record (defaults to unknown).
 */
export type NonIterableObject = Partial<Record<string, unknown>> & {
  [Symbol.iterator]?: never;
};
/**
 * Represents an action, typically a string, used to determine the next node in a flow.
 */
export type Action = string;

export type LogLevel = "debug" | "info" | "warn" | "error";
export type Listener<T extends unknown[] = any[]> = (
  ...args: T
) => void | Promise<void>;

export type Events =
  | (string & {})
  | "run_start"
  | "run_end"
  | "prep_start"
  | "prep_result"
  | "post_start"
  | "post_result"
  | "exec_start"
  | "exec_result"
  | "orchestrate_start"
  | "orchestrate_end";

/**
 * Interface for the Shared object passed between nodes in a flow.
 * It provides common utilities like logging, locking, cancellation, and event emission,
 * alongside application-specific shared data.
 *
 * @template Data - The type of the application-specific data container.
 */
export interface IShared<Data = unknown> {
  id: string;

  /**
   * Application-specific shared data.
   */
  data: Data;

  /**
   * AbortSignal to listen for cancellation requests.
   * Nodes should check `this.abortSignal.aborted` in long-running operations.
   */
  readonly abortSignal: AbortSignal;

  /**
   * Logger for recording messages with different severity levels.
   * Also allows attaching listeners (hooks/middleware) to log events.
   */
  readonly logger: {
    debug: (message: string, ...args: any[]) => void;
    info: (message: string, ...args: any[]) => void;
    warn: (message: string, ...args: any[]) => void;
    error: (message: string, ...args: any[]) => void;

    /**
     * Attaches a listener that fires for a specific log level.
     * @param level The log level to listen for.
     * @param listener The callback function.
     */
    on: (level: LogLevel, listener: Listener<[string, ...any[]]>) => void;

    /**
     * Attaches a listener that fires for any log message.
     * The listener receives the level as the first argument.
     * @param listener The callback function.
     */
    onAll: (listener: Listener<[LogLevel, string, ...any[]]>) => void;
  };

  /**
   * Asynchronous locking mechanism for controlling access to shared resources or critical sections.
   */
  readonly locker: {
    /**
     * Acquires a lock for a given resource ID.
     * If the lock is already held, it waits until the lock is released.
     * @param resourceId A unique identifier for the resource to lock.
     * @returns A Promise that resolves when the lock is acquired.
     */
    acquire: (resourceId: string) => Promise<void>;

    /**
     * Releases a lock for a given resource ID.
     * If there are other operations waiting for this lock, the next one in queue will acquire it.
     * @param resourceId The unique identifier for the resource to unlock.
     */
    release: (resourceId: string) => void;

    /**
     * Executes a critical section of code with a lock.
     * Ensures the lock is acquired before execution and released afterwards, even if an error occurs.
     * @param resourceId The unique identifier for the resource to lock.
     * @param criticalSection A function returning a Promise, representing the code to execute.
     * @returns A Promise that resolves with the result of the criticalSection.
     */
    withLock: <T>(
      resourceId: string,
      criticalSection: () => Promise<T>
    ) => Promise<T>;
  };

  /**
   * Registers an event listener for a given event name.
   * @param eventName The name of the event.
   * @param listener The callback function to execute when the event is emitted.
   * @returns A function to remove the listener.
   */
  on<Args extends unknown[] = any[]>(
    eventName: Events,
    listener: Listener<Args>
  ): () => void;

  /**
   * Removes an event listener for a given event name.
   * @param eventName The name of the event.
   * @param listener The callback function to remove.
   */
  off<Args extends unknown[] = any[]>(
    eventName: Events,
    listener: Listener<Args>
  ): void;

  /**
   * Emits an event, calling all registered listeners for that event.
   * @param eventName The name of the event to emit.
   * @param args Arguments to pass to the listeners.
   */
  emit<Args extends unknown[] = any[]>(
    eventName: Events,
    ...args: Args
  ): Promise<void>;

  /**
   * Triggers the abort signal for this shared context.
   * @param reason Optional reason for aborting.
   */
  abort(reason?: any): void;
}
