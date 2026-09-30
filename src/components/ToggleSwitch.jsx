import React from "react";

// iOS-style pill toggle — replaces the plain <input type="checkbox"> used for
// on/off settings (接地する, etc.) with something visually consistent with the
// rest of the app's custom-styled controls instead of the browser's native box.
export default function ToggleSwitch({ checked, onChange, label, disabled = false }) {
  return (
    <label
      className="flex items-center gap-2 select-none"
      style={{ cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}
      onClick={() => !disabled && onChange(!checked)}
    >
      {/* focusable and operable from the keyboard (Space / Enter), like a native
          checkbox — before, the switch could only be clicked */}
      <span
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (disabled || (e.key !== " " && e.key !== "Enter")) return;
          e.preventDefault();
          onChange(!checked);
        }}
        className="toggle-switch"
        style={{
          width: "36px",
          height: "20px",
          borderRadius: "10px",
          background: checked ? "var(--highlight)" : "var(--border)",
          position: "relative",
          flexShrink: 0,
          transition: "background-color 150ms ease",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "2px",
            left: checked ? "18px" : "2px",
            width: "16px",
            height: "16px",
            borderRadius: "50%",
            background: checked ? "#12203a" : "var(--text-primary)",
            transition: "left 150ms ease",
          }}
        />
      </span>
      {label && (
        <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
          {label}
        </span>
      )}
    </label>
  );
}
