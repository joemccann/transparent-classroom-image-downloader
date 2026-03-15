import { useState } from "react";
import { motion } from "framer-motion";
import { useApp } from "../state/app";
import type { ChildConfig } from "../types";

export function Onboarding() {
  const { setScreen, setSettings, settings } = useApp();

  const [schoolId, setSchoolId] = useState(settings?.school_id ?? "");
  const [children, setChildren] = useState<ChildConfig[]>(
    settings?.children?.length ? settings.children : [{ id: "", name: "" }]
  );
  const [error, setError] = useState<string | null>(null);

  const addChild = () => setChildren([...children, { id: "", name: "" }]);

  const updateChild = (index: number, field: keyof ChildConfig, value: string) => {
    const updated = [...children];
    updated[index] = { ...updated[index], [field]: value };
    setChildren(updated);
  };

  const removeChild = (index: number) => {
    if (children.length <= 1) return;
    setChildren(children.filter((_, i) => i !== index));
  };

  const handleNext = () => {
    setError(null);

    if (!schoolId.trim()) {
      setError("School ID is required");
      return;
    }

    const validChildren = children.filter((c) => c.id.trim() && c.name.trim());
    if (validChildren.length === 0) {
      setError("At least one child with both name and ID is required");
      return;
    }

    setSettings({
      school_id: schoolId.trim(),
      children: validChildren,
      output_dir: settings?.output_dir ?? "",
      concurrency: settings?.concurrency ?? 3,
      safe_mode: settings?.safe_mode ?? false,
    });

    setScreen("destination");
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex h-full flex-col"
    >
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tighter text-zinc-50">
          Setup
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Enter your Transparent Classroom school and children info.
        </p>
      </div>

      <div className="flex-1 space-y-6">
        {/* School ID */}
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            School ID
          </label>
          <input
            type="text"
            className="input-inset"
            placeholder="e.g. 2521"
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
          />
          <p className="mt-1 text-xs text-zinc-600">
            Found in your TC URL: transparentclassroom.com/s/<strong>2521</strong>/...
          </p>
        </div>

        {/* Children */}
        <div>
          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-zinc-500">
            Children
          </label>
          <div className="space-y-3">
            {children.map((child, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="text"
                  className="input-inset flex-1"
                  placeholder="Name"
                  value={child.name}
                  onChange={(e) => updateChild(i, "name", e.target.value)}
                />
                <input
                  type="text"
                  className="input-inset w-32"
                  placeholder="Child ID"
                  value={child.id}
                  onChange={(e) => updateChild(i, "id", e.target.value)}
                />
                {children.length > 1 && (
                  <button
                    onClick={() => removeChild(i)}
                    className="rounded-lg px-2 text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-400"
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={addChild}
            className="mt-2 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-300"
          >
            + Add another child
          </button>
          <p className="mt-1 text-xs text-zinc-600">
            Child ID is in the URL: .../children/<strong>322263</strong>/...
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
        )}
      </div>

      <div className="mt-8 flex justify-end">
        <button onClick={handleNext} className="btn-primary">
          Next
        </button>
      </div>
    </motion.div>
  );
}
