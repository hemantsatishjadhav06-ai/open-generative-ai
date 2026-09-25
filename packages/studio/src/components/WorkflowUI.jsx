"use client";

import React, { useEffect } from "react";
import { WorkflowBuilder } from "workflow-builder";
import "reactflow/dist/style.css";
import "react-toastify/dist/ReactToastify.css";

// The node canvas. It talks to /api/workflow/* itself with the session
// cookie, so no key or token is passed in.
const WorkflowUI = ({
  initialNodeSchemas,
  initialWorkflowData,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
}) => {
  useEffect(() => {
    sessionStorage.setItem("fromWorkflowBuilder", "true");
  }, []);

  return (
    <div className="w-full h-full bg-black">
      <WorkflowBuilder
        initialNodeSchemas={initialNodeSchemas}
        initialWorkflowData={initialWorkflowData}
        onGenerationStart={onGenerationStart}
        onGenerationEnd={onGenerationEnd}
        onGenerationComplete={onGenerationComplete}
        onGenerationError={onGenerationError}
      />
    </div>
  );
};

export default WorkflowUI;
