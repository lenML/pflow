// tests/async-batch-flow.test.ts
import { Node, BatchFlow, Shared } from "../src/index";

// Define shared storage type
type SharedStorage = Shared<{
  inputData?: Record<string, number>;
  results?: Record<string, number>;
  intermediateResults?: Record<string, number>;
}>;

// Parameters type
type BatchParams = {
  key: string;
  multiplier?: number;
};

class AsyncDataProcessNode extends Node<SharedStorage, BatchParams> {
  constructor(maxRetries: number = 1, wait: number = 0) {
    super(maxRetries, wait);
  }

  async prep(): Promise<number> {
    const key = this._params.key;
    const data = this._shared.data.inputData?.[key] ?? 0;

    if (!this._shared.data.results) {
      this._shared.data.results = {};
    }

    this._shared.data.results[key] = data;
    return data;
  }

  async exec(prepRes: number): Promise<number> {
    return prepRes; // Just return the prep result as-is
  }

  async post(prepRes: number, execRes: number): Promise<string | undefined> {
    await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate async work
    const key = this._params.key;

    if (!this._shared.data.results) {
      this._shared.data.results = {};
    }

    this._shared.data.results[key] = execRes * 2; // Double the value
    return "processed";
  }
}

class AsyncErrorNode extends Node<SharedStorage, BatchParams> {
  constructor(maxRetries: number = 1, wait: number = 0) {
    super(maxRetries, wait);
  }

  async prep(): Promise<any> {
    return undefined;
  }

  async exec(prepRes: any): Promise<any> {
    return undefined;
  }

  async post(prepRes: any, execRes: any): Promise<string | undefined> {
    const key = this._params.key;
    if (key === "errorKey") {
      throw new Error(`Async error processing key: ${key}`);
    }
    return "processed";
  }
}

describe("BatchFlow Tests", () => {
  let processNode: AsyncDataProcessNode;

  beforeEach(() => {
    processNode = new AsyncDataProcessNode();
  });

  test("basic async batch processing", async () => {
    class SimpleTestBatchFlow extends BatchFlow<SharedStorage> {
      async prep(): Promise<BatchParams[]> {
        return Object.keys(this._shared.data.inputData || {}).map((k) => ({
          key: k,
        }));
      }
    }

    const shared: SharedStorage = new Shared({
      inputData: {
        a: 1,
        b: 2,
        c: 3,
      },
    });

    const flow = new SimpleTestBatchFlow(processNode);
    flow.setShared(shared);
    await flow.run();

    expect(shared.data.results).toEqual({
      a: 2, // 1 * 2
      b: 4, // 2 * 2
      c: 6, // 3 * 2
    });
  });

  test("empty async batch", async () => {
    class EmptyTestBatchFlow extends BatchFlow<SharedStorage> {
      async prep(): Promise<BatchParams[]> {
        // Initialize results as an empty object
        if (!shared.data.results) {
          shared.data.results = {};
        }
        return Object.keys(shared.data.inputData || {}).map((k) => ({
          key: k,
        }));
      }

      // Ensure post is called even if batch is empty
      async post(
        prepRes: BatchParams[],
        execRes: any
      ): Promise<string | undefined> {
        if (!shared.data.results) {
          shared.data.results = {};
        }
        return undefined;
      }
    }

    const shared: SharedStorage = new Shared({
      inputData: {},
    });

    const flow = new EmptyTestBatchFlow(processNode);
    flow.setShared(shared);
    await flow.run();

    expect(shared.data.results).toEqual({});
  });

  test("async error handling", async () => {
    class ErrorTestBatchFlow extends BatchFlow<SharedStorage> {
      async prep(): Promise<BatchParams[]> {
        return Object.keys(shared.data.inputData || {}).map((k) => ({
          key: k,
        }));
      }
    }

    const shared: SharedStorage = new Shared({
      inputData: {
        normalKey: 1,
        errorKey: 2,
        anotherKey: 3,
      },
    });

    const flow = new ErrorTestBatchFlow(new AsyncErrorNode());

    await expect(async () => {
      flow.setShared(shared);
      await flow.run();
    }).rejects.toThrow("Async error processing key: errorKey");
  });

  test("nested async flow", async () => {
    class AsyncInnerNode extends Node<SharedStorage, BatchParams> {
      async prep(): Promise<any> {
        return undefined;
      }

      async exec(prepRes: any): Promise<any> {
        return undefined;
      }

      async post(prepRes: any, execRes: any): Promise<string | undefined> {
        const key = this._params.key;

        if (!this._shared.data.intermediateResults) {
          this._shared.data.intermediateResults = {};
        }

        // Safely access inputData
        const inputValue = this._shared.data.inputData?.[key] ?? 0;
        this._shared.data.intermediateResults[key] = inputValue + 1;

        await new Promise((resolve) => setTimeout(resolve, 10));
        return "next";
      }
    }

    class AsyncOuterNode extends Node<SharedStorage, BatchParams> {
      async prep(): Promise<any> {
        return undefined;
      }

      async exec(prepRes: any): Promise<any> {
        return undefined;
      }

      async post(prepRes: any, execRes: any): Promise<string | undefined> {
        const key = this._params.key;

        if (!this._shared.data.results) {
          this._shared.data.results = {};
        }

        if (!this._shared.data.intermediateResults) {
          this._shared.data.intermediateResults = {};
        }

        this._shared.data.results[key] =
          this._shared.data.intermediateResults[key] * 2;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "done";
      }
    }

    class NestedBatchFlow extends BatchFlow<SharedStorage> {
      async prep(): Promise<BatchParams[]> {
        return Object.keys(this._shared.data.inputData || {}).map((k) => ({
          key: k,
        }));
      }
    }

    // Create inner flow
    const innerNode = new AsyncInnerNode();
    const outerNode = new AsyncOuterNode();
    innerNode.on("next", outerNode);

    const shared: SharedStorage = new Shared({
      inputData: {
        x: 1,
        y: 2,
      },
    });

    const flow = new NestedBatchFlow(innerNode);
    flow.setShared(shared);
    await flow.run();

    expect(shared.data.results).toEqual({
      x: 4, // (1 + 1) * 2
      y: 6, // (2 + 1) * 2
    });
  });

  test("custom async parameters", async () => {
    class CustomParamNode extends Node<SharedStorage, BatchParams> {
      async prep(): Promise<any> {
        return undefined;
      }

      async exec(prepRes: any): Promise<any> {
        return undefined;
      }

      async post(prepRes: any, execRes: any): Promise<string | undefined> {
        const key = this._params.key;
        const multiplier = this._params.multiplier || 1;

        await new Promise((resolve) => setTimeout(resolve, 10));

        if (!this._shared.data.results) {
          this._shared.data.results = {};
        }

        // Safely access inputData with default value
        const inputValue = this._shared.data.inputData?.[key] ?? 0;
        this._shared.data.results[key] = inputValue * multiplier;

        return "done";
      }
    }

    class CustomParamBatchFlow extends BatchFlow<SharedStorage> {
      async prep(): Promise<BatchParams[]> {
        return Object.keys(this._shared.data.inputData || {}).map((k, i) => ({
          key: k,
          multiplier: i + 1,
        }));
      }
    }

    const shared: SharedStorage = new Shared({
      inputData: {
        a: 1,
        b: 2,
        c: 3,
      },
    });

    const flow = new CustomParamBatchFlow(new CustomParamNode());
    flow.setShared(shared);
    await flow.run();

    expect(shared.data.results).toEqual({
      a: 1 * 1, // first item, multiplier = 1
      b: 2 * 2, // second item, multiplier = 2
      c: 3 * 3, // third item, multiplier = 3
    });
  });
});
