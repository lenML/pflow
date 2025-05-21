import { Node, Flow, Shared, IShared } from "../../src";
import readline from "readline";
import { IndexFlatL2 } from "faiss-node";

function flat_messages(messages: Messages) {
  return messages.flatMap((msg, index, arr) => {
    if (msg.role === "system" && index !== 0) {
      // 将 system/user/assistant/user/assistant/system/user/assistant
      // 转为 system/user/assistant/user/assistant/user/assistant
      // 原因是，一部分 jinja 模板不支持在中间插入 system message
      msg.role = "user";
      msg.content = `<system_message>\n${msg.content}\n</system_message>`;
      return [
        msg,
        { role: "assistant", content: "ok. accept system message." },
      ];
    }
    if (msg.role === "assistant" && arr[index - 1]?.role !== "user") {
      // fix missing user message issues
      return [{ role: "user", content: "[truncation_history_hide]" }, msg];
    }
    return msg;
  });
}

async function get_llm_completions(
  messages: { role: string; content: string }[],
  params = {} as any
) {
  const resp = await fetch(
    `${process.env.OPENAI_API_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: flat_messages(messages),
        ...params,
      }),
    }
  );
  return (await resp.json()) as {
    choices: { message: { content: string } }[];
  };
}

async function get_embedding(texts: string[]) {
  const resp = await fetch(`${process.env.OPENAI_API_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "text-embedding-ada-002",
      input: texts,
    }),
  });
  return (await resp.json()) as {
    data: { embedding: number[] }[];
  };
}

function prompt(query: string) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<string>((resolve) => {
    rl.question(query, function (answer) {
      resolve(answer);
      rl.close();
    });
  });
}

function search_vectors(index: IndexFlatL2, query_vector: number[], k = 1) {
  k = Math.min(index.ntotal(), k);
  if (k === 0) {
    return {
      distances: [],
      labels: [],
    };
  }

  const result = index.search(query_vector, k);
  return result;
}

interface Message {
  role: string;
  content: string;
}
type Messages = Message[];
type IChatMemSharedData = {
  messages: Messages;
  vector_index: IndexFlatL2;
  vector_items: Messages[];
  retrieved_conversation: Messages | undefined;
};
type IChatMemShared = IShared<IChatMemSharedData>;

class GetUserQuestionNode extends Node<
  IChatMemShared,
  any,
  string,
  unknown,
  string | null
> {
  async prep(): Promise<unknown> {
    // Initialize messages if first run
    if (!this._shared.data["messages"]) {
      this._shared.data["messages"] = [];
      console.log(
        "Welcome to the interactive chat! Type 'exit' to end the conversation."
      );
    }

    return undefined;
  }

  // Get user input interactively
  async exec(prepRes: unknown): Promise<string | undefined> {
    // Get interactive input from user
    const user_input = await prompt("\nYou: ");

    // Check if user wants to exit
    if (user_input.toLowerCase() == "exit") return undefined;

    return user_input;
  }

  // def post(self, shared, prep_res, exec_res):
  async post(
    prepRes: unknown,
    execRes: string | undefined
  ): Promise<string | undefined> {
    // If exec_res is None, the user wants to exit
    if (execRes === undefined) {
      console.log("\nGoodbye!");
      return undefined; // End the conversation
    }

    // Add user message to current messages
    this._shared.data["messages"].push({ role: "user", content: execRes });

    return "retrieve";
  }
}

class AnswerNode extends Node<
  IChatMemShared,
  any,
  string,
  Messages,
  string | null
> {
  async prep(): Promise<Messages | undefined> {
    // Prepare context for the LLM
    if (!this._shared.data.messages) {
      return undefined;
    }

    // 1. Get the last 3 conversation pairs (or fewer if not available)
    const recent_messages =
      this._shared.data.messages.length > 6
        ? this._shared.data.messages.slice(-6)
        : this._shared.data.messages;

    // 2. Add the retrieved relevant conversation if available
    const context: Messages = [];
    if (this._shared.data.retrieved_conversation) {
      // Add a system message to indicate this is a relevant past conversation
      context.push({
        role: "system",
        content:
          "The following is a relevant past conversation that may help with the current query:",
      });
      context.push(...this._shared.data.retrieved_conversation);
      context.push({
        role: "system",
        content: "Now continue the current conversation:",
      });
    }

    // 3. Add the recent messages
    context.push(...recent_messages);

    return context;
  }

  async exec(messages: any[] | undefined): Promise<string | undefined> {
    // Generate a response using the LLM
    if (!messages) {
      return undefined;
    }

    // Call LLM with the context
    const response = await get_llm_completions(messages);
    return response?.choices?.[0].message?.content;
  }

  async post(
    prepRes: any[] | undefined,
    execRes: string | undefined
  ): Promise<string | undefined> {
    // Process the LLM response
    if (!prepRes || !execRes) {
      return undefined; // End the conversation
    }

    // Print the assistant's response
    console.log(`\nAssistant: ${execRes}`);

    // Add assistant message to history
    this._shared.data.messages.push({ role: "assistant", content: execRes });

    // If we have more than 6 messages (3 conversation pairs), archive the oldest pair
    if (this._shared.data.messages.length > 6) {
      return "embed";
    }

    return "question";
  }
}

class EmbedNode extends Node<
  IChatMemShared,
  any,
  string,
  Messages | null,
  { conversation: Messages; embedding: number[] } | null
> {
  async prep(): Promise<Messages | undefined> {
    // Extract the oldest conversation pair for embedding
    if (this._shared.data.messages.length <= 6) {
      return undefined;
    }

    // Extract the oldest user-assistant pair
    const oldest_pair = this._shared.data.messages.slice(0, 2);
    // Remove them from current messages
    this._shared.data.messages = this._shared.data.messages.slice(2);

    return oldest_pair;
  }

  async exec(conversation: Messages | undefined): Promise<any | undefined> {
    // Embed a conversation
    if (!conversation) {
      return undefined;
    }

    // Combine user and assistant messages into a single text for embedding
    const user_msg = conversation.find((msg) => msg.role === "user") || {
      content: "",
    };
    const assistant_msg = conversation.find(
      (msg) => msg.role === "assistant"
    ) || { content: "" };
    const combined = `User: ${user_msg.content} Assistant: ${assistant_msg.content}`;

    // Generate embedding
    const embeddings = await get_embedding([combined]);
    const embedding = embeddings?.data?.[0].embedding;

    return {
      conversation,
      embedding,
    };
  }

  async post(
    prepRes: Messages | undefined,
    execRes: { conversation: Messages; embedding: number[] } | undefined
  ): Promise<string | undefined> {
    // Store the embedding and add to index
    if (!execRes) {
      // If there's nothing to embed, just continue with the next question
      return "question";
    }

    const { vector_index, vector_items } = this._shared.data;
    // Add the embedding to the index and store the conversation
    vector_index.add(execRes.embedding);
    const position = vector_index.ntotal() - 1;
    vector_items.push(execRes.conversation);

    console.log(`✅ Added conversation to index at position ${position}`);
    console.log(`✅ Index now contains ${vector_items.length} conversations`);

    // Continue with the next question
    return "question";
  }
}

class RetrieveNode extends Node<
  IChatMemShared,
  any,
  string,
  { query: string } | undefined,
  { conversation: Messages; distance: number } | undefined
> {
  async prep(): Promise<{ query: string } | undefined> {
    // Get the current query for retrieval
    if (!this._shared.data.messages) {
      return undefined;
    }

    // Get the latest user message for searching
    const latest_user_msg = [...this._shared.data.messages]
      .reverse()
      .find((msg) => msg.role === "user") || { content: "" };

    return {
      query: latest_user_msg.content,
    };
  }

  async exec(
    inputs: { query: string } | undefined
  ): Promise<{ conversation: Messages; distance: number } | undefined> {
    // Find the most relevant past conversation
    if (!inputs) {
      return undefined;
    }

    const query = inputs.query;
    const vector_index = this._shared.data.vector_index;
    const vector_items = this._shared.data.vector_items;

    console.log(
      `🔍 Finding relevant conversation for: ${query.substring(0, 30)}...`
    );

    // Create embedding for the query
    const query_embeddings = await get_embedding([query]);
    const query_embedding = query_embeddings.data?.[0]?.embedding;

    // Search for the most similar conversation
    const { labels: indices, distances } = search_vectors(
      vector_index,
      query_embedding,
      1
    );

    if (!indices || indices.length === 0) {
      return undefined;
    }

    // Get the corresponding conversation
    const conversation = vector_items[indices[0]];

    return {
      conversation,
      distance: distances[0],
    };
  }

  async post(
    prepRes: any | undefined,
    execRes: any | undefined
  ): Promise<string | undefined> {
    // Store the retrieved conversation
    if (execRes) {
      this._shared.data.retrieved_conversation = execRes.conversation;
      console.log(
        `📄 Retrieved conversation (distance: ${execRes.distance.toFixed(4)})`
      );
    } else {
      this._shared.data.retrieved_conversation = undefined;
    }

    return "answer";
  }
}

class ChatMemShared
  extends Shared<IChatMemSharedData>
  implements IChatMemShared
{
  constructor(dimension = 768) {
    super({
      messages: [],
      retrieved_conversation: undefined,
      vector_index: new IndexFlatL2(dimension),
      vector_items: [],
    });
  }
}

function create_flow() {
  // # Create the nodes
  const question_node = new GetUserQuestionNode();
  const retrieve_node = new RetrieveNode();
  const answer_node = new AnswerNode();
  const embed_node = new EmbedNode();

  // # Connect the flow:
  // # 1. Start with getting a question
  // # 2. Retrieve relevant conversations
  // # 3. Generate an answer
  // # 4. Optionally embed old conversations
  // # 5. Loop back to get the next question

  question_node.on("retrieve", retrieve_node);
  retrieve_node.on("answer", answer_node);

  // # When we need to embed old conversations
  answer_node.on("embed", embed_node);

  // # Loop back for next question
  answer_node.on("question", question_node);
  embed_node.on("question", question_node);

  // # Create the flow starting with question node
  return new Flow<IChatMemShared>(question_node);
}

async function main() {
  // checking system variables
  if (!process.env.OPENAI_API_BASE_URL) {
    throw new Error("OPENAI_API_BASE_URL is not set");
  }

  /**
   * Run an interactive chat interface with memory retrieval.
   *
   * Features:
   * 1. Maintains a window of the 3 most recent conversation pairs
   * 2. Archives older conversations with embeddings
   * 3. Retrieves 1 relevant past conversation when needed
   * 4. Total context to LLM: 3 recent pairs + 1 retrieved pair
   */

  console.log("=".repeat(50));
  console.log("PocketFlow Chat with Memory");
  console.log("=".repeat(50));
  console.log("This chat keeps your 3 most recent conversations");
  console.log("and brings back relevant past conversations when helpful");
  console.log("Type 'exit' to end the conversation");
  console.log("=".repeat(50));

  // # Run the chat flow
  const shared = new ChatMemShared();
  const flow = create_flow();
  flow.setShared(shared);
  return await flow.run();
}

main();
