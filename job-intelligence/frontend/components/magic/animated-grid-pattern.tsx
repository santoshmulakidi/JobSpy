import { cn } from "@/lib/utils";

export function AnimatedGridPattern({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden opacity-70 [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]",
        className,
      )}
    >
      <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] bg-[size:48px_48px]" />
      <div className="absolute inset-x-0 top-1/4 h-px animate-beam bg-gradient-to-r from-transparent via-primary to-transparent" />
    </div>
  );
}
