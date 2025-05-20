// tests/parallel-batch-flow.test.ts
import {
  Node,
  ParallelBatchNode,
  Flow,
  ParallelBatchFlow,
  Shared,
} from "../src/index";

// Define shared storage type
type SharedStorage = Shared<{
  batches?: number[][];
  processedNumbers?: Record<number, number[]>;
  total?: number;
}>;

class AsyncParallelNumberProcessor extends ParallelBatchNode<
  SharedStorage,
  { batchId: number },
  string,
  number,
  number
> {
  private delay: number;

  constructor(delay: number = 0.1, maxRetries: number = 1, wait: number = 0) {
    super(maxRetries, wait);
    this.delay = delay;
  }

  async prep(): Promise<number[]> {
    const batchId = this._params.batchId;
    return this._shared.data.batches?.[batchId] || [];
  }

  async execItem(number: number): Promise<number> {
    // Simulate async processing
    await new Promise((resolve) => setTimeout(resolve, this.delay * 1000));
    return number * 2;
  }

  async post(
    prepRes: number[],
    execRes: number[]
  ): Promise<string | undefined> {
    if (!this._shared.data.processedNumbers) {
      this._shared.data.processedNumbers = {};
    }
    this._shared.data.processedNumbers[this._params.batchId] = execRes;
    return "processed";
  }
}

class AsyncAggregatorNode extends Node<SharedStorage> {
  constructor(maxRetries: number = 1, wait: number = 0) {
    super(maxRetries, wait);
  }

  async prep(): Promise<number[]> {
    // Combine all batch results in order
    const allResults: number[] = [];
    const processed = this._shared.data.processedNumbers || {};

    for (let i = 0; i < Object.keys(processed).length; i++) {
      allResults.push(...processed[i]);
    }

    return allResults;
  }

  async exec(prepResult: number[]): Promise<number> {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return prepResult.reduce((sum, val) => sum + val, 0);
  }

  async post(prepRes: number[], execRes: number): Promise<string | undefined> {
    this._shared.data.total = execRes;
    return "aggregated";
  }
}

// Custom ParallelBatchFlow that processes batches based on batchId
class TestParallelBatchFlow extends ParallelBatchFlow<SharedStorage> {
  async prep(): Promise<Record<string, any>[]> {
    return (this._shared.data.batches || []).map((_, i) => ({ batchId: i }));
  }
}

describe("ParallelBatchFlow Tests", () => {
  test("parallel batch flow", async () => {
    /**
     * Test basic parallel batch processing flow with batch IDs
     */
    const shared: SharedStorage = new Shared({
      batches: [
        [1, 2, 3], // batchId: 0
        [4, 5, 6], // batchId: 1
        [7, 8, 9], // batchId: 2
      ],
    });

    const processor = new AsyncParallelNumberProcessor(0.1);
    const aggregator = new AsyncAggregatorNode();

    processor.on("processed", aggregator);
    const flow = new TestParallelBatchFlow(processor);

    const startTime = Date.now();
    flow.setShared(shared);
    await flow.run();
    const executionTime = (Date.now() - startTime) / 1000;

    // Verify each batch was processed correctly
    const expectedBatchResults = {
      0: [2, 4, 6], // [1,2,3] * 2
      1: [8, 10, 12], // [4,5,6] * 2
      2: [14, 16, 18], // [7,8,9] * 2
    };

    expect(shared.data.processedNumbers).toEqual(expectedBatchResults);

    // Verify total
    const expectedTotal = shared.data
      .batches!.flat()
      .reduce((sum, num) => sum + num * 2, 0);
    expect(shared.data.total).toBe(expectedTotal);

    // Verify parallel execution
    expect(executionTime).toBeLessThan(0.2);
  });

  test("error handling", async () => {
    /**
     * Test error handling in parallel batch flow
     */
    class ErrorProcessor extends AsyncParallelNumberProcessor {
      async execItem(item: number): Promise<number> {
        if (item === 2) {
          throw new Error(`Error processing item ${item}`);
        }
        return item;
      }
    }

    const shared: SharedStorage = new Shared({
      batches: [
        [1, 2, 3], // Contains error-triggering value
        [4, 5, 6],
      ],
    });

    const processor = new ErrorProcessor();
    const flow = new TestParallelBatchFlow(processor);

    await expect(async () => {
      flow.setShared(shared);
      await flow.run();
    }).rejects.toThrow("Error processing item 2");
  });

  test("multiple batch sizes", async () => {
    /**
     * Test parallel batch flow with varying batch sizes
     */
    const shared: SharedStorage = new Shared({
      batches: [
        [1], // batchId: 0
        [2, 3, 4], // batchId: 1
        [5, 6], // batchId: 2
        [7, 8, 9, 10], // batchId: 3
      ],
    });

    const processor = new AsyncParallelNumberProcessor(0.05);
    const aggregator = new AsyncAggregatorNode();

    processor.on("processed", aggregator);
    const flow = new TestParallelBatchFlow(processor);

    flow.setShared(shared);
    await flow.run();

    // Verify each batch was processed correctly
    const expectedBatchResults = {
      0: [2], // [1] * 2
      1: [4, 6, 8], // [2,3,4] * 2
      2: [10, 12], // [5,6] * 2
      3: [14, 16, 18, 20], // [7,8,9,10] * 2
    };

    expect(shared.data.processedNumbers).toEqual(expectedBatchResults);

    // Verify total
    const expectedTotal = shared.data
      .batches!.flat()
      .reduce((sum, num) => sum + num * 2, 0);
    expect(shared.data.total).toBe(expectedTotal);
  });
});
