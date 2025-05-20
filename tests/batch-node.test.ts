// tests/batch-node.test.ts
import { Node, BatchNode, Flow, Shared, ParallelBatchNode } from "../src/index";

// Define shared storage type
type SharedStorage = Shared<{
  inputArray?: number[];
  chunkResults?: number[];
  total?: number;
  result?: string;
  parallelResults?: number[];
  completionOrder?: number[];
}>;

class AsyncArrayChunkNode extends BatchNode<
  SharedStorage,
  any,
  string,
  number[],
  number
> {
  private chunkSize: number;

  constructor(
    chunkSize: number = 10,
    maxRetries: number = 1,
    wait: number = 0
  ) {
    super(maxRetries, wait);
    this.chunkSize = chunkSize;
  }

  async prep(): Promise<number[][]> {
    // Get array from shared storage and split into chunks
    const array = this._shared.data.inputArray || [];
    const chunks: number[][] = [];

    for (let start = 0; start < array.length; start += this.chunkSize) {
      const end = Math.min(start + this.chunkSize, array.length);
      chunks.push(array.slice(start, end));
    }

    return chunks;
  }

  async execItem(chunk: number[]): Promise<number> {
    // Simulate async processing of each chunk
    await new Promise((resolve) => setTimeout(resolve, 10));
    return chunk.reduce((sum, value) => sum + value, 0);
  }

  async post(
    prepRes: number[][],
    execRes: number[]
  ): Promise<string | undefined> {
    // Store chunk results in shared storage
    this._shared.data.chunkResults = execRes;
    return "processed";
  }
}

class AsyncSumReduceNode extends Node<SharedStorage> {
  constructor(maxRetries: number = 1, wait: number = 0) {
    super(maxRetries, wait);
  }

  async prep(): Promise<number[]> {
    // Get chunk results from shared storage
    return this._shared.data.chunkResults || [];
  }

  async exec(chunkResults: number[]): Promise<number> {
    // Simulate async processing
    await new Promise((resolve) => setTimeout(resolve, 10));
    return chunkResults.reduce((sum, value) => sum + value, 0);
  }

  async post(prepRes: number[], execRes: number): Promise<string | undefined> {
    // Store the total in shared storage
    this._shared.data.total = execRes;
    return "reduced";
  }
}

// Create an error-throwing node for testing error handling
class ErrorBatchNode extends BatchNode<
  SharedStorage,
  any,
  string,
  number,
  number
> {
  constructor(maxRetries: number = 1, wait: number = 0) {
    super(maxRetries, wait);
  }

  async prep(): Promise<number[]> {
    return this._shared.data.inputArray || [];
  }

  async execItem(item: number): Promise<number> {
    if (item === 2) {
      throw new Error("Error processing item 2");
    }
    return item;
  }
}

describe("BatchNode Tests", () => {
  test("array chunking", async () => {
    // Test that the array is correctly split into chunks and processed asynchronously
    const shared: SharedStorage = new Shared({
      inputArray: Array.from({ length: 25 }, (_, i) => i), // [0,1,2,...,24]
    });

    const chunkNode = new AsyncArrayChunkNode(10);
    chunkNode.setShared(shared);
    await chunkNode.run();

    expect(shared.data.chunkResults).toEqual([45, 145, 110]); // Sum of chunks [0-9], [10-19], [20-24]
  });

  test("async map-reduce sum", async () => {
    // Test a complete async map-reduce pipeline that sums a large array
    const array = Array.from({ length: 100 }, (_, i) => i);
    const expectedSum = array.reduce((sum, val) => sum + val, 0); // 4950

    const shared: SharedStorage = new Shared({
      inputArray: array,
    });

    // Create nodes
    const chunkNode = new AsyncArrayChunkNode(10);
    const reduceNode = new AsyncSumReduceNode();

    // Connect nodes
    chunkNode.on("processed", reduceNode);

    // Create and run pipeline
    const pipeline = new Flow(chunkNode);
    pipeline.setShared(shared);
    await pipeline.run();

    expect(shared.data.total).toBe(expectedSum);
  });

  test("uneven chunks", async () => {
    // Test that the async map-reduce works correctly with array lengths
    // that don't divide evenly by chunkSize
    const array = Array.from({ length: 25 }, (_, i) => i);
    const expectedSum = array.reduce((sum, val) => sum + val, 0); // 300

    const shared: SharedStorage = new Shared({
      inputArray: array,
    });

    const chunkNode = new AsyncArrayChunkNode(10);
    const reduceNode = new AsyncSumReduceNode();

    chunkNode.on("processed", reduceNode);
    const pipeline = new Flow(chunkNode);
    pipeline.setShared(shared);
    await pipeline.run();

    expect(shared.data.total).toBe(expectedSum);
  });

  test("custom chunk size", async () => {
    // Test that the async map-reduce works with different chunk sizes
    const array = Array.from({ length: 100 }, (_, i) => i);
    const expectedSum = array.reduce((sum, val) => sum + val, 0);

    const shared: SharedStorage = new Shared({
      inputArray: array,
    });

    // Use chunkSize=15 instead of default 10
    const chunkNode = new AsyncArrayChunkNode(15);
    const reduceNode = new AsyncSumReduceNode();

    chunkNode.on("processed", reduceNode);
    const pipeline = new Flow(chunkNode);
    pipeline.setShared(shared);
    await pipeline.run();

    expect(shared.data.total).toBe(expectedSum);
  });

  test("single element chunks", async () => {
    // Test extreme case where chunkSize=1
    const array = Array.from({ length: 5 }, (_, i) => i);
    const expectedSum = array.reduce((sum, val) => sum + val, 0);

    const shared: SharedStorage = new Shared({
      inputArray: array,
    });

    const chunkNode = new AsyncArrayChunkNode(1);
    const reduceNode = new AsyncSumReduceNode();

    chunkNode.on("processed", reduceNode);
    const pipeline = new Flow(chunkNode);
    pipeline.setShared(shared);
    await pipeline.run();

    expect(shared.data.total).toBe(expectedSum);
  });

  test("empty array", async () => {
    // Test edge case of empty input array
    const shared: SharedStorage = new Shared({
      inputArray: [],
    });

    const chunkNode = new AsyncArrayChunkNode(10);
    const reduceNode = new AsyncSumReduceNode();

    chunkNode.on("processed", reduceNode);
    const pipeline = new Flow(chunkNode);
    pipeline.setShared(shared);
    await pipeline.run();

    expect(shared.data.total).toBe(0);
  });

  test("error handling", async () => {
    // Test error handling in async batch processing
    const shared: SharedStorage = new Shared({
      inputArray: [1, 2, 3],
    });

    const errorNode = new ErrorBatchNode();

    await expect(async () => {
      errorNode.setShared(shared);
      await errorNode.run();
    }).rejects.toThrow("Error processing item 2");
  });

  test("retry mechanism", async () => {
    // Test the retry mechanism with a node that fails intermittently
    let attempts = 0;

    class RetryTestNode extends BatchNode<
      SharedStorage,
      any,
      string,
      number,
      string
    > {
      constructor() {
        super(3, 0.01); // 3 retries with 10ms wait time
      }

      async prep(): Promise<number[]> {
        return [1];
      }

      async execItem(item: number): Promise<string> {
        attempts++;
        if (attempts < 3) {
          throw new Error(`Failure on attempt ${attempts}`);
        }
        return `Success on attempt ${attempts}`;
      }

      async post(
        prepRes: number[],
        execRes: string[]
      ): Promise<string | undefined> {
        this._shared.data.result = execRes[0];
        return undefined;
      }
    }

    const shared: SharedStorage = new Shared({});
    const retryNode = new RetryTestNode();

    retryNode.setShared(shared);
    await retryNode.run();

    expect(attempts).toBe(3);
    expect(shared.data.result).toBe("Success on attempt 3");
  });

  test("parallel batch processing", async () => {
    // Test that ParallelBatchNode processes items in parallel
    let completed: number[] = [];

    class ParallelProcessingNode extends ParallelBatchNode<
      SharedStorage,
      any,
      string,
      number,
      number
    > {
      constructor() {
        super(1, 0);
      }

      async prep(): Promise<number[]> {
        return [1, 2, 3, 4, 5];
      }

      async execItem(item: number): Promise<number> {
        // Items with higher values will complete first
        const delay = 100 - item * 20;
        await new Promise((resolve) => setTimeout(resolve, delay));
        completed.push(item);
        return item;
      }

      async post(
        prepRes: number[],
        execRes: number[]
      ): Promise<string | undefined> {
        this._shared.data.parallelResults = execRes;
        this._shared.data.completionOrder = [...completed];
        return undefined;
      }
    }

    const shared: SharedStorage = new Shared({});
    const parallelNode = new ParallelProcessingNode();

    parallelNode.setShared(shared);
    await parallelNode.run();

    // Check that results contain all processed items
    expect(shared.data.parallelResults?.sort()).toEqual([1, 2, 3, 4, 5]);

    // Check that items were not necessarily processed in order
    // Higher numbered items should complete before lower ones due to the delay logic
    expect(shared.data.completionOrder).not.toEqual([1, 2, 3, 4, 5]);
  });
});
