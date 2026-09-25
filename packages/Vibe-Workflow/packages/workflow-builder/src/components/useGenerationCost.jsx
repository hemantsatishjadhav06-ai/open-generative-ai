import { useState, useEffect } from "react";
import { api } from "./gatewayClient";

// Estimated USD for one run of the selected model with the current fields
// (POST /api/app/calculate_dynamic_cost). null hides the badge: input steps,
// text steps (billed by usage) and anything the price table doesn't know.
export const useGenerationCost = (selectedModel, formValues) => {
  const [generationCost, setGenerationCost] = useState(null);
  const [isRefreshingCost, setIsRefreshingCost] = useState(false);

  useEffect(() => {
    if (!selectedModel?.id || selectedModel.id.includes("passthrough")) {
      setGenerationCost(null);
      return;
    }

    let cancelled = false;
    const delayDebounce = setTimeout(() => {
      setIsRefreshingCost(true);
      api.post("/api/app/calculate_dynamic_cost", {
        task_name: selectedModel.id,
        payload: formValues
      }, { silent: true })
      .then((response) => {
        if (cancelled) return;
        const cost = Number(response.data?.cost);
        setGenerationCost(response.data?.cost !== null && Number.isFinite(cost) ? Math.round(cost * 1000) / 1000 : null);
        setIsRefreshingCost(false);
      })
      .catch(() => {
        if (cancelled) return;
        setGenerationCost(null);
        setIsRefreshingCost(false);
      });
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(delayDebounce);
    };
  }, [selectedModel?.id, formValues]);

  return { generationCost, isRefreshingCost };
};
