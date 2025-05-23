# pflow

enhancement pocket-flow

## features

- typing safety
- Practical Experience

# usage

```ts
import { Node, Flow, Shared, Action } from "@lenml/pflow";

// ... some utils

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

  async exec(prepRes: Messages | null): Promise<unknown> {
    if (prepRes === null) return null;

    const resp = await get_llm_completions(prepRes);

    return resp.choices[0].message.content;
  }

  async post(
    prepRes: Messages | null,
    execRes: string
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

chat_flow.setShared(shared);
chat_flow.run();
```
