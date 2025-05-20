// tests/rag-pattern.test.ts
import { BaseNode, Node, BatchNode, Flow, Shared } from "../src/index";

// Mock utility functions to simulate real operations
async function getEmbedding(text: string): Promise<number[]> {
  // Simple mock embedding - converts string to vector of character codes
  // In real applications, this would call an embedding API
  return Array.from(text.substring(0, 5)).map((char) => char.charCodeAt(0));
}

async function createIndex(
  embeddings: number[][]
): Promise<{ embeddings: number[][] }> {
  // Simple mock index creation
  return { embeddings };
}

async function searchIndex(
  index: { embeddings: number[][] },
  queryEmbedding: number[],
  options: { topK: number }
): Promise<[number[][], number[][]]> {
  // Mock search function that returns indices and distances
  // In real applications, this would do vector similarity search
  const similarities = index.embeddings.map((emb, idx) => {
    // Simple dot product as similarity
    const similarity = emb.reduce(
      (sum, val, i) => sum + val * (queryEmbedding[i] || 0),
      0
    );
    return [idx, similarity];
  });

  // Sort by similarity (descending)
  similarities.sort((a, b) => b[1] - a[1]);

  // Return top-k indices and distances
  const topK = Math.min(options.topK, similarities.length);
  const indices = [similarities.slice(0, topK).map((s) => s[0])];
  const distances = [similarities.slice(0, topK).map((s) => s[1])];

  return [indices, distances];
}

async function callLlm(prompt: string): Promise<string> {
  // Simple mock LLM call
  return `Answer based on: ${prompt.substring(0, 30)}...`;
}

// Define shared storage type for RAG pattern
type RAGSharedStorage = Shared<{
  files?: string[];
  allChunks?: string[];
  allEmbeds?: number[][];
  index?: any;
  question?: string;
  qEmb?: number[];
  retrievedChunk?: string;
  answer?: string;
}>;

// Stage 1: Offline Indexing Nodes
class ChunkDocs extends BatchNode<
  RAGSharedStorage,
  any,
  string,
  string,
  string[]
> {
  async prep(): Promise<string[]> {
    return this._shared.data.files || [];
  }

  async execItem(filepath: string): Promise<string[]> {
    // Mock file reading - in real usage, you would read actual files
    const text = `This is mock content for ${filepath}. It contains some sample text for testing the RAG pattern.`;

    // Chunk by 20 chars each
    const chunks: string[] = [];
    const size = 20;
    for (let i = 0; i < text.length; i += size) {
      chunks.push(text.substring(i, i + size));
    }
    return chunks;
  }

  async post(
    prepRes: string[],
    execResList: string[][]
  ): Promise<string | undefined> {
    // Flatten chunks from all files
    const allChunks: string[] = [];
    for (const chunkList of execResList) {
      allChunks.push(...chunkList);
    }
    this._shared.data.allChunks = allChunks;
    return undefined;
  }
}

class EmbedDocs extends BatchNode<
  RAGSharedStorage,
  any,
  string,
  string,
  number[]
> {
  async prep(): Promise<string[]> {
    return this._shared.data.allChunks || [];
  }

  async execItem(chunk: string): Promise<number[]> {
    return await getEmbedding(chunk);
  }

  async post(
    prepRes: string[],
    execResList: number[][]
  ): Promise<string | undefined> {
    this._shared.data.allEmbeds = execResList;
    return undefined;
  }
}

class StoreIndex extends Node<RAGSharedStorage> {
  async prep(): Promise<number[][]> {
    return this._shared.data.allEmbeds || [];
  }

  async exec(allEmbeds: number[][]): Promise<unknown> {
    return await createIndex(allEmbeds);
  }

  async post(prepRes: number[][], index: unknown): Promise<string | undefined> {
    this._shared.data.index = index;
    return undefined;
  }
}

// Stage 2: Online Query & Answer Nodes
class EmbedQuery extends Node<RAGSharedStorage> {
  async prep(): Promise<string> {
    return this._shared.data.question || "";
  }

  async exec(question: string): Promise<number[]> {
    return await getEmbedding(question);
  }

  async post(prepRes: string, qEmb: number[]): Promise<string | undefined> {
    this._shared.data.qEmb = qEmb;
    return undefined;
  }
}

class RetrieveDocs extends Node<RAGSharedStorage> {
  async prep(): Promise<[number[], unknown, string[]]> {
    return [
      this._shared.data.qEmb || [],
      this._shared.data.index || {},
      this._shared.data.allChunks || [],
    ];
  }

  async exec(inputs: [number[], unknown, string[]]): Promise<string> {
    const [qEmb, index, chunks] = inputs;
    const [I, D] = await searchIndex(
      index as { embeddings: number[][] },
      qEmb,
      { topK: 1 }
    );
    const bestId = I[0][0];
    const relevantChunk = chunks[bestId];
    return relevantChunk;
  }

  async post(
    prepRes: [number[], unknown, string[]],
    relevantChunk: string
  ): Promise<string | undefined> {
    this._shared.data.retrievedChunk = relevantChunk;
    return undefined;
  }
}

class GenerateAnswer extends Node<RAGSharedStorage> {
  async prep(): Promise<[string, string]> {
    return [
      this._shared.data.question || "",
      this._shared.data.retrievedChunk || "",
    ];
  }

  async exec(inputs: [string, string]): Promise<string> {
    const [question, chunk] = inputs;
    const prompt = `Question: ${question}\nContext: ${chunk}\nAnswer:`;
    return await callLlm(prompt);
  }

  async post(
    prepRes: [string, string],
    answer: string
  ): Promise<string | undefined> {
    this._shared.data.answer = answer;
    return undefined;
  }
}

// Tests for the RAG pattern
describe("RAG Pattern Tests", () => {
  // Test the offline indexing flow
  test("Offline Indexing Flow", async () => {
    // Create and connect nodes
    const chunkNode = new ChunkDocs();
    const embedNode = new EmbedDocs();
    const storeNode = new StoreIndex();

    chunkNode.next(embedNode);
    embedNode.next(storeNode);

    const offlineFlow = new Flow(chunkNode);

    // Prepare test data
    const shared: RAGSharedStorage = new Shared({
      files: ["doc1.txt", "doc2.txt"],
    });

    // Run the flow
    offlineFlow.setShared(shared);
    await offlineFlow.run();

    // Verify results
    expect(shared.data.allChunks).toBeDefined();
    expect(shared.data.allChunks?.length).toBeGreaterThan(0);
    expect(shared.data.allEmbeds).toBeDefined();
    expect(shared.data.allEmbeds?.length).toBe(shared.data.allChunks?.length);
    expect(shared.data.index).toBeDefined();
  });

  // Test the online query and answer flow
  test("Online Query & Answer Flow", async () => {
    // First run the offline indexing to prepare the data
    const chunkNode = new ChunkDocs();
    const embedNode = new EmbedDocs();
    const storeNode = new StoreIndex();

    chunkNode.next(embedNode);
    embedNode.next(storeNode);

    const offlineFlow = new Flow(chunkNode);

    const shared: RAGSharedStorage = new Shared({
      files: ["doc1.txt", "doc2.txt"],
    });

    offlineFlow.setShared(shared);
    await offlineFlow.run();

    // Now create and run the online flow
    const embedQNode = new EmbedQuery();
    const retrieveNode = new RetrieveDocs();
    const generateNode = new GenerateAnswer();

    embedQNode.next(retrieveNode);
    retrieveNode.next(generateNode);

    const onlineFlow = new Flow(embedQNode);

    // Set the question
    shared.data.question = "What is the content about?";

    // Run the flow
    onlineFlow.setShared(shared);
    await onlineFlow.run();

    // Verify results
    expect(shared.data.qEmb).toBeDefined();
    expect(shared.data.retrievedChunk).toBeDefined();
    expect(shared.data.answer).toBeDefined();
    expect(typeof shared.data.answer).toBe("string");
  });

  // Test the complete RAG pipeline
  test("Complete RAG Pipeline", async () => {
    // Create a combined flow for both offline and online stages

    // Offline stage nodes
    const chunkNode = new ChunkDocs();
    const embedNode = new EmbedDocs();
    const storeNode = new StoreIndex();

    // Online stage nodes
    const embedQNode = new EmbedQuery();
    const retrieveNode = new RetrieveDocs();
    const generateNode = new GenerateAnswer();

    // Connect offline stage
    chunkNode.next(embedNode);
    embedNode.next(storeNode);

    // Connect online stage
    storeNode.next(embedQNode);
    embedQNode.next(retrieveNode);
    retrieveNode.next(generateNode);

    // Create flow
    const fullRagFlow = new Flow(chunkNode);

    // Prepare test data
    const shared: RAGSharedStorage = new Shared({
      files: ["doc1.txt", "doc2.txt"],
      question: "What is the content about?",
    });

    // Run the full flow
    fullRagFlow.setShared(shared);
    await fullRagFlow.run();

    // Verify results
    expect(shared.data.allChunks).toBeDefined();
    expect(shared.data.allEmbeds).toBeDefined();
    expect(shared.data.index).toBeDefined();
    expect(shared.data.qEmb).toBeDefined();
    expect(shared.data.retrievedChunk).toBeDefined();
    expect(shared.data.answer).toBeDefined();
    expect(typeof shared.data.answer).toBe("string");
  });
});
