import { Fragment, type ReactNode } from "react";

/** "I accept the {terms} and the {privacy}." with each placeholder replaced by a node (a link). */
export function withLinks(template: string, nodes: Record<string, ReactNode>): ReactNode {
  return template.split(/(\{\w+\})/g).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return <Fragment key={i}>{m && m[1]! in nodes ? nodes[m[1]!] : part}</Fragment>;
  });
}
