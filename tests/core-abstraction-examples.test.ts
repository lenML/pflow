// tests/core_abstraction_examples.test.ts
import {
  BaseNode,
  Node,
  BatchNode,
  ParallelBatchNode,
  Flow,
  BatchFlow,
  ParallelBatchFlow,
  Shared,
} from "../src/index";

// Define shared storage types
type SharedStorage = Shared<{
  data?: string;
  summary?: string;
  files?: string[];
  results?: any[];
  current?: number;
  expenses?: Array<{ id: string; amount: number; status?: string }>;
  // For nested flows example
  payments?: Array<{ id: string; status: string }>;
  inventory?: Array<{ id: string; status: string }>;
  shipping?: Array<{ id: string; status: string }>;
  orderComplete?: boolean;
}>;

// 1. Simple Node Example (SummarizeFile from node.md)
class SummarizeFile extends Node<SharedStorage, FileParams> {
  async prep(): Promise<string | undefined> {
    return this._shared.data.data;
  }

  async exec(prepRes: string | undefined): Promise<string> {
    if (!prepRes) {
      return "Empty file content";
    }
    // Simulate LLM call
    return `Summary: ${prepRes.substring(0, 10)}...`;
  }

  async execFallback(
    prepRes: string | undefined,
    error: Error
  ): Promise<string> {
    // Provide a simple fallback
    return "There was an error processing your request.";
  }

  async post(
    prepRes: string | undefined,
    execRes: string
  ): Promise<string | undefined> {
    this._shared.data.summary = execRes;
    return undefined; // "default" action
  }
}

// 2. Expense Approval Flow example (from flow.md)
class ReviewExpense extends Node<SharedStorage> {
  async prep(): Promise<any> {
    // Select the first pending expense
    return this._shared.data.expenses?.find((e) => !e.status);
  }

  async post(prepRes: any): Promise<string> {
    if (!prepRes) return "finished";

    // Based on amount, determine approval path
    const expense = prepRes;
    if (expense.amount <= 100) {
      expense.status = "approved";
      return "approved";
    } else if (expense.amount > 500) {
      expense.status = "rejected";
      return "rejected";
    } else {
      expense.status = "needs_revision";
      return "needs_revision";
    }
  }
}

class ReviseExpense extends Node<SharedStorage> {
  async prep(): Promise<any> {
    // Find expense that needs revision
    return this._shared.data.expenses?.find(
      (e) => e.status === "needs_revision"
    );
  }

  async post(prepRes: any): Promise<string> {
    if (!prepRes) return "finished";

    // Reduce the expense amount to make it more likely to be approved
    const expense = prepRes;
    expense.amount = 75; // Revised to a lower amount
    expense.status = undefined; // Reset status for re-review

    return "default"; // Go back to review
  }
}

class ProcessPayment extends Node<SharedStorage> {
  async prep(): Promise<any> {
    // Find approved expenses to process
    return this._shared.data.expenses?.find((e) => e.status === "approved");
  }

  async post(prepRes: any): Promise<string> {
    if (!prepRes) return "finished";

    // Mark expense as paid
    const expense = prepRes;
    expense.status = "paid";

    return "default"; // Continue to finish
  }
}

class FinishProcess extends Node<SharedStorage> {
  async post(): Promise<string> {
    // Simply mark the process as done and return
    return "finished";
  }
}

// 3. BatchNode example (MapSummaries from batch.md)
class MapSummaries extends BatchNode<
  SharedStorage,
  any,
  string,
  string,
  string
> {
  async prep(): Promise<string[]> {
    // Suppose we have a big file; chunk it
    const content = this._shared.data.data || "";
    const chunks: string[] = [];
    const chunkSize = 10;

    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.slice(i, i + chunkSize));
    }

    return chunks;
  }

  async execItem(chunk: string): Promise<string> {
    // Process each chunk
    return `Chunk summary: ${chunk.substring(0, 3)}...`;
  }

  async post(
    prepRes: string[],
    execRes: string[]
  ): Promise<string | undefined> {
    // Combine summaries
    this._shared.data.summary = execRes.join("\n");
    return "default";
  }
}

// 4. BatchFlow example (SummarizeAllFiles from batch.md)
type FileParams = {
  filename: string;
};

class LoadFile extends Node<SharedStorage, FileParams> {
  async prep(): Promise<string> {
    // Simulate loading a file
    const filename = this._params.filename;
    return `Content of ${filename}`;
  }

  async post(prepRes: string): Promise<string | undefined> {
    this._shared.data.data = prepRes;
    return undefined;
  }
}

class SummarizeAllFiles extends BatchFlow<SharedStorage> {
  async prep(): Promise<FileParams[]> {
    return (this._shared.data.files || []).map((filename) => ({ filename }));
  }
}

// 5. ParallelBatchNode example (TextSummarizer from parallel.md)
class TextSummarizer extends ParallelBatchNode<
  SharedStorage,
  any,
  string,
  string,
  string
> {
  async prep(): Promise<string[]> {
    // For testing, we'll create an array of texts
    return this._shared.data.data?.split("\n") || [];
  }

  async execItem(text: string): Promise<string> {
    // Simulate LLM call
    return `Summary of: ${text.substring(0, 5)}...`;
  }

  async post(
    prepRes: string[],
    execRes: string[]
  ): Promise<string | undefined> {
    this._shared.data.results = execRes;
    return "default";
  }
}

// 6. Nested Flow example (Order Processing Pipeline from flow.md)
// Payment Flow nodes
class ValidatePayment extends Node<SharedStorage> {
  async post(): Promise<string> {
    if (!this._shared.data.payments) this._shared.data.payments = [];
    this._shared.data.payments.push({ id: "payment1", status: "validated" });
    return "default";
  }
}

class ProcessPaymentFlow extends Node<SharedStorage> {
  async post(): Promise<string> {
    if (this._shared.data.payments) {
      this._shared.data.payments.forEach((p) => {
        if (p.status === "validated") p.status = "processed";
      });
    }
    return "default";
  }
}

class PaymentConfirmation extends Node<SharedStorage> {
  async post(): Promise<string> {
    if (this._shared.data.payments) {
      this._shared.data.payments.forEach((p) => {
        if (p.status === "processed") p.status = "confirmed";
      });
    }
    return "default";
  }
}

// Inventory Flow nodes
class CheckStock extends Node<SharedStorage> {
  async post(): Promise<string> {
    if (!this._shared.data.inventory) this._shared.data.inventory = [];
    this._shared.data.inventory.push({ id: "inventory1", status: "checked" });
    return "default";
  }
}

class ReserveItems extends Node<SharedStorage> {
  async post(): Promise<string> {
    if (this._shared.data.inventory) {
      this._shared.data.inventory.forEach((i) => {
        if (i.status === "checked") i.status = "reserved";
      });
    }
    return "default";
  }
}

class UpdateInventory extends Node<SharedStorage> {
  async post(): Promise<string> {
    if (this._shared.data.inventory) {
      this._shared.data.inventory.forEach((i) => {
        if (i.status === "reserved") i.status = "updated";
      });
    }
    return "default";
  }
}

// Shipping Flow nodes
class CreateLabel extends Node<SharedStorage> {
  async post(): Promise<string> {
    if (!this._shared.data.shipping) this._shared.data.shipping = [];
    this._shared.data.shipping.push({ id: "shipping1", status: "labeled" });
    return "default";
  }
}

class AssignCarrier extends Node<SharedStorage> {
  async post(): Promise<string> {
    if (this._shared.data.shipping) {
      this._shared.data.shipping.forEach((s) => {
        if (s.status === "labeled") s.status = "assigned";
      });
    }
    return "default";
  }
}

class SchedulePickup extends Node<SharedStorage> {
  async post(): Promise<string> {
    if (this._shared.data.shipping) {
      this._shared.data.shipping.forEach((s) => {
        if (s.status === "assigned") s.status = "scheduled";
      });
    }

    // Order complete
    this._shared.data.orderComplete = true;
    return "default";
  }
}

describe("Core Abstraction Examples", () => {
  // 1. Basic Node tests
  describe("Node Example: SummarizeFile", () => {
    test("should summarize file content", async () => {
      const shared: SharedStorage = new Shared({
        data: "This is a test document that needs to be summarized.",
      });
      const summarizeNode = new SummarizeFile(3); // maxRetries = 3
      summarizeNode.setShared(shared);
      await summarizeNode.run();

      expect(shared.data.summary).toBe("Summary: This is a ...");
    });

    test("should handle empty content", async () => {
      const shared: SharedStorage = new Shared({ data: "" });
      const summarizeNode = new SummarizeFile();
      summarizeNode.setShared(shared);
      await summarizeNode.run();

      expect(shared.data.summary).toBe("Empty file content");
    });
  });

  // 2. Flow and branching tests
  describe("Flow Example: Expense Approval", () => {
    test("should approve small expenses", async () => {
      const shared: SharedStorage = new Shared({
        expenses: [{ id: "exp1", amount: 50 }],
      });

      const review = new ReviewExpense();
      const payment = new ProcessPayment();
      const finish = new FinishProcess();

      review.on("approved", payment);
      payment.next(finish);

      const flow = new Flow(review);
      flow.setShared(shared);
      await flow.run();

      expect(shared.data.expenses?.[0].status).toBe("paid");
    });

    test("should reject large expenses", async () => {
      const shared: SharedStorage = new Shared({
        expenses: [{ id: "exp2", amount: 1000 }],
      });

      const review = new ReviewExpense();
      const payment = new ProcessPayment();
      const finish = new FinishProcess();

      review.on("rejected", finish);

      const flow = new Flow(review);
      flow.setShared(shared);
      await flow.run();

      expect(shared.data.expenses?.[0].status).toBe("rejected");
    });

    test("should handle expense revision and then approval", async () => {
      const shared: SharedStorage = new Shared({
        expenses: [{ id: "exp3", amount: 200 }],
      });

      const review = new ReviewExpense();
      const revise = new ReviseExpense();
      const payment = new ProcessPayment();
      const finish = new FinishProcess();

      // Set up the flow connections
      review.on("approved", payment);
      review.on("needs_revision", revise);
      review.on("rejected", finish);

      revise.next(review);
      payment.next(finish);

      const flow = new Flow(review);
      flow.setShared(shared);
      await flow.run();

      expect(shared.data.expenses?.[0].status).toBe("paid");
      expect(shared.data.expenses?.[0].amount).toBe(75); // revised amount
    });
  });

  // 3. BatchNode tests
  describe("BatchNode Example: MapSummaries", () => {
    test("should process text in chunks", async () => {
      const shared: SharedStorage = new Shared({
        data: "This is a very long document that needs to be processed in chunks.",
      });

      const mapSummaries = new MapSummaries();
      mapSummaries.setShared(shared);
      await mapSummaries.run();

      expect(shared.data.summary).toContain("Chunk summary: Thi");
      expect(shared.data.summary?.split("\n").length).toBeGreaterThan(1);
    });
  });

  // 4. BatchFlow tests
  describe("BatchFlow Example: SummarizeAllFiles", () => {
    test("should process multiple files", async () => {
      const shared: SharedStorage = new Shared({
        files: ["file1.txt", "file2.txt", "file3.txt"],
      });

      const loadFile = new LoadFile();
      const summarizeFile = new SummarizeFile();

      loadFile.next(summarizeFile);

      const summarizeAllFiles = new SummarizeAllFiles(new Flow(loadFile));
      summarizeAllFiles.setShared(shared);
      await summarizeAllFiles.run();

      // The last file's summary should be in shared.summary
      expect(shared.data.summary).toBe("Summary: Content of...");
    });
  });

  // 5. ParallelBatchNode tests
  describe("ParallelBatchNode Example: TextSummarizer", () => {
    test("should process multiple texts in parallel", async () => {
      const shared: SharedStorage = new Shared({
        data: "Text 1\nText 2\nText 3\nText 4",
      });

      const textSummarizer = new TextSummarizer();
      textSummarizer.setShared(shared);
      await textSummarizer.run();

      expect(shared.data.results?.length).toBe(4);
      expect(shared.data.results?.[0]).toBe("Summary of: Text ...");
      expect(shared.data.results?.[1]).toBe("Summary of: Text ...");
    });
  });

  // 6. Nested Flow tests
  describe("Nested Flow Example: Order Processing Pipeline", () => {
    test("should process a complete order through multiple flows", async () => {
      const shared: SharedStorage = new Shared({});

      // Build Payment Flow
      const validatePayment = new ValidatePayment();
      const processPayment = new ProcessPaymentFlow();
      const paymentConfirmation = new PaymentConfirmation();

      validatePayment.next(processPayment).next(paymentConfirmation);
      const paymentFlow = new Flow(validatePayment);

      // Build Inventory Flow
      const checkStock = new CheckStock();
      const reserveItems = new ReserveItems();
      const updateInventory = new UpdateInventory();

      checkStock.next(reserveItems).next(updateInventory);
      const inventoryFlow = new Flow(checkStock);

      // Build Shipping Flow
      const createLabel = new CreateLabel();
      const assignCarrier = new AssignCarrier();
      const schedulePickup = new SchedulePickup();

      createLabel.next(assignCarrier).next(schedulePickup);
      const shippingFlow = new Flow(createLabel);

      // Connect the flows
      paymentFlow.next(inventoryFlow).next(shippingFlow);

      // Create and run the master flow
      const orderPipeline = new Flow(paymentFlow);
      orderPipeline.setShared(shared);
      await orderPipeline.run();

      // Check results
      expect(shared.data.payments?.[0].status).toBe("confirmed");
      expect(shared.data.inventory?.[0].status).toBe("updated");
      expect(shared.data.shipping?.[0].status).toBe("scheduled");
      expect(shared.data.orderComplete).toBe(true);
    });
  });
});
