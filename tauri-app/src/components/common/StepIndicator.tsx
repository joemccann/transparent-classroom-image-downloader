import { motion } from "framer-motion";

interface Props {
  steps: string[];
  current: number;
}

export function StepIndicator({ steps, current }: Props) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((_, i) => (
        <motion.div
          key={i}
          className={`step-dot ${
            i === current
              ? "step-dot-active"
              : i < current
                ? "step-dot-complete"
                : "step-dot-inactive"
          }`}
          layout
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      ))}
    </div>
  );
}
