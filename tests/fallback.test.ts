// tests/fallback.test.ts
import { Node, Flow, Shared } from "../src/index";

// Define a shared storage type
type SharedStorage = Shared<{
  results?: Array<{
    attempts: number;
    result: string;
  }>;
  finalResult?: any;
}>;

class FallbackNode extends Node<SharedStorage> {
  private shouldFail: boolean;
  private attemptCount: number = 0;

  constructor(
    shouldFail: boolean = true,
    maxRetries: number = 1,
    wait: number = 0
  ) {
    super(maxRetries, wait);
    this.shouldFail = shouldFail;
  }

  async prep(): Promise<null> {
    if (!this._shared.data.results) {
      this._shared.data.results = [];
    }
    return null;
  }

  async exec(prepResult: null): Promise<string> {
    this.attemptCount++;
    if (this.shouldFail) {
      throw new Error("Intentional failure");
    }
    return "success";
  }

  async execFallback(prepResult: null, error: Error): Promise<string> {
    return "fallback";
  }

  async post(
    prepResult: null,
    execResult: string
  ): Promise<string | undefined> {
    this._shared.data.results?.push({
      attempts: this.attemptCount,
      result: execResult,
    });
    return undefined;
  }
}

class AsyncFallbackNode extends Node<SharedStorage> {
  private shouldFail: boolean;
  private attemptCount: number = 0;

  constructor(
    shouldFail: boolean = true,
    maxRetries: number = 1,
    wait: number = 0
  ) {
    super(maxRetries, wait);
    this.shouldFail = shouldFail;
  }

  async prep(): Promise<null> {
    if (!this._shared.data.results) {
      this._shared.data.results = [];
    }
    return null;
  }

  async exec(prepResult: null): Promise<string> {
    this.attemptCount++;
    if (this.shouldFail) {
      throw new Error("Intentional async failure");
    }
    return "success";
  }

  async execFallback(prepResult: null, error: Error): Promise<string> {
    // Simulate async work
    await new Promise((resolve) => setTimeout(resolve, 10));
    return "async_fallback";
  }

  async post(
    prepResult: null,
    execResult: string
  ): Promise<string | undefined> {
    this._shared.data.results?.push({
      attempts: this.attemptCount,
      result: execResult,
    });
    return undefined;
  }
}

// Changed to extend Node instead of BaseNode
class ResultNode extends Node<SharedStorage> {
  constructor(maxRetries: number = 1, wait: number = 0) {
    super(maxRetries, wait);
  }

  async prep(): Promise<any> {
    return this._shared.data.results || [];
  }

  async exec(prepResult: any): Promise<any> {
    return prepResult;
  }

  async post(prepResult: any, execResult: any): Promise<string | undefined> {
    this._shared.data.finalResult = execResult;
    return undefined;
  }
}

// Changed to extend Node instead of BaseNode
class NoFallbackNode extends Node<SharedStorage> {
  constructor(maxRetries: number = 1, wait: number = 0) {
    super(maxRetries, wait);
  }

  async prep(): Promise<null> {
    if (!this._shared.data.results) {
      this._shared.data.results = [];
    }
    return null;
  }

  async exec(prepResult: null): Promise<string> {
    throw new Error("Test error");
  }

  async post(
    prepResult: null,
    execResult: string
  ): Promise<string | undefined> {
    this._shared.data.results?.push({ attempts: 1, result: execResult });
    return execResult;
  }
}

// New class to demonstrate retry with eventual success
class EventualSuccessNode extends Node<SharedStorage> {
  private succeedAfterAttempts: number;
  private attemptCount: number = 0;

  constructor(
    succeedAfterAttempts: number = 2,
    maxRetries: number = 3,
    wait: number = 0.01
  ) {
    super(maxRetries, wait);
    this.succeedAfterAttempts = succeedAfterAttempts;
  }

  async prep(): Promise<null> {
    if (!this._shared.data.results) {
      this._shared.data.results = [];
    }
    return null;
  }

  async exec(prepResult: null): Promise<string> {
    this.attemptCount++;
    if (this.attemptCount < this.succeedAfterAttempts) {
      throw new Error(`Fail on attempt ${this.attemptCount}`);
    }
    return `success_after_${this.attemptCount}_attempts`;
  }

  async post(
    prepResult: null,
    execResult: string
  ): Promise<string | undefined> {
    this._shared.data.results?.push({
      attempts: this.attemptCount,
      result: execResult,
    });
    return undefined;
  }
}

// New class to demonstrate customized error handling
class CustomErrorHandlerNode extends Node<SharedStorage> {
  private errorType: string;

  constructor(
    errorType: string = "standard",
    maxRetries: number = 1,
    wait: number = 0
  ) {
    super(maxRetries, wait);
    this.errorType = errorType;
  }

  async prep(): Promise<null> {
    if (!this._shared.data.results) {
      this._shared.data.results = [];
    }
    return null;
  }

  async exec(prepResult: null): Promise<string> {
    throw new Error(this.errorType);
  }

  async execFallback(prepResult: null, error: Error): Promise<string> {
    // Custom error handling based on error type
    if (error.message === "network") {
      return "network_error_handled";
    } else if (error.message === "timeout") {
      return "timeout_error_handled";
    } else {
      return "generic_error_handled";
    }
  }

  async post(
    prepResult: null,
    execResult: string
  ): Promise<string | undefined> {
    this._shared.data.results?.push({
      attempts: 1,
      result: execResult,
    });
    return undefined;
  }
}

describe("Fallback Functionality Tests with Node", () => {
  test("successful execution", async () => {
    // Test that execFallback is not called when execution succeeds
    const shared: SharedStorage = new Shared({});
    const node = new FallbackNode(false);
    node.setShared(shared);
    await node.run();

    expect(shared.data.results?.length).toBe(1);
    expect(shared.data.results?.[0].attempts).toBe(1);
    expect(shared.data.results?.[0].result).toBe("success");
  });

  test("fallback after failure", async () => {
    // Test that execFallback is called after all retries are exhausted
    const shared: SharedStorage = new Shared({});
    const node = new AsyncFallbackNode(true, 2);
    node.setShared(shared);
    await node.run();

    expect(shared.data.results?.length).toBe(1);
    expect(shared.data.results?.[0].attempts).toBe(2);
    expect(shared.data.results?.[0].result).toBe("async_fallback");
  });

  test("fallback in flow", async () => {
    // Test that fallback works within a Flow
    const shared: SharedStorage = new Shared({});
    const fallbackNode = new FallbackNode(true, 1);
    const resultNode = new ResultNode();

    fallbackNode.next(resultNode);

    const flow = new Flow(fallbackNode);
    flow.setShared(shared);
    await flow.run();

    expect(shared.data.results?.length).toBe(1);
    expect(shared.data.results?.[0].result).toBe("fallback");
    expect(shared.data.finalResult).toEqual([
      { attempts: 1, result: "fallback" },
    ]);
  });

  test("no fallback implementation", async () => {
    // Test that without overriding execFallback, Node will rethrow the error
    const shared: SharedStorage = new Shared({});
    const node = new NoFallbackNode();

    await expect(async () => {
      node.setShared(shared);
      await node.run();
    }).rejects.toThrow("Test error");
  });

  test("retry before fallback", async () => {
    // Test that retries are attempted before calling fallback
    const shared: SharedStorage = new Shared({});
    const node = new AsyncFallbackNode(true, 3);
    node.setShared(shared);
    await node.run();

    expect(shared.data.results?.length).toBe(1);
    expect(shared.data.results?.[0].attempts).toBe(3);
    expect(shared.data.results?.[0].result).toBe("async_fallback");
  });

  test("eventual success after retries", async () => {
    // Test node that succeeds after multiple attempts
    const shared: SharedStorage = new Shared({});
    const node = new EventualSuccessNode(2, 3);
    node.setShared(shared);
    await node.run();

    expect(shared.data.results?.length).toBe(1);
    expect(shared.data.results?.[0].attempts).toBe(2);
    expect(shared.data.results?.[0].result).toBe("success_after_2_attempts");
  });

  test("custom error handling based on error type", async () => {
    // Test custom fallback logic based on error type
    const shared1: SharedStorage = new Shared({});
    const node1 = new CustomErrorHandlerNode("network");
    node1.setShared(shared1);
    await node1.run();
    expect(shared1.data.results?.[0].result).toBe("network_error_handled");

    const shared2: SharedStorage = new Shared({});
    const node2 = new CustomErrorHandlerNode("timeout");
    node2.setShared(shared2);
    await node2.run();
    expect(shared2.data.results?.[0].result).toBe("timeout_error_handled");

    const shared3: SharedStorage = new Shared({});
    const node3 = new CustomErrorHandlerNode("other");
    node3.setShared(shared3);
    await node3.run();
    expect(shared3.data.results?.[0].result).toBe("generic_error_handled");
  });

  test("flow with mixed retry patterns", async () => {
    // Test complex flow with different retry patterns
    const shared: SharedStorage = new Shared({});

    const node1 = new FallbackNode(true, 1);
    const node2 = new AsyncFallbackNode(false, 2);
    const node3 = new EventualSuccessNode(2, 3);
    const resultNode = new ResultNode();

    node1.next(node2);
    node2.next(node3);
    node3.next(resultNode);

    const flow = new Flow(node1);
    flow.setShared(shared);
    await flow.run();

    expect(shared.data.results?.length).toBe(3);
    expect(shared.data.results?.[0].result).toBe("fallback");
    expect(shared.data.results?.[1].result).toBe("success");
    expect(shared.data.results?.[2].result).toBe("success_after_2_attempts");
  });
});
