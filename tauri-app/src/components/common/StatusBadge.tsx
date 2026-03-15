interface Props {
  status: "idle" | "running" | "success" | "error" | "warning";
  label: string;
}

const colors = {
  idle: "bg-zinc-800 text-zinc-400",
  running: "bg-indigo-950 text-indigo-300 border-indigo-800",
  success: "bg-emerald-950 text-emerald-300 border-emerald-800",
  error: "bg-red-950 text-red-300 border-red-800",
  warning: "bg-amber-950 text-amber-300 border-amber-800",
};

export function StatusBadge({ status, label }: Props) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${colors[status]}`}
    >
      {status === "running" && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
        </span>
      )}
      {status === "success" && <span>&#10003;</span>}
      {status === "error" && <span>&#10007;</span>}
      {label}
    </span>
  );
}
