'use client';
import React, { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';

interface CodeEditorProps {
  code: string;
  onChange: (value: string) => void;
  language?: string;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ code, onChange, language = 'html' }) => {
  const editorRef = useRef<any>(null);

  useEffect(() => {
    console.log('CodeEditor received new code prop:', code);
    if (editorRef.current && code !== editorRef.current.getValue()) {
      console.log('Manually setting editor value to:', code);
      editorRef.current.setValue(code);
    }
  }, [code]);

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
  };

  return (
    <div className="h-full w-full border border-purple-600/50 rounded-lg overflow-hidden bg-gray-900/80 backdrop-blur-lg shadow-sm">
      <Editor
        height="100%"
        defaultLanguage={language}
        value={code}
        onChange={(value) => onChange(value || '')}
        onMount={handleEditorDidMount}
        theme="vs-dark"
        options={{
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 14,
          wordWrap: 'on',
          automaticLayout: true,
          readOnly: false,
          lineNumbers: 'on',
          cursorStyle: 'line',
          overviewRulerLanes: 0,
        }}
      />
    </div>
  );
};

export default CodeEditor;