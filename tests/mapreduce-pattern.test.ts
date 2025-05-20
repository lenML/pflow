// tests/mapreduce-pattern.test.ts
import { BatchNode, Node, Flow, ParallelBatchNode, Shared } from "../src/index";

// Mock utility function to simulate LLM calls
async function callLLM(prompt: string): Promise<string> {
  // In a real implementation, this would call an actual LLM
  return `Summary for: ${prompt.slice(0, 20)}...`;
}

// Define shared storage type for MapReduce pattern
type MapReduceSharedStorage = Shared<{
  files?: Record<string, string>;
  file_summaries?: Record<string, string>;
  all_files_summary?: string;
  text_to_process?: string;
  text_chunks?: string[];
  processed_chunks?: string[];
  final_result?: string;
}>;

// Document Summarization Example (Sequential)
class SummarizeAllFiles extends BatchNode<
  MapReduceSharedStorage,
  any,
  string,
  [string, string],
  [string, string]
> {
  async prep(): Promise<[string, string][]> {
    const files = this._shared.data.files || {};
    return Object.entries(files);
  }

  async execItem(one_file: [string, string]): Promise<[string, string]> {
    const [filename, file_content] = one_file;
    const summary_text = await callLLM(
      `Summarize the following file:\n${file_content}`
    );
    return [filename, summary_text];
  }

  async post(
    prepRes: [string, string][],
    execRes: [string, string][]
  ): Promise<string | undefined> {
    this._shared.data.file_summaries = Object.fromEntries(execRes);
    return "summarized";
  }
}

class CombineSummaries extends Node<MapReduceSharedStorage> {
  async prep(): Promise<Record<string, string>> {
    return this._shared.data.file_summaries || {};
  }

  async exec(file_summaries: Record<string, string>): Promise<string> {
    // Format as: "File1: summary\nFile2: summary...\n"
    const text_list: string[] = [];
    for (const [fname, summ] of Object.entries(file_summaries)) {
      text_list.push(`${fname} summary:\n${summ}\n`);
    }
    const big_text = text_list.join("\n---\n");

    return await callLLM(
      `Combine these file summaries into one final summary:\n${big_text}`
    );
  }

  async post(
    prepRes: Record<string, string>,
    final_summary: string
  ): Promise<string | undefined> {
    this._shared.data.all_files_summary = final_summary;
    return "combined";
  }
}

// Generic MapReduce Example with Parallel Processing
class MapChunks extends ParallelBatchNode<
  MapReduceSharedStorage,
  any,
  string,
  string,
  string
> {
  async prep(): Promise<string[]> {
    // Split text into chunks
    const text = this._shared.data.text_to_process || "";
    const chunkSize = 10;
    const chunks: string[] = [];

    for (let i = 0; i < text.length; i += chunkSize) {
      chunks.push(text.slice(i, i + chunkSize));
    }

    this._shared.data.text_chunks = chunks;
    return chunks;
  }

  async execItem(chunk: string): Promise<string> {
    // Process each chunk (map phase)
    // In a real application, this could be any transformation
    return chunk.toUpperCase();
  }

  async post(
    prepRes: string[],
    execRes: string[]
  ): Promise<string | undefined> {
    this._shared.data.processed_chunks = execRes;
    return "mapped";
  }
}

class ReduceResults extends Node<MapReduceSharedStorage> {
  async prep(): Promise<string[]> {
    return this._shared.data.processed_chunks || [];
  }

  async exec(processedChunks: string[]): Promise<string> {
    // Combine processed chunks (reduce phase)
    // In a real application, this could be any aggregation function
    return processedChunks.join(" + ");
  }

  async post(prepRes: string[], result: string): Promise<string | undefined> {
    this._shared.data.final_result = result;
    return "reduced";
  }
}

// Tests for the MapReduce pattern
describe("MapReduce Pattern Tests", () => {
  // Test Document Summarization Example
  test("Document Summarization MapReduce", async () => {
    // Create and connect nodes
    const batchNode = new SummarizeAllFiles();
    const combineNode = new CombineSummaries();

    batchNode.on("summarized", combineNode);

    const flow = new Flow(batchNode);

    // Prepare test data
    const shared: MapReduceSharedStorage = new Shared({
      files: {
        "file1.txt":
          "Alice was beginning to get very tired of sitting by her sister...",
        "file2.txt": "Some other interesting text ...",
        "file3.txt": "Yet another file with some content to summarize...",
      },
    });

    // Run the flow
    flow.setShared(shared);
    await flow.run();

    // Verify results
    expect(shared.data.file_summaries).toBeDefined();
    expect(Object.keys(shared.data.file_summaries || {}).length).toBe(3);
    expect(shared.data.all_files_summary).toBeDefined();
    expect(typeof shared.data.all_files_summary).toBe("string");
  });

  // Test Generic MapReduce with ParallelBatchNode
  test("Parallel Text Processing MapReduce", async () => {
    // Create and connect nodes
    const mapNode = new MapChunks();
    const reduceNode = new ReduceResults();

    mapNode.on("mapped", reduceNode);

    const flow = new Flow(mapNode);

    // Prepare test data
    const shared: MapReduceSharedStorage = new Shared({
      text_to_process:
        "This is a longer text that will be processed in parallel using the MapReduce pattern.",
    });

    // Run the flow
    flow.setShared(shared);
    await flow.run();

    // Verify results
    expect(shared.data.text_chunks).toBeDefined();
    expect(shared.data.text_chunks?.length).toBeGreaterThan(0);
    expect(shared.data.processed_chunks).toBeDefined();
    expect(shared.data.processed_chunks?.length).toBe(
      shared.data.text_chunks?.length
    );
    expect(shared.data.final_result).toBeDefined();
    expect(typeof shared.data.final_result).toBe("string");

    // Verify the content is actually transformed
    expect(
      shared.data.processed_chunks?.every(
        (chunk) => chunk === chunk.toUpperCase()
      )
    ).toBe(true);
  });

  // Test changing chunk size affects parallel processing
  test("Varying Chunk Size in MapReduce", async () => {
    // This test demonstrates how chunk size affects the MapReduce process

    // Create a custom MapChunks class with configurable chunk size
    class ConfigurableMapChunks extends ParallelBatchNode<
      MapReduceSharedStorage,
      any,
      string,
      string
    > {
      private chunkSize: number;

      constructor(chunkSize: number) {
        super();
        this.chunkSize = chunkSize;
      }

      async prep(): Promise<string[]> {
        const text = this._shared.data.text_to_process || "";
        const chunks: string[] = [];

        for (let i = 0; i < text.length; i += this.chunkSize) {
          chunks.push(text.slice(i, i + this.chunkSize));
        }

        this._shared.data.text_chunks = chunks;
        return chunks;
      }

      async execItem(chunk: string): Promise<string> {
        return chunk.toUpperCase();
      }

      async post(
        prepRes: string[],
        execRes: string[]
      ): Promise<string | undefined> {
        this._shared.data.processed_chunks = execRes;
        return "mapped";
      }
    }

    // Test with small chunk size
    const mapNodeSmall = new ConfigurableMapChunks(5);
    const reduceNodeSmall = new ReduceResults();
    mapNodeSmall.on("mapped", reduceNodeSmall);
    const flowSmall = new Flow(mapNodeSmall);

    // Test with larger chunk size
    const mapNodeLarge = new ConfigurableMapChunks(20);
    const reduceNodeLarge = new ReduceResults();
    mapNodeLarge.on("mapped", reduceNodeLarge);
    const flowLarge = new Flow(mapNodeLarge);

    // Same input for both flows
    const text = "This is a test text for demonstrating chunk size effects.";

    // Run with small chunks
    const sharedSmall: MapReduceSharedStorage = new Shared({
      text_to_process: text,
    });
    flowSmall.setShared(sharedSmall);
    await flowSmall.run();

    // Run with large chunks
    const sharedLarge: MapReduceSharedStorage = new Shared({
      text_to_process: text,
    });
    flowLarge.setShared(sharedLarge);
    await flowLarge.run();

    // Verify different chunk counts
    if (sharedSmall.data.text_chunks && sharedLarge.data.text_chunks) {
      expect(sharedSmall.data.text_chunks.length).toBeGreaterThan(
        sharedLarge.data.text_chunks.length
      );
    }

    // Verify end results are identical despite different chunking
    expect(sharedSmall.data.final_result?.replace(/\s\+\s/g, "")).toBe(
      sharedLarge.data.final_result?.replace(/\s\+\s/g, "")
    );
  });
});
