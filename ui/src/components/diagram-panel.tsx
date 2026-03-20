import { DiagramRenderer } from "@/components/diagram-renderer";

interface DiagramPanelProps {
  title: string;
  definition: string;
}

export function DiagramPanel({ title, definition }: DiagramPanelProps) {
  return (
    <div className="bg-surface border border-border rounded-md overflow-hidden">
      <div className="flex items-center justify-between px-[var(--s4)] py-[var(--s3)] border-b border-border">
        <span className="text-[13px] font-semibold text-text-secondary uppercase tracking-wider">
          {title}
        </span>
      </div>
      <div className="p-[var(--s5)] overflow-x-auto min-h-[120px]">
        <DiagramRenderer definition={definition} className="flex justify-center [&_svg]:max-w-full" />
      </div>
    </div>
  );
}
