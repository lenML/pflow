import { Node, Flow, Shared, Action, Inspector } from "../src";
import readline from "readline";
import fs from "fs";

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
        messages,
        ...params,
      }),
    }
  );
  return resp.json();
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

class ChatNode extends Node<Shared<{ messages: Messages }>> {
  async prep(): Promise<Messages | null> {
    const { messages } = this._shared.data;

    const user_input = await prompt("User: ");

    if (user_input === "exit") {
      return null;
    }

    messages.push({ role: "user", content: user_input });
    return messages;
  }

  async exec(prepRes: Messages | null): Promise<string | null> {
    if (prepRes === null) return null;

    const resp = await get_llm_completions(prepRes);

    return resp.choices[0].message.content;
  }

  async post(
    prepRes: Messages | null,
    execRes: string | null
  ): Promise<Action | undefined> {
    if (prepRes === null || execRes === null) {
      console.log("\nGoodbye!");
      return undefined;
    }

    console.log(`\nAssistant: ${execRes}`);

    this._shared.data.messages.push({ role: "assistant", content: execRes });

    return "continue";
  }
}

const shared = new Shared<{
  messages: Messages;
}>({ messages: [] });
const chat_node = new ChatNode();
chat_node.on("continue", chat_node);
const chat_flow = new Flow(chat_node);
const inspector = new Inspector(shared);
inspector
  .collect(chat_flow, async () => {
    chat_flow.setShared(shared);
    await chat_flow.run();
  })
  .then((events) => {
    fs.writeFileSync(
      "inspector-events.json",
      JSON.stringify(events, null, 2),
      "utf-8"
    );
  });
