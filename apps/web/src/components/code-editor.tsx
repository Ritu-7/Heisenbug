"use client";

import { useRef, useCallback } from "react";
import MonacoEditor, { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useTheme } from "@/lib/use-theme";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: string;
  filename?: string;
  readOnly?: boolean;
  height?: string;
}

export function CodeEditor({
  value,
  onChange,
  language = "javascript",
  filename = "charge.js",
  readOnly = false,
  height = "100%",
}: CodeEditorProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  // Live-tracking theme via MutationObserver — updates Monaco immediately when
  // the user toggles the site theme, even with the editor open.
  const { isDark } = useTheme();
  const monacoTheme = isDark ? "vs-dark" : "light";

  const handleMount: OnMount = useCallback(
    (editor) => {
      editorRef.current = editor;
      editor.focus();
    },
    [],
  );

  // Loading state background matches current theme so there's no flash
  const loadingBg = isDark ? "#1e1e1e" : "#fffffe";
  const loadingText = isDark ? "text-neutral-500" : "text-neutral-400";

  return (
    <div className="h-full w-full overflow-hidden" data-filename={filename}>
      <MonacoEditor
        height={height}
        language={language}
        value={value}
        theme={monacoTheme}
        onChange={(val) => onChange(val ?? "")}
        onMount={handleMount}
        options={{
          readOnly,
          fontSize: 13,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontLigatures: true,
          lineHeight: 22,
          tabSize: 2,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "off",
          padding: { top: 16, bottom: 16 },
          renderLineHighlight: "line",
          cursorBlinking: "smooth",
          contextmenu: false,
          automaticLayout: true,
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        }}
        loading={
          <div
            className="flex h-full items-center justify-center"
            style={{ background: loadingBg }}
          >
            <span className={`text-xs font-mono ${loadingText}`}>Loading editor...</span>
          </div>
        }
      />
    </div>
  );
}
