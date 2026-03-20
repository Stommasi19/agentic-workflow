"use client";

import { useState } from "react";

interface CopyButtonProps {
  text: string;
}

export function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="text-xs font-medium px-[var(--s3)] py-[var(--s1)] rounded-xs bg-[rgba(255,255,255,0.06)] border border-border text-text-secondary cursor-pointer transition-all duration-150 hover:bg-[rgba(255,255,255,0.10)] hover:text-text-primary"
    >
      {copied ? "Copied!" : "Copy ID"}
    </button>
  );
}
