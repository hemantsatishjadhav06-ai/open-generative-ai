import { SEEDANCE_MODEL_GROUP } from "./seedanceModels.js";
import { VEO_MODEL_GROUP } from "./veoModels.js";
import { MINIMAX_MODEL_GROUP } from "./minimaxModels.js";
import { ALIBABA_MODEL_GROUP } from "./alibabaModels.js";
import { HAPPY_HORSE_MODEL_GROUP } from "./happyHorseModels.js";
import { KLING_MODEL_GROUP } from "./klingModels.js";
import { VIDU_MODEL_GROUP } from "./viduModels.js";
import { PIXVERSE_MODEL_GROUP } from "./pixverseModels.js";
import { LTX_MODEL_GROUP } from "./ltxModels.js";
import { SORA_MODEL_GROUP } from "./soraModels.js";
import { XAI_MODEL_GROUP } from "./xaiModels.js";
import { getModelAvailability, isModelAvailable } from "./modelAvailability.js";

const groups = [SEEDANCE_MODEL_GROUP, VEO_MODEL_GROUP, MINIMAX_MODEL_GROUP, ALIBABA_MODEL_GROUP, HAPPY_HORSE_MODEL_GROUP, KLING_MODEL_GROUP, VIDU_MODEL_GROUP, PIXVERSE_MODEL_GROUP, LTX_MODEL_GROUP, SORA_MODEL_GROUP, XAI_MODEL_GROUP];
const groupByFamilyId = new Map();
const configurationByModelId = new Map();
const familyNames = {};
const workflowVariants = {};
const EMPTY_OPTIONS = Object.freeze([]);

// Register providers once. Model selection does not scan providers or the catalog.
for (const group of groups) {
  Object.assign(familyNames, group.familyNames);
  Object.assign(workflowVariants, group.workflowVariants);
  for (const familyId of Object.keys(group.familyNames)) groupByFamilyId.set(familyId, group);
  for (const [modelId, configuration] of group.configurations) {
    configurationByModelId.set(modelId, configuration);
  }
}

export const GROUPED_VIDEO_FAMILY_NAMES = Object.freeze(familyNames);
export const GROUPED_VIDEO_WORKFLOW_VARIANTS = Object.freeze(workflowVariants);

export function getGroupedVideoConfiguration(modelId) {
  return configurationByModelId.get(modelId) || null;
}

export function getGroupedVideoCopyKey(familyId) {
  return groupByFamilyId.get(familyId)?.copyKey;
}

export function resolveGroupedVideoVariant(options) {
  return groupByFamilyId.get(options.familyId)?.resolveVariant(options) ?? null;
}

const modelIdsByWorkflow = new Map();

// Every grouped model id registered for a family's workflow (null = text only).
export function getGroupedVideoWorkflowModelIds(familyId, workflowId = null) {
  const key = `${familyId}\u0000${workflowId}`;
  let modelIds = modelIdsByWorkflow.get(key);
  if (!modelIds) {
    modelIds = Object.freeze([...configurationByModelId]
      .filter(([, config]) => config.familyId === familyId && config.workflowIds.includes(workflowId))
      .map(([modelId]) => modelId));
    modelIdsByWorkflow.set(key, modelIds);
  }
  return modelIds;
}

// False when the gateway can run none of a workflow's variants (the studio
// then hides that mode).
export function hasAvailableGroupedVariant(familyId, workflowId = null) {
  return getGroupedVideoWorkflowModelIds(familyId, workflowId).some((modelId) => isModelAvailable(modelId));
}

// Facet choices (e.g. a "Spicy" profile) only list values the gateway can
// run for this workflow; a facet left with a single value is dropped.
export function getGroupedVideoVariantOptions(familyId, workflowId, modelId) {
  const fields = groupByFamilyId.get(familyId)?.getVariantOptions(familyId, workflowId, modelId) ?? EMPTY_OPTIONS;
  if (!getModelAvailability() || fields.length === 0) return fields;
  const available = getGroupedVideoWorkflowModelIds(familyId, workflowId)
    .filter((candidate) => isModelAvailable(candidate))
    .map((candidate) => configurationByModelId.get(candidate));
  return fields
    .map((field) => ({
      ...field,
      options: field.options.filter((option) =>
        available.some((config) => config?.[field.key] === option.value)),
    }))
    .filter((field) => field.options.length > 1);
}
