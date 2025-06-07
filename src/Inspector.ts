import { BaseNode } from "./BaseNode";
import { BatchFlow, Flow, ParallelBatchFlow } from "./nodes";
import { Events, IShared } from "./types";
import { deepClone } from "./utils";

function is_flow_node(
  node: BaseNode
): node is Flow | BatchFlow | ParallelBatchFlow {
  return (
    node instanceof Flow ||
    node instanceof BatchFlow ||
    node instanceof ParallelBatchFlow
  );
}

function walk(node: BaseNode, fn: (node: BaseNode) => { stop?: boolean }) {
  const { stop } = fn(node);
  if (stop) return;
  // @ts-ignore
  for (const child of node._successors.values()) {
    walk(child, fn);
  }
  if (is_flow_node(node)) {
    walk(node.start, fn);
  }
}

function getClassChain(obj: any) {
  const chain: string[] = [];
  let proto = Object.getPrototypeOf(obj);

  while (proto && proto.constructor && proto.constructor.name !== "Object") {
    chain.push(proto.constructor.name);
    proto = Object.getPrototypeOf(proto);
  }

  return chain;
}

function toCopyable(o: any) {
  // 判断是否是可以被json序列化的，普通类型或者普通对象，如果不是就用 contructor.name 替代
  if (
    typeof o === "string" ||
    typeof o === "number" ||
    typeof o === "boolean" ||
    o === null ||
    o === undefined ||
    o instanceof String ||
    o instanceof Number ||
    o instanceof Boolean
  ) {
    return o;
  }
  if (o instanceof BigInt) {
    return `bigint:${o.toString()}`;
  }
  if (o.constructor === Object) {
    return Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k, toCopyable(v)])
    );
  }
  if (Array.isArray(o)) {
    return o.map((v) => toCopyable(v));
  }
  if (o instanceof Date) {
    return `date:${o.toISOString()}`;
  }
  if (o instanceof RegExp) {
    return `regexp:/${o.source}/${o.flags}`;
  }
  if (o instanceof Error) {
    return {
      name: o.name,
      message: o.message,
      stack: o.stack,
    };
  }
  return `<Class ${o.constructor.name}>`;
}

function snapshot(node: BaseNode, data = null as any) {
  return deepClone({
    classes: getClassChain(node),
    id: node.id,
    // @ts-ignore
    params: toCopyable(node._params),
    // @ts-ignore
    shared_id: node._shared.id,
    // @ts-ignore
    shared: toCopyable(node._shared.data),
    data,
    timestamp: new Date().toISOString(),
  });
}

export class Inspector {
  constructor(readonly shared: IShared) {}

  async collect<N extends BaseNode>(node: N, fn: (n: BaseNode) => any) {
    this.inject(node);
    const events = [] as any[];
    const collectEvent = (event: Events) =>
      this.shared.on(event, (params) => {
        events.push({ event, ...params });
      });
    const offs = [
      "run_start",
      "run_end",
      "prep_start",
      "prep_result",
      "post_start",
      "post_result",
      "exec_start",
      "exec_result",
      "orchestrate_start",
      "orchestrate_end",
    ].map(collectEvent);
    try {
      await fn(node);
    } finally {
      offs.forEach((cb) => cb());
    }
    return events;
  }

  inject(node: BaseNode) {
    walk(node, (node) => {
      if (node["__injected__"]) return { stop: true };
      this.injectNode(node);
      return {};
    });
  }

  protected injectNode(node: BaseNode) {
    const { shared } = this;
    const { prep: o_prep, exec: o_exec, post: o_post, _run: o_run } = node;
    node["__injected__"] = true;

    node.prep = async function () {
      shared.emit("prep_start", snapshot(this));
      const prepRes = await o_prep.call(this);
      shared.emit("prep_result", snapshot(this, prepRes));
      return prepRes;
    };
    node.exec = async function (prepRes) {
      shared.emit("exec_start", snapshot(this, prepRes));
      const execRes = await o_exec.call(this, prepRes);
      shared.emit("exec_result", snapshot(this, execRes));
      return execRes;
    };
    node.post = async function (prepRes, execRes) {
      shared.emit("post_start", snapshot(this, { prepRes, execRes }));
      const postRes = await o_post.call(this, prepRes, execRes);
      shared.emit("post_result", snapshot(this, postRes));
      return postRes;
    };
    node._run = async function () {
      shared.emit("run_start", snapshot(this));
      const a = await o_run.call(this);
      shared.emit("run_end", snapshot(this, a));
      return a;
    };

    if (is_flow_node(node)) {
      const { _orchestrate: o_orchestrate } = node as any;
      // @ts-ignore
      node._orchestrate = async function (params) {
        shared.emit("orchestrate_start", snapshot(this, params));
        await o_orchestrate.call(this);
        shared.emit("orchestrate_end", snapshot(this));
      };
    }
  }
}
