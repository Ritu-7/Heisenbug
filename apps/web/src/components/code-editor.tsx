"use client";

import { useRef, useCallback } from "react";
import MonacoEditor, { OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

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

  const handleMount: OnMount = useCallback(
    (editor) => {
      editorRef.current = editor;
      // Focus editor on mount
      editor.focus();
    },
    [],
  );

  return (
    <div className="h-full w-full overflow-hidden" data-filename={filename}>
      <MonacoEditor
        height={height}
        language={language}
        value={value}
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
          theme: "vs-dark",
          padding: { top: 16, bottom: 16 },
          renderLineHighlight: "line",
          cursorBlinking: "smooth",
          contextmenu: false,
          automaticLayout: true,
          // Disable Run/Submit keyboard shortcuts (those need Docker)
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
          },
        }}
        loading={
          <div className="flex h-full items-center justify-center bg-[#1e1e1e]">
            <span className="text-xs font-mono text-neutral-500">Loading editor...</span>
          </div>
        }
      />
    </div>
  );
}
