export function Beam() {
  return (
    <div aria-hidden="true" className="absolute inset-x-6 top-0 h-px overflow-hidden">
      <div className="h-px w-1/2 animate-beam bg-gradient-to-r from-transparent via-primary to-transparent" />
    </div>
  );
}
