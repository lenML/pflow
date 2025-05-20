// tests/multi-agent-pattern.test.ts
import { Node, Flow, Shared } from "../src/index";

// Define shared storage with message queue for basic agent communication
type MessageQueueSharedStorage = Shared<{
  messages: string[];
  processedMessages: string[];
  processing?: boolean;
}>;

// Mock utility function to simulate LLM calls
function mockLLM(prompt: string): string {
  // Simple mock LLM that responds based on the prompt
  if (prompt.includes("Generate hint")) {
    return "This is a hint: Something cold on a stick";
  } else if (prompt.includes("Guess")) {
    return "popsicle";
  }
  return `Response to: ${prompt.substring(0, 20)}...`;
}

// Basic Agent Communication Example
class ListenerAgent extends Node<MessageQueueSharedStorage> {
  async prep(): Promise<string | undefined> {
    // Check if there are messages to process
    if (this._shared.data.messages.length === 0) {
      return undefined;
    }
    // Get the next message
    return this._shared.data.messages.shift();
  }

  async exec(message: string | undefined): Promise<string | undefined> {
    if (!message) {
      return undefined;
    }

    // Process the message (in real implementation, this could call an LLM)
    const response = `Processed: ${message}`;
    return response;
  }

  async post(
    prepRes: string | undefined,
    execRes: string | undefined
  ): Promise<string> {
    if (execRes) {
      // Store the processed message
      this._shared.data.processedMessages.push(execRes);
    }

    if (this._shared.data.messages.length === 0) {
      // Add a small delay to avoid tight loop CPU consumption in real implementation
      return "finished";
    }

    // Continue processing messages
    return "continue";
  }
}

// Taboo Game Example
// Define shared storage for the game
type TabooGameSharedStorage = Shared<{
  targetWord: string;
  forbiddenWords: string[];
  pastGuesses: string[];
  hinterQueue: string[];
  guesserQueue: string[];
  gameOver: boolean;
  maxRounds: number;
  currentRound: number;
  isCorrectGuess: boolean;
}>;

// Hinter agent that provides clues
class Hinter extends Node<TabooGameSharedStorage> {
  async prep(): Promise<any> {
    if (this._shared.data.gameOver) {
      return null;
    }

    // In test, we'll simulate waiting for a message by checking if it's our turn
    if (this._shared.data.hinterQueue.length === 0) {
      return null;
    }

    const message = this._shared.data.hinterQueue.shift();

    return {
      target: this._shared.data.targetWord,
      forbidden: this._shared.data.forbiddenWords,
      pastGuesses: this._shared.data.pastGuesses,
      message,
    };
  }

  async exec(input: any): Promise<string | null> {
    if (!input) return null;

    // Generate a hint using mock LLM
    const prompt = `Generate hint for word "${
      input.target
    }" without using forbidden words: ${input.forbidden.join(", ")}`;
    const hint = mockLLM(prompt);
    return hint;
  }

  async post(prepRes: any, hint: string | null): Promise<string | undefined> {
    if (!hint) {
      if (this._shared.data.gameOver) {
        return "finished";
      }
      return "continue_hinter";
    }

    // Send hint to guesser
    this._shared.data.guesserQueue.push(hint);
    this._shared.data.currentRound++;

    return "continue_hinter";
  }
}

// Guesser agent that tries to guess the target word
class Guesser extends Node<TabooGameSharedStorage> {
  async prep(): Promise<string | null> {
    if (this._shared.data.gameOver) {
      return null;
    }

    // Wait for a hint from the hinter
    if (this._shared.data.guesserQueue.length === 0) {
      return null;
    }

    return this._shared.data.guesserQueue.shift() || null;
  }

  async exec(hint: string | null): Promise<string | null> {
    if (!hint) return null;

    // Generate a guess using mock LLM
    const prompt = `Guess the word based on the hint: ${hint}`;
    const guess = mockLLM(prompt);
    return guess;
  }

  async post(
    hint: string | null,
    guess: string | null
  ): Promise<string | undefined> {
    if (!guess) {
      if (this._shared.data.gameOver) {
        return "finished";
      }
      return "continue_guesser";
    }

    // Record the guess
    this._shared.data.pastGuesses.push(guess);

    // Check if the guess is correct
    if (guess.toLowerCase() === this._shared.data.targetWord.toLowerCase()) {
      this._shared.data.isCorrectGuess = true;
      this._shared.data.gameOver = true;
      return "finished";
    }

    // Check if we've reached maximum rounds
    if (this._shared.data.currentRound >= this._shared.data.maxRounds) {
      this._shared.data.gameOver = true;
      return "finished";
    }

    // Send message to hinter for next round
    this._shared.data.hinterQueue.push("next_hint");

    return "continue_guesser";
  }
}

// Tests for Multi-Agent pattern
describe("Multi-Agent Pattern Tests", () => {
  // Test basic agent message queue
  test("Basic Agent Message Queue", async () => {
    // Create agent node
    const agent = new ListenerAgent();
    agent.on("continue", agent); // Connect to self to continue processing

    // Create flow
    const flow = new Flow(agent);

    // Create shared storage with messages
    const shared = new Shared({
      messages: [
        "System status: all systems operational",
        "Memory usage: normal",
        "Network connectivity: stable",
        "Processing load: optimal",
      ],
      processedMessages: [],
    });

    // Run the flow
    flow.setShared(shared);
    await flow.run();

    // Verify results
    expect(shared.data.messages.length).toBe(0);
    expect(shared.data.processedMessages.length).toBe(4);
    expect(shared.data.processedMessages[0]).toBe(
      "Processed: System status: all systems operational"
    );
  });

  // Test Taboo game multi-agent interaction
  test("Taboo Game Multi-Agent Interaction", async () => {
    // Create the agents
    const hinter = new Hinter();
    const guesser = new Guesser();

    // Connect agents
    hinter.on("continue_hinter", hinter);
    guesser.on("continue_guesser", guesser);

    // Create shared game state
    const shared: TabooGameSharedStorage = new Shared({
      targetWord: "popsicle",
      forbiddenWords: ["ice", "cream", "frozen", "stick", "summer"],
      pastGuesses: [],
      hinterQueue: ["start_game"], // Initial message to start the game
      guesserQueue: [],
      gameOver: false,
      maxRounds: 3,
      currentRound: 0,
      isCorrectGuess: false,
    });

    // Create flows
    const hinterFlow = new Flow(hinter);
    const guesserFlow = new Flow(guesser);

    hinterFlow.setShared(shared);
    guesserFlow.setShared(shared);

    // Run both flows concurrently to simulate multi-agent interaction
    const hinterPromise = hinterFlow.run();
    const guesserPromise = guesserFlow.run();

    // Wait for both to finish
    await Promise.all([hinterPromise, guesserPromise]);

    // Verify results
    expect(shared.data.gameOver).toBe(true);
    expect(shared.data.pastGuesses.length).toBeGreaterThan(0);
    expect(shared.data.isCorrectGuess).toBe(true);
  });

  // Test changing agent behavior with different parameters
  test("Configurable Agent Behavior", async () => {
    // Create a configurable agent that can be adjusted for testing
    class ConfigurableAgent extends Node<MessageQueueSharedStorage> {
      private processingDelay: number;

      constructor(processingDelay: number = 0) {
        super();
        this.processingDelay = processingDelay;
      }

      async prep(): Promise<string | undefined> {
        if (this._shared.data.messages.length === 0) {
          return undefined;
        }
        return this._shared.data.messages.shift();
      }

      async exec(message: string | undefined): Promise<string | undefined> {
        if (!message) {
          return undefined;
        }

        // Simulate processing time
        if (this.processingDelay > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.processingDelay)
          );
        }

        return `Processed with ${this.processingDelay}ms delay: ${message}`;
      }

      async post(
        prepRes: string | undefined,
        execRes: string | undefined
      ): Promise<string> {
        if (execRes) {
          this._shared.data.processedMessages.push(execRes);
        }

        if (this._shared.data.messages.length === 0) {
          return "finished";
        }
        return "continue";
      }
    }

    // Test with fast agent
    const fastAgent = new ConfigurableAgent(0);
    fastAgent.on("continue", fastAgent);
    const fastFlow = new Flow(fastAgent);

    const fastShared = new Shared({
      messages: ["Message 1", "Message 2", "Message 3"],
      processedMessages: [],
    });

    fastFlow.setShared(fastShared);
    await fastFlow.run();

    // Test with slow agent
    const slowAgent = new ConfigurableAgent(10);
    slowAgent.on("continue", slowAgent);
    const slowFlow = new Flow(slowAgent);

    const slowShared = new Shared({
      messages: ["Message 1", "Message 2", "Message 3"],
      processedMessages: [],
    });

    slowFlow.setShared(slowShared);
    await slowFlow.run();

    // Verify both processed all messages
    expect(fastShared.data.processedMessages.length).toBe(3);
    expect(slowShared.data.processedMessages.length).toBe(3);

    // Verify processing indicators in the output
    expect(fastShared.data.processedMessages[0]).toContain(
      "Processed with 0ms delay"
    );
    expect(slowShared.data.processedMessages[0]).toContain(
      "Processed with 10ms delay"
    );
  });
});
