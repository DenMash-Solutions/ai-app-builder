import { Fragment, cloneElement, isValidElement } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { BaseComponentProps } from "@json-render/react";
import { cn } from "cn";

type StyleRecord = Record<string, string | number>;

export type AnyComponentImpl = (
  ctx: BaseComponentProps<Record<string, unknown>>,
) => ReactNode;

interface StyledElementProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function isStyleRecord(value: unknown): value is StyleRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (entry) => typeof entry === "string" || typeof entry === "number",
  );
}

function applyStyleProps(
  node: ReactNode,
  className: string,
  style: StyleRecord,
): ReactNode {
  if (Array.isArray(node)) {
    let applied = false;
    return node.map((child) => {
      if (applied) return child;
      const next = applyStyleProps(child, className, style);
      applied = next !== child;
      return next;
    });
  }
  if (!isValidElement(node)) return node;

  const props = node.props as StyledElementProps;

  if (node.type === Fragment) {
    return cloneElement(node as ReactElement<StyledElementProps>, {
      children: applyStyleProps(props.children, className, style),
    });
  }

  const nextProps: Record<string, unknown> = {};
  if (className.length > 0) {
    nextProps.className = cn(props.className, className);
  }
  if (Object.keys(style).length > 0) {
    nextProps.style = { ...props.style, ...style };
  }
  if (Object.keys(nextProps).length === 0) return node;
  return cloneElement(node as ReactElement<StyledElementProps>, nextProps);
}

export function withStyleProps(Impl: AnyComponentImpl): AnyComponentImpl {
  return (ctx) => {
    const tree = Impl(ctx);
    const rawClassName = ctx.props.className;
    const className =
      typeof rawClassName === "string" && rawClassName.trim().length > 0
        ? rawClassName
        : "";
    const rawStyle = ctx.props.style;
    const style = isStyleRecord(rawStyle) ? rawStyle : {};
    if (className.length === 0 && Object.keys(style).length === 0) {
      return tree;
    }
    return applyStyleProps(tree, className, style);
  };
}
