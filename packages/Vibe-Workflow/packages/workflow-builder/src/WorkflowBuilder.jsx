"use client"

import React from "react";
import { ReactFlowProvider } from "reactflow";
import NodeFlow from "./components/NodeFlow";

// `apiKey` is accepted for compatibility and ignored: requests use the
// Aquora session cookie.
export default function Home({
  initialNodeSchemas,
  initialWorkflowData,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
}) {
  return (
    <div className="flex flex-col items-center justify-center h-screen w-full">
      <ReactFlowProvider>
        <NodeFlow
          initialNodeSchemas={initialNodeSchemas}
          initialWorkflowData={initialWorkflowData}
          onGenerationStart={onGenerationStart}
          onGenerationEnd={onGenerationEnd}
          onGenerationComplete={onGenerationComplete}
          onGenerationError={onGenerationError}
        />
      </ReactFlowProvider>
    </div>
  );
}
