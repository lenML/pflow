import { BaseNode } from "./BaseNode";
import { NonIterableObject, Action, IShared } from "./types";

/**
 * A node with built-in retry logic for its `exec` method.
 * Extends {@link BaseNode}.
 *
 * @template S - The type of the shared data object.
 * @template P - The type of parameters specific to this node.
 */
class Node<
  S extends IShared = IShared,
  P extends NonIterableObject = NonIterableObject,
  A extends Action = Action,
  PrepRes = unknown,
  ExecRes = unknown
> extends BaseNode<S, P, A, PrepRes, ExecRes> {
  /** Maximum number of retry attempts for the `exec` method. */
  maxRetries: number;
  /** Time to wait in seconds between retries. */
  wait: number;

  /**
   * Constructs a `Node` instance.
   * @param maxRetries - Maximum number of retries. Defaults to 1 (meaning one initial attempt, no retries).
   * @param wait - Wait time in seconds between retries. Defaults to 0.
   */
  constructor(maxRetries: number = 1, wait: number = 0) {
    super();
    this.maxRetries = maxRetries;
    this.wait = wait;
  }

  /**
   * Fallback method called if all retry attempts for `exec` fail.
   * By default, it re-throws the error. Subclasses can override this
   * to implement custom error handling or provide a default result.
   * @param prepRes - The result from the `prep` method.
   * @param error - The error that occurred during the last `exec` attempt.
   * @returns A promise that resolves to a fallback result or throws an error.
   */
  async execFallback(
    prepRes: PrepRes | undefined,
    error: Error
  ): Promise<ExecRes | undefined> {
    // Default behavior is to re-throw the error.
    throw error;
  }

  /**
   * Internal execution wrapper with retry logic.
   * It attempts to call the public `exec` method `maxRetries` times.
   * If all attempts fail, it calls `execFallback`.
   * @param prepRes - The result from the `prep` method.
   * @returns A promise that resolves to the execution result or fallback result.
   * @protected
   */
  async _exec(prepRes: PrepRes | undefined): Promise<ExecRes | undefined> {
    for (let currentRetry = 0; currentRetry < this.maxRetries; currentRetry++) {
      try {
        // Attempt to execute the main logic.
        return await this.exec(prepRes);
      } catch (e) {
        if (currentRetry === this.maxRetries - 1) {
          // If it's the last retry, execute the fallback.
          return await this.execFallback(prepRes, e as Error);
        }
        if (this.wait > 0) {
          // Wait before the next retry if a wait time is specified.
          await new Promise((resolve) => setTimeout(resolve, this.wait * 1000));
        }
      }
    }
    // This line should theoretically be unreachable if maxRetries >= 1,
    // as either exec succeeds, or execFallback is called.
    // Added for completeness or if maxRetries could be 0 (though constructor defaults to 1).
    return undefined as ExecRes;
  }
}

/**
 * A node that processes an array of items in batch, sequentially.
 * Extends {@link Node}, so it inherits retry logic for each item's `exec` call.
 * The `prep` method of this node is expected to return the array of items.
 *
 * @template S - The type of the shared data object.
 * @template P - The type of parameters specific to this node.
 */
class BatchNode<
  S extends IShared = IShared,
  P extends NonIterableObject = NonIterableObject,
  A extends Action = Action,
  PrepRes = unknown,
  ExecRes = unknown
> extends Node<S, P, A, PrepRes[], ExecRes[]> {
  async postItem(prepRes: PrepRes, execRes: ExecRes): Promise<A | undefined> {
    return undefined;
  }

  async mergeActions(actions: (A | undefined)[]): Promise<A | undefined> {
    return actions[0];
  }

  async post(prepRes: PrepRes[], execRes: ExecRes[]): Promise<A | undefined> {
    const actions: (A | undefined)[] = [];
    for (let i = 0; i < prepRes.length; i++) {
      // FIXME: error catch
      actions.push(await this.postItem(prepRes[i], execRes[i]));
    }
    return await this.mergeActions(actions);
  }

  async execItem(prepRes: PrepRes): Promise<ExecRes> {
    return undefined as ExecRes;
  }

  async exec(prepRes: PrepRes[]): Promise<ExecRes[]> {
    const execRes: ExecRes[] = [];
    for (const payload of prepRes) {
      execRes.push(await this.execItem(payload));
    }
    return execRes;
  }

  async execFallbackItem(prepRes: PrepRes, error: Error): Promise<ExecRes> {
    throw error;
  }

  async execFallback(prepRes: PrepRes[], error: Error): Promise<ExecRes[]> {
    const res: ExecRes[] = [];
    for (const payload of prepRes) {
      res.push(await this.execFallbackItem(payload, error));
    }
    return res;
  }

  /**
   * Internal execution wrapper with retry logic.
   * It attempts to call the public `exec` method `maxRetries` times.
   * If all attempts fail, it calls `execFallback`.
   * @param prepRes - The result from the `prep` method.
   * @returns A promise that resolves to the execution result or fallback result.
   * @protected
   */
  async _execItem(prepRes: PrepRes): Promise<ExecRes> {
    for (let currentRetry = 0; currentRetry < this.maxRetries; currentRetry++) {
      try {
        // Attempt to execute the main logic.
        return await this.execItem(prepRes);
      } catch (e) {
        if (currentRetry === this.maxRetries - 1) {
          // If it's the last retry, execute the fallback.
          return await this.execFallbackItem(prepRes, e as Error);
        }
        if (this.wait > 0) {
          // Wait before the next retry if a wait time is specified.
          await new Promise((resolve) => setTimeout(resolve, this.wait * 1000));
        }
      }
    }
    // This line should theoretically be unreachable if maxRetries >= 1,
    // as either exec succeeds, or execFallback is called.
    // Added for completeness or if maxRetries could be 0 (though constructor defaults to 1).
    return undefined as ExecRes;
  }

  /**
   * Overrides `_exec` to process an array of items sequentially.
   * Each item is passed to the `super._exec` method, which means individual
   * item processing benefits from the retry logic of the `Node` class.
   * @param items - An array of items to be processed. Expected to be the `prepRes`.
   * @returns A promise that resolves to an array of results, one for each processed item.
   *          Returns an empty array if `items` is not a valid array.
   * @protected
   */
  async _exec(items: PrepRes[]): Promise<ExecRes[]> {
    // Ensure items is an array.
    if (!items || !Array.isArray(items)) {
      console.warn(
        "BatchNode received non-array input for batch processing. Returning empty array."
      );
      return [];
    }
    const results: ExecRes[] = [];
    for (const item of items) {
      results.push(await this._execItem(item));
    }
    return results;
  }
}

/**
 * A node that processes an array of items in batch, in parallel.
 * Extends {@link Node}, so it inherits retry logic for each item's `exec` call.
 * The `prep` method of this node is expected to return the array of items.
 *
 * @template S - The type of the shared data object.
 * @template P - The type of parameters specific to this node.
 */
class ParallelBatchNode<
  S extends IShared = IShared,
  P extends NonIterableObject = NonIterableObject,
  A extends Action = Action,
  PrepRes = unknown,
  ExecRes = unknown
> extends BatchNode<S, P, A, PrepRes, ExecRes> {
  /**
   * Overrides `_exec` to process an array of items in parallel.
   * Each item is passed to `super._exec` (which is `Node.prototype._exec`),
   * allowing individual item processing to benefit from retry logic.
   * All items are processed concurrently using `Promise.all`.
   * @param items - An array of items to be processed. Expected to be the `prepRes`.
   * @returns A promise that resolves to an array of results, one for each processed item,
   *          maintaining the original order. Returns an empty array if `items` is not a valid array.
   * @protected
   */
  async _exec(items: PrepRes[]): Promise<ExecRes[]> {
    // Ensure items is an array.
    if (!items || !Array.isArray(items)) {
      console.warn(
        "ParallelBatchNode received non-array input for batch processing. Returning empty array."
      );
      return [];
    }
    // Process all items in parallel.
    // `super._exec` here refers to `Node.prototype._exec`, applying retry logic per item.
    return Promise.all(items.map((item) => super._execItem(item)));
  }
}

/**
 * A special node that orchestrates a sequence of connected nodes (a "flow").
 * Extends {@link BaseNode}. The `exec` method of a `Flow` is not meant to be called directly;
 * it throws an error. Instead, the flow's logic is encapsulated in its `_orchestrate` method.
 *
 * @template S - The type of the shared data object passed through the flow.
 * @template P - The type of parameters for the Flow itself. These params can be passed to child nodes.
 */
class Flow<
  S extends IShared = IShared,
  P extends NonIterableObject = NonIterableObject,
  A extends Action = Action,
  PrepRes = unknown,
  ExecRes = unknown
> extends BaseNode<S, P, A, PrepRes, ExecRes> {
  /** The starting node of the flow. */
  start: BaseNode;

  /**
   * Constructs a `Flow` instance.
   * @param start - The initial {@link BaseNode} from which the flow will begin execution.
   */
  constructor(start: BaseNode) {
    super();
    this.start = start;
  }

  /**
   * Orchestrates the execution of nodes within the flow.
   * It starts from `this.start`, runs each node, and uses the returned {@link Action}
   * to determine the next node to execute. Nodes are cloned before execution to ensure
   * statelessness if the same flow is run multiple times or in parallel.
   * @param params - Optional parameters to be set on each node in the flow.
   *                 If provided, these merge with or override the Flow's own `_params`.
   * @returns A promise that resolves when the flow completes (i.e., no next node is found).
   * @protected
   */
  protected async _orchestrate(params?: P): Promise<void> {
    let current: BaseNode | undefined = this.start.clone(); // Start with a clone of the initial node.
    // Determine parameters to use: either explicitly passed `params` or the Flow's own `_params`.
    const p = params || this._params;

    while (current) {
      current.setParams(p); // Set parameters on the current node.
      current.setShared(this._shared); // Set shared data on the current node.
      const action = await current._run(); // Run the current node.
      current = current.getNextNode(action); // Get the next node based on the action.
      if (current) {
        current = current.clone(); // Clone the next node before running it.
      }
    }
  }

  /**
   * Internal run method for the Flow.
   * It executes the Flow's `prep` method, then orchestrates the sequence of nodes,
   * and finally executes the Flow's `post` method.
   * @returns A promise that resolves to the {@link Action} returned by the Flow's `post` method.
   * @protected
   */
  async _run(): Promise<A | undefined> {
    const pr = await this.prep(); // Run Flow's prep method.
    await this._orchestrate(); // Orchestrate the internal nodes.
    // Run Flow's post method. `execRes` is undefined as Flow doesn't have a conventional exec result.
    const a = await this.post(pr, undefined);
    return a;
  }

  /**
   * The `exec` method is not applicable to `Flow` nodes as their execution
   * is about orchestrating other nodes. Calling it will throw an error.
   * @param prepRes - Not used.
   * @throws Error indicating that `Flow` cannot `exec`.
   */
  async exec(prepRes: PrepRes): Promise<ExecRes> {
    throw new Error("Flow can't exec.");
  }
}

/**
 * A flow that executes its defined sequence of nodes multiple times,
 * once for each set of parameters generated by its `prep` method.
 * Executions for each parameter set occur sequentially.
 *
 * @template S - The type of the shared data object.
 * @template P - The type of the base parameters for the Flow itself.
 * @template NP - The type of an array of parameter objects, where each object is a {@link NonIterableObject}.
 *                These are generated by `prep` and used for each batch iteration.
 */
class BatchFlow<
  S extends IShared = IShared,
  P extends NonIterableObject = NonIterableObject,
  A extends Action = Action,
  PrepRes extends NonIterableObject[] = NonIterableObject[],
  ExecRes = unknown
> extends Flow<S, P, A, PrepRes, ExecRes> {
  /**
   * Internal run method for the BatchFlow.
   * It calls `prep` to get an array of parameter sets. For each set, it merges
   * these with the Flow's base parameters and then orchestrates the flow.
   * All orchestrations run sequentially.
   * @returns A promise that resolves to the {@link Action} returned by the BatchFlow's `post` method.
   * @protected
   */
  async _run(): Promise<A | undefined> {
    // `this.prep` is expected to return an array of parameter objects.
    const batchParams = await this.prep(); // `prep` is now typed to return NP

    // Iterate through each parameter set from `prep`.
    for (const bp of batchParams) {
      // Merge flow-level parameters with iteration-specific parameters.
      // Iteration-specific parameters (bp) take precedence.
      const mergedParams = { ...this._params, ...bp } as P; // Cast needed as bp is NonIterableObject
      await this._orchestrate(mergedParams); // Orchestrate the flow with merged params.
    }
    // Run BatchFlow's post method. `execRes` is undefined.
    const a = await this.post(batchParams, undefined);
    return a;
  }

  /**
   * Pre-processing step for `BatchFlow`.
   * This method is expected to return an array of parameter objects.
   * The flow will be orchestrated once for each object in this array.
   * @returns A promise that resolves to an array of parameter objects ({@link NP}).
   *          Defaults to an empty array.
   */
  async prep(): Promise<PrepRes> {
    // Default implementation returns an empty array.
    // Subclasses should override this to provide the actual batch parameters.
    const empty: readonly NonIterableObject[] = [];
    return empty as PrepRes;
  }
}

/**
 * A flow that executes its defined sequence of nodes multiple times,
 * once for each set of parameters generated by its `prep` method.
 * Executions for each parameter set occur in parallel.
 *
 * @template S - The type of the shared data object.
 * @template P - The type of the base parameters for the Flow itself.
 * @template NP - The type of an array of parameter objects, where each object is a {@link NonIterableObject}.
 *                These are generated by `prep` and used for each parallel iteration.
 */
class ParallelBatchFlow<
  S extends IShared = IShared,
  P extends NonIterableObject = NonIterableObject,
  A extends Action = Action,
  PrepRes extends NonIterableObject[] = NonIterableObject[],
  ExecRes = unknown
> extends BatchFlow<S, P, A, PrepRes, ExecRes> {
  /**
   * Internal run method for the ParallelBatchFlow.
   * It calls `prep` to get an array of parameter sets. For each set, it merges
   * these with the Flow's base parameters and then orchestrates the flow.
   * All orchestrations run in parallel using `Promise.all`.
   * @returns A promise that resolves to the {@link Action} returned by the ParallelBatchFlow's `post` method.
   * @protected
   */
  async _run(): Promise<A | undefined> {
    // `this.prep` is expected to return an array of parameter objects.
    const batchParams = await this.prep(); // `prep` is inherited from BatchFlow, returns NP

    // Map each parameter set to a promise representing its orchestration.
    await Promise.all(
      batchParams.map((bp) => {
        // Merge flow-level parameters with iteration-specific parameters.
        // Iteration-specific parameters (bp) take precedence.
        const mergedParams = { ...this._params, ...bp } as P; // Cast needed
        return this._orchestrate(mergedParams); // Orchestrate the flow with merged params.
      })
    );

    // Run ParallelBatchFlow's post method. `execRes` is undefined.
    const a = await this.post(batchParams, undefined);
    return a;
  }
}

// Export the classes for use in other modules.
export {
  Node,
  BatchNode,
  ParallelBatchNode,
  Flow,
  BatchFlow,
  ParallelBatchFlow,
};
