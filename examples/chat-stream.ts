import { Node, Flow, Shared, Action } from "../src";
import readline from "readline";

export async function* get_llm_completions_stream(
  messages: { role: string; content: string }[],
  params = {} as any
): AsyncGenerator<any> {
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
        stream: true,
        messages,
        ...params,
      }),
    }
  );

  if (!resp.ok || !resp.body) {
    throw new Error(`OpenAI API request failed: ${resp.statusText}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // incomplete last line is kept for next round

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "" || !trimmed.startsWith("data: ")) continue;

      const jsonStr = trimmed.replace(/^data: /, "");
      if (jsonStr === "[DONE]") return;

      try {
        const data = JSON.parse(jsonStr);
        const delta = data.choices?.[0]?.delta?.content;
        if (delta) yield data;
      } catch (err) {
        console.error("Failed to parse JSON:", jsonStr, err);
      }
    }
  }
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

interface Message {
  role: string;
  content: string;
}
type Messages = Message[];

class ChatStreamNode extends Node<Shared<{ messages: Messages }>> {
  async prep(): Promise<Messages | null> {
    const { messages } = this._shared.data;
    const user_input = await prompt("\nUser: ");

    if (user_input === "exit") {
      return null;
    }

    messages.push({ role: "user", content: user_input });
    return messages;
  }

  async exec(prepRes: Messages | null): Promise<string | null> {
    if (prepRes === null) return null;

    let resp: string = "";

    process.stdout.write("\nAssistant: ");
    for await (const chunk of get_llm_completions_stream(prepRes)) {
      this._shared.emit("chunk", chunk);
      const delta = chunk.choices?.[0]?.delta?.content;
      resp += delta;
      process.stdout.write(delta);
    }
    console.log("");

    return resp;
  }

  async post(
    prepRes: Messages | null,
    execRes: string | null
  ): Promise<Action | undefined> {
    if (prepRes === null || execRes === null) {
      console.log("\nGoodbye!");
      return undefined;
    }

    this._shared.data.messages.push({ role: "assistant", content: execRes });

    return "continue";
  }
}

const shared = new Shared<{
  messages: Messages;
}>({ messages: [] });
const chat_node = new ChatStreamNode();
chat_node.on("continue", chat_node);
const chat_flow = new Flow(chat_node);

chat_flow.setShared(shared);
chat_flow.run();
