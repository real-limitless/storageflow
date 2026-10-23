import * as React from "react";
import { type VariantProps } from "class-variance-authority";

import { buttonVariants } from "./button";
import {
  CommandDialog as CommandDialogPrimitive,
  CommandInput as CommandInputPrimitive,
  CommandList as CommandListPrimitive,
  CommandEmpty as CommandEmptyPrimitive,
  CommandGroup as CommandGroupPrimitive,
  CommandItem as CommandItemPrimitive,
} from "./command";
import { ScrollArea as ScrollAreaPrimitive } from "./scroll-area";

export * from "./alert-dialog";
export * from "./badge";
export * from "./button";
export * from "./card";
export * from "./checkbox";
export * from "./context-menu";
export * from "./dialog";
export * from "./dropdown-menu";
export * from "./input";
export * from "./label";
export * from "./select";
export * from "./separator";
export * from "./sheet";
export * from "./tabs";
export * from "./textarea";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function ScrollArea({ className, children }: { className?: string; children: React.ReactNode }) {
  return <ScrollAreaPrimitive className={className}>{children}</ScrollAreaPrimitive>;
}

export function CommandDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <CommandDialogPrimitive open={open} onOpenChange={onOpenChange} title="Command palette">
      {children}
    </CommandDialogPrimitive>
  );
}

export function CommandInput(props: React.ComponentProps<typeof CommandInputPrimitive>) {
  return <CommandInputPrimitive {...props} />;
}

export function CommandList(props: React.ComponentProps<typeof CommandListPrimitive>) {
  return <CommandListPrimitive {...props} />;
}

export function CommandEmpty(props: React.ComponentProps<typeof CommandEmptyPrimitive>) {
  return <CommandEmptyPrimitive {...props} />;
}

export function CommandGroup(props: React.ComponentProps<typeof CommandGroupPrimitive>) {
  return <CommandGroupPrimitive {...props} />;
}

export function CommandItem(props: React.ComponentProps<typeof CommandItemPrimitive>) {
  return <CommandItemPrimitive {...props} />;
}
