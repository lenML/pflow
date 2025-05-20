import { Shared } from "./Shared";
import { NonIterableObject, Action, IShared } from "./types";
import { deepClone, uuid } from "./utils";

/**
 * Base class for all nodes in the workflow.
 * It defines the fundamental lifecycle methods: `prep`, `exec`, and `post`.
 * Nodes can be connected to form a flow, where the `post` method of one node
 * determines the next node to execute based on an `Action`.
 *
 * @template S - The type of the shared data object passed between nodes in a flow.
 * @template P - The type of parameters specific to this node, must be a {@link NonIterableObject}.
 * @template A - The type of the action string indicating the next node.
 * @template PrepRes - The type of the result from the `prep` method.
 * @template ExecRes - The type of the result from the `exec` method.
 */
export class BaseNode<
  S extends IShared = IShared,
  P extends NonIterableObject = NonIterableObject,
  A extends Action = Action,
  PrepRes = unknown,
  ExecRes = unknown
> {
  public readonly id = uuid();

  /**
   * Parameters specific to this node instance.
   * These can be set using `setParams` and are often used by the `prep`, `exec`, or `post` methods.
   * @protected
   */
  protected _params: P = {} as P;

  /**
   * Shared data object passed between nodes in a flow.
   * This can be set using `setShared` and is often used by the `prep`, `exec`, or `post` methods.
   * @protected
   */
  protected _shared: S = new Shared({}) as unknown as S;

  /**
   * A map of actions to successor nodes.
   * This defines the possible transitions from this node to others in a flow.
   * @protected
   */
  protected _successors: Map<A, BaseNode> = new Map();

  /**
   * Internal execution wrapper. This method calls the public `exec` method.
   * Subclasses like `Node` override this to add features like retries.
   * @param prepRes - The result from the `prep` method.
   * @returns A promise that resolves to the execution result.
   * @protected
   */
  protected async _exec(
    prepRes: PrepRes | undefined
  ): Promise<ExecRes | undefined> {
    // Calls the main execution logic.
    return await this.exec(prepRes);
  }

  /**
   * Pre-processing step. Called before `exec`.
   * This method can be used to prepare data, fetch resources, or set up the node
   * based on the shared data object.
   * @returns A promise that resolves to data needed by the `exec` method.
   *          By default, returns `undefined`.
   */
  async prep(): Promise<PrepRes | undefined> {
    // Default implementation, can be overridden by subclasses.
    return undefined;
  }

  /**
   * Main execution logic of the node.
   * This is where the core task of the node is performed.
   * @param prepRes - The result from the `prep` method.
   * @returns A promise that resolves to the result of the node's execution.
   *          By default, returns `undefined`.
   */
  async exec(prepRes: PrepRes | undefined): Promise<ExecRes | undefined> {
    // Default implementation, can be overridden by subclasses.
    return undefined;
  }

  /**
   * Post-processing step. Called after `exec`.
   * This method can be used to clean up resources, process the execution result,
   * and determine the next action to take in a flow.
   * @param prepRes - The result from the `prep` method.
   * @param execRes - The result from the `exec` (or `_exec`) method.
   * @returns A promise that resolves to an {@link Action} string indicating the next node,
   *          or `undefined` if the flow should end or follow a default path.
   *          By default, returns `undefined`.
   */
  async post(
    prepRes: PrepRes | undefined,
    execRes: ExecRes | undefined
  ): Promise<A | undefined> {
    // Default implementation, can be overridden by subclasses.
    return undefined;
  }

  /**
   * Internal run method that orchestrates the `prep`, `_exec`, and `post` lifecycle.
   * This is the core execution sequence for a single node.
   * @returns A promise that resolves to the {@link Action} returned by the `post` method.
   * @protected
   */
  async _run(): Promise<A | undefined> {
    // Execute prep, then exec, then post.
    const p = await this.prep();
    const e = await this._exec(p);
    const a = await this.post(p, e);
    return a;
  }

  /**
   * Public run method for executing a single node.
   * If the node has successors defined, a warning is issued because this method
   * does not handle transitioning to successor nodes. Use `Flow` for that.
   * @returns A promise that resolves to the {@link Action} returned by the `post` method.
   */
  async run(): Promise<A | undefined> {
    if (this._successors.size > 0) {
      // Warn if successors are defined but not used by this run method.
      this._shared.logger.warn("Node won't run successors. Use Flow.");
    }
    return await this._run();
  }

  /**
   * Sets the parameters for this node.
   * @param params - The parameters to set.
   * @returns The current node instance, allowing for method chaining.
   */
  setParams(params: P): this {
    this._params = params;
    return this;
  }

  /**
   * Sets the shared data object for this node.
   * @param shared - The shared data object to set.
   * @returns The current node instance, allowing for method chaining.
   */
  setShared(shared: S): this {
    this._shared = shared;
    return this;
  }

  /**
   * Defines the default next node in a sequence.
   * This is a shorthand for `on("default", node)`.
   * @template T - The type of the next node, extending {@link BaseNode}.
   * @param node - The next node to execute.
   * @returns The provided next node, allowing for chaining of `next` or `on` calls.
   */
  next<T extends BaseNode>(node: T): T {
    this.on("default" as A, node);
    return node;
  }

  /**
   * Defines a successor node for a specific action.
   * If a successor for the given action already exists, a warning is issued.
   * @param action - The {@link Action} string that triggers transition to the specified node.
   * @param node - The successor node.
   * @returns The current node instance, allowing for method chaining.
   */
  on(action: A, node: BaseNode): this {
    if (this._successors.has(action)) {
      // Warn if overwriting an existing successor.
      this._shared.logger.warn(`Overwriting successor for action '${action}'`);
    }
    this._successors.set(action, node);
    return this;
  }

  /**
   * Retrieves the next node based on a given action.
   * If no action is provided, it defaults to "default".
   * If the action is not found and successors exist, a warning is issued.
   * @param action - The {@link Action} determining which successor to retrieve. Defaults to "default".
   * @returns The successor {@link BaseNode} or `undefined` if not found.
   */
  getNextNode(action: A = "default" as A): BaseNode | undefined {
    const nextAction: A = action || ("default" as A); // Ensure 'default' if action is empty or undefined.
    const next = this._successors.get(nextAction);
    if (!next && this._successors.size > 0) {
      // Warn if the specified action does not lead to a node, but other actions do.
      this._shared.logger.warn(
        `Flow ends: '${nextAction}' not found in [${Array.from(
          this._successors.keys()
        )}]`
      );
    }
    return next;
  }

  /**
   * Creates a shallow clone of the node.
   * The `_params` object is shallow-copied (spread operator), and the `_successors` map is
   * new Map instance with the same entries. The successor nodes themselves are not cloned.
   * This is important for `Flow` execution, where each step uses a clone of the node template.
   * @returns A new instance of the node with copied properties.
   */
  clone(): this {
    // Create a new object with the same prototype.
    const clonedNode = Object.create(Object.getPrototypeOf(this));
    // Assign all properties from the current instance to the new one.
    Object.assign(clonedNode, this);
    // Deep copy params to avoid shared state issues between cloned nodes in a flow.
    clonedNode._params = { ...this._params };
    clonedNode._shared = this._shared;
    clonedNode.id = uuid();
    // Create a new Map for successors, but references to successor nodes are shared.
    clonedNode._successors = new Map(this._successors);
    return clonedNode;
  }
}
