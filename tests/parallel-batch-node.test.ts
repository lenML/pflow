// tests/parallel-batch-node.test.ts
import { ParallelBatchNode, Flow, Shared } from "../src/index";

// Define shared storage type
type SharedStorage = Shared<{
  inputNumbers?: number[];
  processedNumbers?: number[];
  executionOrder?: number[];
  finalResults?: number[];
}>;

class AsyncParallelNumberProcessor extends ParallelBatchNode<
  SharedStorage,
  any,
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
    return this._shared.data.inputNumbers || [];
  }

  async execItem(number: number): Promise<number> {
    await new Promise((resolve) => setTimeout(resolve, this.delay * 1000));
    return number * 2;
  }

  async post(
    prepRes: number[],
    execRes: number[]
  ): Promise<string | undefined> {
    this._shared.data.processedNumbers = execRes;
    return "processed";
  }
}

class ErrorProcessor extends ParallelBatchNode<
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
    return this._shared.data.inputNumbers || [];
  }

  async execItem(item: number): Promise<number> {
    if (item === 2) {
      throw new Error(`Error processing item ${item}`);
    }
    return item;
  }
}

class OrderTrackingProcessor extends ParallelBatchNode<
  SharedStorage,
  any,
  string,
  number,
  number
> {
  private executionOrder: number[] = [];

  constructor(maxRetries: number = 1, wait: number = 0) {
    super(maxRetries, wait);
  }

  async prep(): Promise<number[]> {
    this.executionOrder = [];
    this._shared.data.executionOrder = this.executionOrder;
    return this._shared.data.inputNumbers || [];
  }

  async execItem(item: number): Promise<number> {
    const delay = item % 2 === 0 ? 0.1 : 0.05;
    await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    this.executionOrder.push(item);
    return item;
  }

  async post(
    prepRes: number[],
    execRes: number[]
  ): Promise<string | undefined> {
    this._shared.data.executionOrder = this.executionOrder;
    return undefined;
  }
}

describe("AsyncParallelBatchNode Tests", () => {
  test("parallel processing", async () => {
    // Test that numbers are processed in parallel by measuring execution time
    const shared: SharedStorage = new Shared({
      inputNumbers: Array.from({ length: 5 }, (_, i) => i),
    });

    const processor = new AsyncParallelNumberProcessor(0.1);

    // Record start time
    const startTime = Date.now();
    processor.setShared(shared);
    await processor.run();
    const endTime = Date.now();

    // Check results
    const expected = [0, 2, 4, 6, 8]; // Each number doubled
    expect(shared.data.processedNumbers).toEqual(expected);

    // Since processing is parallel, total time should be approximately
    // equal to the delay of a single operation, not delay * number_of_items
    const executionTime = endTime - startTime;
    expect(executionTime).toBeLessThan(200); // Should be around 100ms plus minimal overhead
  });

  test("empty input", async () => {
    // Test processing of empty input
    const shared: SharedStorage = new Shared({
      inputNumbers: [],
    });

    const processor = new AsyncParallelNumberProcessor();
    processor.setShared(shared);
    await processor.run();

    expect(shared.data.processedNumbers).toEqual([]);
  });

  test("single item", async () => {
    // Test processing of a single item
    const shared: SharedStorage = new Shared({
      inputNumbers: [42],
    });

    const processor = new AsyncParallelNumberProcessor();
    processor.setShared(shared);
    await processor.run();

    expect(shared.data.processedNumbers).toEqual([84]);
  });

  test("large batch", async () => {
    // Test processing of a large batch of numbers
    const inputSize = 100;
    const shared: SharedStorage = new Shared({
      inputNumbers: Array.from({ length: inputSize }, (_, i) => i),
    });

    const processor = new AsyncParallelNumberProcessor(0.01);
    processor.setShared(shared);
    await processor.run();

    const expected = Array.from({ length: inputSize }, (_, i) => i * 2);
    expect(shared.data.processedNumbers).toEqual(expected);
  });

  test("error handling", async () => {
    // Test error handling during parallel processing
    const shared: SharedStorage = new Shared({
      inputNumbers: [1, 2, 3],
    });

    const processor = new ErrorProcessor();

    await expect(async () => {
      processor.setShared(shared);
      await processor.run();
    }).rejects.toThrow("Error processing item 2");
  });

  test("concurrent execution", async () => {
    // Test that tasks are actually running concurrently by tracking execution order
    const shared: SharedStorage = new Shared({
      inputNumbers: Array.from({ length: 4 }, (_, i) => i), // [0, 1, 2, 3]
    });

    const processor = new OrderTrackingProcessor();
    processor.setShared(shared);
    await processor.run();

    // Odd numbers should finish before even numbers due to shorter delay
    expect(shared.data.executionOrder?.indexOf(1)).toBeLessThan(
      shared.data.executionOrder?.indexOf(0) as number
    );
    expect(shared.data.executionOrder?.indexOf(3)).toBeLessThan(
      shared.data.executionOrder?.indexOf(2) as number
    );
  });

  test("integration with Flow", async () => {
    // Test integration with Flow
    const shared: SharedStorage = new Shared({
      inputNumbers: Array.from({ length: 5 }, (_, i) => i),
    });

    class ProcessResultsNode extends ParallelBatchNode<
      SharedStorage,
      any,
      string,
      number,
      number
    > {
      async prep(): Promise<number[]> {
        return this._shared.data.processedNumbers || [];
      }

      async execItem(num: number): Promise<number> {
        return num + 1;
      }

      async post(
        prepRes: number[],
        execRes: number[]
      ): Promise<string | undefined> {
        this._shared.data.finalResults = execRes;
        return "completed";
      }
    }

    const processor = new AsyncParallelNumberProcessor();
    const resultsProcessor = new ProcessResultsNode();

    processor.on("processed", resultsProcessor);

    const pipeline = new Flow(processor);
    pipeline.setShared(shared);
    await pipeline.run();

    // Each number should be doubled and then incremented
    const expected = [1, 3, 5, 7, 9];
    expect(shared.data.finalResults).toEqual(expected);
  });
});
