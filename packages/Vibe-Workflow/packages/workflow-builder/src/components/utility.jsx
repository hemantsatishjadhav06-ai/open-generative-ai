// Shared builder data. The model lists for text, image, video and audio
// nodes come from the server (GET /api/workflow/<id>/node-schemas, built from
// Aquora's model catalog); only the two utility nodes and the starter presets
// are defined here.
import { currentLocale } from "./i18n";
import { downloadFile } from "./gatewayClient";

export { downloadFile };

export const concatModels = [
  {
    id: "prompt-concatenator",
    name: "Prompt Concatenator",
    input_params: {
      properties: {
        "prompt": {
          "examples": [
            ""
          ],
          "description": "Joined text from the connected steps.",
          "type": "string",
          "title": "Prompt",
          "name": "prompt"
        }
      },
      required: ["prompt"],
    }
  }
];

export const videoCombinerModels = [
  {
    id: "video-combiner",
    name: "Video Combiner",
    input_params: {
      properties: {
        "videos_list": {
          "examples": [],
          "description": "Clips joined in order. The result uses the size of the first clip.",
          "field": "videos_list",
          "type": "array",
          "items": {
            "type": "string"
          },
          "title": "Video Clips",
          "name": "videos_list",
          "maxItems": 20
        }
      },
      required: ["videos_list"],
    }
  }
];

const EDGE = {
  blue: { stroke: "#3b82f6", strokeWidth: 2 },
  green: { stroke: "#22c55e", strokeWidth: 2 },
  yellow: { stroke: "#eab308", strokeWidth: 2 },
};

function inputText(id, prompt, position) {
  return {
    id,
    position,
    type: "textNode",
    data: {
      selectedModel: { id: "text-passthrough", name: "Input Text" },
      formValues: { prompt },
      outputs: [{ type: "text", value: prompt }],
      resultUrl: prompt,
    },
  };
}

function step(id, type, model, name, formValues, position) {
  return {
    id,
    position,
    type,
    data: { selectedModel: { id: model, name }, formValues, outputs: [], resultUrl: null },
  };
}

// Starter workflows for an empty canvas (the same flows as the server's
// Templates tab). No demo media: steps that need a file start empty.
const PRESETS = [
  {
    id: "empty-workflow",
    icon: "plus",
    title: { en: "Empty Workflow", zh: "空白工作流" },
    description: { en: "", zh: "" },
    nodes: [],
    edges: [],
  },
  {
    id: "image-generator",
    icon: "image",
    title: { en: "Image Generator & Editor", zh: "图片生成与编辑" },
    description: {
      en: "Generate an image from a prompt, then refine it with an edit instruction (Wan 2.5).",
      zh: "先用提示词生成图片，再用编辑指令优化（Wan 2.5）。",
    },
    nodes: [
      inputText("text1", "Ultra-detailed cinematic portrait of a futuristic engineer inside a holographic command center, floating translucent UI panels, blue and violet light, shallow depth of field, photorealistic.", { x: -69, y: 22 }),
      step("image1", "imageNode", "wan2.5-text-to-image", "Wan 2.5", { width: 1024, height: 1024 }, { x: 370, y: 250 }),
      inputText("text2", "Make the lighting more cinematic with a stronger rim light and soft volumetric fog; keep the subject and the photorealistic style.", { x: 390, y: -235 }),
      step("image2", "imageNode", "wan2.5-image-edit", "Wan2.5 Image Edit", { width: 2048, height: 2048, make_output: true }, { x: 835, y: 25 }),
    ],
    edges: [
      { id: "e1-1", source: "text1", target: "image1", sourceHandle: "textOutput", targetHandle: "imageInput", style: EDGE.blue },
      { id: "e1-2", source: "image1", target: "image2", sourceHandle: "imageOutput", targetHandle: "imageInput2", style: EDGE.green },
      { id: "e1-3", source: "text2", target: "image2", sourceHandle: "textOutput", targetHandle: "imageInput", style: EDGE.blue },
    ],
  },
  {
    id: "video-generator",
    icon: "video",
    title: { en: "Scene to Video", zh: "场景转视频" },
    description: {
      en: "Design a still with Seedream 4.5, then animate it with Seedance Lite.",
      zh: "用 Seedream 4.5 生成画面，再用 Seedance Lite 让它动起来。",
    },
    nodes: [
      inputText("text1", "Wide cinematic shot of a glowing futuristic city built from floating geometric shapes, neon blue and purple light, soft volumetric fog, dramatic sky.", { x: -14, y: -426 }),
      step("image1", "imageNode", "bytedance-seedream-v4.5", "Seedream 4.5", { aspect_ratio: "16:9" }, { x: 330, y: -420 }),
      inputText("text2", "Slow cinematic push-in with subtle parallax; holographic elements gently pulse, light rays drift through the fog.", { x: -9, y: 30 }),
      step("video1", "videoNode", "seedance-lite-i2v", "Seedance Lite I2V", { resolution: "720p", duration: 5, make_output: true }, { x: 760, y: -154 }),
    ],
    edges: [
      { id: "e2-1", source: "text1", target: "image1", sourceHandle: "textOutput", targetHandle: "imageInput", style: EDGE.blue },
      { id: "e2-2", source: "text2", target: "video1", sourceHandle: "textOutput", targetHandle: "videoInput", style: EDGE.blue },
      { id: "e2-3", source: "image1", target: "video1", sourceHandle: "imageOutput", targetHandle: "videoInput2", style: EDGE.green },
    ],
  },
  {
    id: "audio-generator",
    icon: "audio",
    title: { en: "Script to Voiceover", zh: "脚本转配音" },
    description: {
      en: "Turn a script into a natural voiceover with MiniMax Speech.",
      zh: "用 MiniMax Speech 把脚本变成自然的配音。",
    },
    nodes: [
      inputText("text1", "Three tips for better phone videos: shoot in daylight, keep the camera steady, and get closer to your subject.", { x: -9, y: 30 }),
      step("audio1", "audioNode", "minimax-speech-2.6-hd", "Minimax Speech HD", { voice_id: "Friendly_Person", make_output: true }, { x: 400, y: 100 }),
    ],
    edges: [
      { id: "e3-1", source: "text1", target: "audio1", sourceHandle: "textOutput", targetHandle: "audioInput2", style: EDGE.blue },
    ],
  },
  {
    id: "talking-avatar",
    icon: "video",
    title: { en: "Script → Voice → Talking Video", zh: "脚本 → 配音 → 口播视频" },
    description: {
      en: "Write a script, voice it, and lip-sync a portrait you upload (OmniHuman 1.5).",
      zh: "写脚本、生成配音，再让你上传的人像对口型说话（OmniHuman 1.5）。",
    },
    nodes: [
      inputText("text1", "Hi! Today I will show you the one editing trick that makes every video feel more professional.", { x: -20, y: -120 }),
      step("audio1", "audioNode", "minimax-speech-2.6-turbo", "Minimax Speech Turbo", { voice_id: "Friendly_Person" }, { x: 380, y: -160 }),
      step("image1", "imageNode", "image-passthrough", "Input Image", {}, { x: -20, y: 260 }),
      step("video1", "videoNode", "omnihuman-1-5", "OmniHuman 1.5", { make_output: true }, { x: 800, y: 60 }),
    ],
    edges: [
      { id: "e4-1", source: "text1", target: "audio1", sourceHandle: "textOutput", targetHandle: "audioInput2", style: EDGE.blue },
      { id: "e4-2", source: "audio1", target: "video1", sourceHandle: "audioOutput", targetHandle: "videoInput5", style: EDGE.yellow },
      { id: "e4-3", source: "image1", target: "video1", sourceHandle: "imageOutput", targetHandle: "videoInput2", style: EDGE.green },
    ],
  },
  {
    id: "captioning",
    icon: "text",
    needsText: true,
    title: { en: "Describe an Image", zh: "图片描述" },
    description: {
      en: "Upload an image and get a detailed prompt you can reuse in any image model.",
      zh: "上传一张图片，得到可在任意图片模型中复用的详细提示词。",
    },
    nodes: [
      step("image1", "imageNode", "image-passthrough", "Input Image", {}, { x: 0, y: 100 }),
      inputText("text2", "Describe this image as a detailed prompt: subject, setting, colours, textures, lighting, camera and mood.", { x: -2, y: -335 }),
      step("text1", "textNode", "llm-vision", "Vision (describe images)", { make_output: true }, { x: 432, y: -110 }),
    ],
    edges: [
      { id: "e5-1", source: "image1", target: "text1", sourceHandle: "imageOutput", targetHandle: "textInput2", style: EDGE.green },
      { id: "e5-2", source: "text2", target: "text1", sourceHandle: "textOutput", targetHandle: "textInput", style: EDGE.blue },
    ],
  },
];

// Presets for the current page language. `textModels: false` hides the ones
// that need an LLM step when text generation isn't configured.
export function getPresets({ textModels = true } = {}) {
  const locale = currentLocale();
  return PRESETS
    .filter((preset) => textModels || !preset.needsText)
    .map((preset) => ({
      ...preset,
      title: preset.title[locale] || preset.title.en,
      description: preset.description[locale] ?? preset.description.en,
      image: "",
      nodes: preset.nodes.map((node) => ({ ...node, data: { ...node.data, formValues: { ...node.data.formValues } } })),
      edges: preset.edges.map((edge) => ({ ...edge })),
    }));
}
