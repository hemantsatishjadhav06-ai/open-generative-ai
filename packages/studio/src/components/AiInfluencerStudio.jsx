"use client";

import { useState, useCallback, useRef } from "react";
import { generateImage, uploadFile } from "../gateway.js";
import { isModelAvailable } from "../modelAvailability.js";
import useModelAvailability from "../useModelAvailability.js";
import { formatErrorMessage } from "../utils/formatError.js";
import MobileGenerationActions, {
  GenerationCopyButtons,
} from "./MobileGenerationActions.jsx";
import en from "../messages/en/aiInfluencerStudio.json";
import zh from "../messages/zh/aiInfluencerStudio.json";
import { resolveCopy } from "../i18nUtils";
import { friendlyError, notifyError } from "../utils/notify.js";

// ── Image generation models ─────────────────────────────────────────────────
// Text-only builds use the text-to-image model; with an uploaded face
// reference the edit model keeps that person's likeness.
const INFLUENCER_MODEL = "nano-banana-pro";
const INFLUENCER_REFERENCE_MODEL = "nano-banana-pro-edit";
const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

// Option tiles are text-only; the tint cycles through the brand palette so
// neighbouring tiles stay distinguishable.
const TILE_TINTS = [
  "from-brand/25 to-pop/10",
  "from-pop/25 to-brand/10",
  "from-brand-600/30 to-surface-card",
  "from-pop-600/30 to-surface-card",
];

const TABS_CONFIG = {
  face: {
    label: "Face",
    subcategories: [
      {
        id: "character_type",
        label: "Character Type",
        options: [
          { id: "human",             label: "Human",             promptVal: "human features" },
          { id: "elf",               label: "Elf",               promptVal: "elf with pointed ears" },
          { id: "alien",             label: "Alien",             promptVal: "alien creature" },
          { id: "amphibian",         label: "Amphibian",         promptVal: "amphibian humanoid" },
          { id: "reptile",           label: "Reptile",           promptVal: "reptilian creature" },
          { id: "mantis",            label: "Mantis",            promptVal: "mantis hybrid character" },
          { id: "bee",               label: "Bee",               promptVal: "bee insect hybrid character" },
          { id: "octopus",           label: "Octopus",           promptVal: "aquatic octopus hybrid" },
          { id: "crocodile",         label: "Crocodile",         promptVal: "crocodile humanoid" },
          { id: "iguana",            label: "Iguana",            promptVal: "iguana humanoid" },
          { id: "lizard",            label: "Lizard",            promptVal: "lizard humanoid" },
          { id: "rhinoceros_beetle", label: "Beetle", promptVal: "rhinoceros beetle humanoid" },
          { id: "ant",               label: "Ant",               promptVal: "ant hybrid character" },
        ],
      },
      {
        id: "gender",
        label: "Gender",
        options: [
          { id: "female",      label: "Female",      promptVal: "female" },
          { id: "male",        label: "Male",        promptVal: "male" },
          { id: "non_binary",  label: "Non-binary",  promptVal: "non-binary character" },
          { id: "trans_man",   label: "Trans Man",   promptVal: "transgender man" },
          { id: "trans_woman", label: "Trans Woman", promptVal: "transgender woman" },
        ],
      },
      {
        id: "ethnicity_origin_base",
        label: "Ethnicity / Origin",
        options: [
          { id: "african",        label: "African",                                  promptVal: "african heritage" },
          { id: "asian",          label: "Asian", promptVal: "East Asian supermodel, Korean K-Pop Idol phenotype" },
          { id: "european",       label: "European",                  promptVal: "Scandinavian Supermodel" },
          { id: "indian",         label: "Indian",                                   promptVal: "south asian indian heritage" },
          { id: "middle_eastern", label: "Middle Eastern",                           promptVal: "middle eastern heritage" },
          { id: "mixed",          label: "Mixed",                                    promptVal: "multiracial mixed heritage" },
        ],
      },
      {
        id: "eye_color",
        label: "Eye Color",
        options: [
          { id: "eye_blue",       label: "Blue",       promptVal: "striking blue eyes" },
          { id: "eye_brown",      label: "Brown",      promptVal: "warm brown eyes" },
          { id: "eye_green",      label: "Green",      promptVal: "emerald green eyes" },
          { id: "eye_amber",      label: "Amber",      promptVal: "amber eyes" },
          { id: "eye_grey",       label: "Grey",       promptVal: "grey eyes" },
          { id: "eye_red",        label: "Red",        promptVal: "red eyes" },
          { id: "eye_purple",     label: "Purple",     promptVal: "violet purple eyes" },
          { id: "eye_black",      label: "Black",      promptVal: "black eyes" },
          { id: "eye_deep_brown", label: "Deep Brown", promptVal: "deep dark brown eyes" },
          { id: "eye_white",      label: "White",      promptVal: "white eyes" },
          { id: "eye_black_void", label: "Solid Black", promptVal: "solid black void eyes" },
          { id: "eye_white_void", label: "Blind / Empty", promptVal: "blind empty white eyes" },
        ],
      },
      {
        id: "eyes_type",
        label: "Eye Type",
        options: [
          { id: "eyes_human",      label: "Human",      promptVal: "normal human eyes" },
          { id: "eyes_reptile",    label: "Reptile",    promptVal: "reptile slit-pupil eyes" },
          { id: "eyes_mechanical", label: "Mechanical", promptVal: "mechanical cyborg eyes" },
        ],
      },
      {
        id: "eyes_details",
        label: "Eye Features",
        options: [
          { id: "eyes_different_colors", label: "Heterochromia", promptVal: "heterochromia different eye colors" },
          { id: "eyes_blind",            label: "Blind Eye",            promptVal: "one cloudy blind eye" },
          { id: "eyes_scarred",          label: "Scarred Eye",          promptVal: "scar running across one eye" },
          { id: "eyes_glowing",          label: "Glowing Eye",          promptVal: "glowing magical eyes" },
        ],
      },
      {
        id: "mouth",
        label: "Mouth & Teeth",
        options: [
          { id: "mouth_small",           label: "Small Mouth",           promptVal: "small delicate mouth" },
          { id: "mouth_large",           label: "Large Mouth",           promptVal: "wide expressive mouth" },
          { id: "mouth_no_teeth",        label: "No Teeth",        promptVal: "no visible teeth" },
          { id: "mouth_different_teeth", label: "Unique Teeth", promptVal: "unusual tooth structure" },
          { id: "mouth_sharp_teeth",     label: "Sharp Teeth",     promptVal: "sharp predatory fangs" },
          { id: "mouth_forked_tongue",   label: "Forked Tongue",   promptVal: "reptilian forked tongue" },
          { id: "mouth_two_tongues",     label: "Two Tongues",     promptVal: "two separate tongues" },
        ],
      },
      {
        id: "ears",
        label: "Ears",
        options: [
          { id: "ears_human", label: "Human", promptVal: "normal human ears" },
          { id: "ears_elf",   label: "Elf Ears",   promptVal: "pointed elf ears" },
          { id: "ears_no",    label: "No Ears",    promptVal: "no visible ears" },
          { id: "ears_wings", label: "Wing Ears", promptVal: "wing ears" },
        ],
      },
      {
        id: "horns",
        label: "Horns",
        options: [
          { id: "small_horns", label: "Small Horns", promptVal: "small horns on forehead" },
          { id: "big_horns",   label: "Big Horns",   promptVal: "large curved horns" },
          { id: "antlers",     label: "Antlers",      promptVal: "deer antlers on head" },
        ],
      },
      {
        id: "skin_conditions",
        label: "Skin Conditions",
        options: [
          { id: "condition_vitiligo",     label: "Vitiligo",     promptVal: "vitiligo skin condition" },
          { id: "condition_pigmentation", label: "Pigmentation", promptVal: "hyperpigmentation" },
          { id: "condition_freckles",     label: "Freckles",     promptVal: "freckled skin" },
          { id: "condition_birthmarks",   label: "Birthmarks",   promptVal: "visible birthmarks" },
          { id: "condition_scars",        label: "Scars",        promptVal: "scarred skin" },
          { id: "condition_burns",        label: "Burns",        promptVal: "burn marks on skin" },
          { id: "condition_albinism",     label: "Albinism",     promptVal: "albinism pale white skin" },
          { id: "condition_cracked",      label: "Cracked Skin",      promptVal: "cracked dry skin texture" },
          { id: "condition_wrinkled",     label: "Wrinkled",     promptVal: "wrinkled aged skin" },
        ],
      },
    ],
  },
  body: {
    label: "Body",
    subcategories: [
      {
        id: "face_skin_material",
        label: "Face Skin Material",
        options: [
          { id: "face_skin_human",     label: "Human Skin",     promptVal: "smooth human skin" },
          { id: "face_skin_scales",    label: "Scales",    promptVal: "shimmering scales" },
          { id: "face_skin_fur",       label: "Fur",       promptVal: "soft fur covered face" },
          { id: "face_skin_amphibian", label: "Amphibian", promptVal: "smooth moist amphibian skin" },
          { id: "face_skin_fish",      label: "Fish Skin",      promptVal: "iridescent fish scale skin" },
          { id: "face_skin_metallic",  label: "Metallic",  promptVal: "polished metallic skin" },
        ],
      },
      {
        id: "face_surface_pattern",
        label: "Skin Pattern",
        options: [
          { id: "face_pattern_solid",    label: "Solid",    promptVal: "solid color skin" },
          { id: "face_pattern_stripes",  label: "Stripes",  promptVal: "exotic striped skin pattern" },
          { id: "face_pattern_spots",    label: "Spots",    promptVal: "dappled spotted skin" },
          { id: "face_pattern_chess",    label: "Chess",    promptVal: "checkerboard skin pattern" },
          { id: "face_pattern_veins",    label: "Veins",    promptVal: "translucent skin with neon veins" },
          { id: "face_pattern_gradient", label: "Gradient", promptVal: "gradient skin coloring" },
          { id: "face_pattern_giraffe",  label: "Giraffe",  promptVal: "giraffe print skin markings" },
        ],
      },
      {
        id: "body_type",
        label: "Body Type",
        options: [
          { id: "body_slim",     label: "Slim",     promptVal: "slim slender physique" },
          { id: "body_lean",     label: "Lean",     promptVal: "lean toned physique" },
          { id: "body_athletic", label: "Athletic", promptVal: "fit athletic body" },
          { id: "body_muscular", label: "Muscular", promptVal: "strong muscular build" },
          { id: "body_curvy",    label: "Curvy",    promptVal: "curvy body type" },
          { id: "body_heavy",    label: "Heavy",    promptVal: "heavy set build" },
          { id: "body_skinny",   label: "Skinny",   promptVal: "very skinny thin build" },
        ],
      },
      {
        id: "left_arm",
        label: "Left Arm",
        options: [
          { id: "left_arm_normal",     label: "Normal",                          promptVal: "normal left arm" },
          { id: "left_arm_cute",       label: "Cute Prosthetic", promptVal: "stylish pink prosthetic left arm with cute stickers" },
          { id: "left_arm_robotic",    label: "Robotic",                         promptVal: "robotic left arm" },
          { id: "left_arm_prosthetic", label: "Prosthetic",                      promptVal: "prosthetic left arm" },
          { id: "left_arm_mechanical", label: "Mechanical",                      promptVal: "mechanical left arm" },
          { id: "left_arm_none",       label: "None",                            promptVal: "no left arm" },
        ],
      },
      {
        id: "right_arm",
        label: "Right Arm",
        options: [
          { id: "right_arm_normal",     label: "Normal",                          promptVal: "normal right arm" },
          { id: "right_arm_cute",       label: "Cute Prosthetic", promptVal: "stylish pink prosthetic right arm with cute stickers" },
          { id: "right_arm_robotic",    label: "Robotic",                         promptVal: "robotic right arm" },
          { id: "right_arm_prosthetic", label: "Prosthetic",                      promptVal: "prosthetic right arm" },
          { id: "right_arm_mechanical", label: "Mechanical",                      promptVal: "mechanical right arm" },
          { id: "right_arm_none",       label: "None",                            promptVal: "no right arm" },
        ],
      },
      {
        id: "left_leg",
        label: "Left Leg",
        options: [
          { id: "left_leg_normal",     label: "Normal",                          promptVal: "normal left leg" },
          { id: "left_leg_cute",       label: "Cute Prosthetic", promptVal: "stylish pink prosthetic left leg with cute stickers" },
          { id: "left_leg_robotic",    label: "Robotic",                         promptVal: "robotic left leg" },
          { id: "left_leg_prosthetic", label: "Prosthetic",                      promptVal: "prosthetic left leg" },
          { id: "left_leg_mechanical", label: "Mechanical",                      promptVal: "mechanical left leg" },
          { id: "left_leg_none",       label: "None",                            promptVal: "no left leg" },
        ],
      },
      {
        id: "right_leg",
        label: "Right Leg",
        options: [
          { id: "right_leg_normal",     label: "Normal",                         promptVal: "normal right leg" },
          { id: "right_leg_cute",       label: "Cute Prosthetic", promptVal: "stylish pink prosthetic right leg with cute stickers" },
          { id: "right_leg_robotic",    label: "Robotic",                        promptVal: "robotic right leg" },
          { id: "right_leg_prosthetic", label: "Prosthetic",                     promptVal: "prosthetic right leg" },
          { id: "right_leg_mechanical", label: "Mechanical",                     promptVal: "mechanical right leg" },
          { id: "right_leg_none",       label: "None",                           promptVal: "no right leg" },
        ],
      },
    ],
  },
  style: {
    label: "Style",
    subcategories: [
      {
        id: "hair",
        label: "Hair / Head Growth",
        options: [
          { id: "hair_bald",      label: "Bald",      promptVal: "bald head" },
          { id: "hair_short",     label: "Short Hair",     promptVal: "short hair" },
          { id: "hair_long",      label: "Long Hair",      promptVal: "long flowing hair" },
          { id: "hair_afro",      label: "Afro",      promptVal: "afro hairstyle" },
          { id: "hair_punk",      label: "Punk",      promptVal: "punk mohawk hairstyle" },
          { id: "hair_fur",       label: "Fur / Mane",       promptVal: "fur mane on head" },
          { id: "hair_tentacles", label: "Tentacles", promptVal: "tentacles as hair" },
          { id: "hair_spines",    label: "Spines",    promptVal: "spines as hair" },
        ],
      },
      {
        id: "accessories",
        label: "Accessories & Markings",
        options: [
          { id: "accessory_tattoos",       label: "Tattoos",       promptVal: "covered in tattoos" },
          { id: "accessory_piercing",      label: "Piercings",      promptVal: "multiple piercings" },
          { id: "accessory_scarification", label: "Scarification", promptVal: "ritual scarification marks" },
          { id: "accessory_symbols",       label: "Symbols / Markings",       promptVal: "symbolic tribal markings" },
          { id: "accessory_cyber",         label: "Cyber Markings",         promptVal: "cyberpunk circuit markings" },
        ],
      },
      {
        id: "rendering_style",
        label: "Rendering Style",
        options: [
          { id: "style_hyper_realistic", label: "Hyper-Realistic",  promptVal: "hyper-realistic 8k photograph" },
          { id: "style_anime",           label: "Anime",    promptVal: "anime art style" },
          { id: "style_cartoon",         label: "Cartoon", promptVal: "cartoon illustration style" },
          { id: "style_2d",              label: "2D Illustration",  promptVal: "2D flat illustration style" },
        ],
      },
    ],
  },
};

// ─── SVG Icon Components ────────────────────────────────────────────────────
const ShuffleIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" />
    <polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" />
  </svg>
);
const BoltIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);
const CheckIcon = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const DownloadIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

// ─── Hover Pill — shows label, reveals image on hover ───────────────────────
function HoverPill({ label, onClick }) {
  return (
    <div className="relative shrink-0">
      {/* Pill */}
      <button
        type="button"
        onClick={onClick}
        className="h-[22px] px-2 rounded-md bg-white/[0.07] hover:bg-white/[0.13] border border-white/[0.10] text-[11px] font-medium text-gray-200 whitespace-nowrap transition-all cursor-pointer"
      >
        {label}
      </button>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function AiInfluencerStudio({
  apiKey,
  onGenerate,
  onGenerationStart,
  onGenerationEnd,
  onGenerationComplete,
  onGenerationError,
  isGenerating: externalIsGenerating,
  locale = "en",
}) {
  const copy = resolveCopy(en, zh, locale);
  const [activeTab, setActiveTab] = useState("face");

  const [selectedOptions, setSelectedOptions] = useState(() => {
    const init = {};
    Object.values(TABS_CONFIG).forEach((tab) =>
      tab.subcategories.forEach((sub) => {
        if (sub.options?.length > 0) init[sub.id] = sub.options[0].id;
      })
    );
    return init;
  });

  const [aspectRatio, setAspectRatio] = useState("3:4");
  const [customPrompt, setCustomPrompt] = useState("");
  const [isGeneratingInternal, setIsGeneratingInternal] = useState(false);
  const [currentResult, setCurrentResult] = useState(null);   // latest generated image
  const [history, setHistory] = useState([]);                  // all generated images
  const [selectedHistoryIdx, setSelectedHistoryIdx] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [referenceUrl, setReferenceUrl] = useState(null);
  const [referenceProgress, setReferenceProgress] = useState(null);
  const referenceInputRef = useRef(null);
  useModelAvailability();
  const activeModel = referenceUrl ? INFLUENCER_REFERENCE_MODEL : INFLUENCER_MODEL;

  const isGenerating = externalIsGenerating || isGeneratingInternal;

  // ── Optional face reference (the person's own photo) ─────────────────────
  const handleReferenceFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      notifyError(copy.reference.notAnImage);
      return;
    }
    if (file.size > MAX_REFERENCE_BYTES) {
      notifyError(copy.reference.tooLarge);
      return;
    }
    setReferenceProgress(0);
    try {
      const url = await uploadFile(apiKey, file, setReferenceProgress);
      setReferenceUrl(url);
    } catch (err) {
      notifyError(copy.reference.uploadFailed.replace("{message}", friendlyError(err)));
    } finally {
      setReferenceProgress(null);
      if (referenceInputRef.current) referenceInputRef.current.value = "";
    }
  };

  // ── Build prompt from selections ──────────────────────────────────────────
  const buildPrompt = useCallback(() => {
    const parts = [];
    Object.values(TABS_CONFIG).forEach((tab) =>
      tab.subcategories.forEach((sub) => {
        const opt = sub.options.find((o) => o.id === selectedOptions[sub.id]);
        if (opt?.promptVal) parts.push(opt.promptVal);
      })
    );
    let prompt = "Ultra-realistic professional portrait photograph of an AI influencer character, 8k resolution, cinematic lighting, sharp detail";
    if (parts.length) prompt += ", " + parts.join(", ");
    if (customPrompt.trim()) prompt += ", " + customPrompt.trim();
    return prompt;
  }, [selectedOptions, customPrompt]);

  // ── Option selection ───────────────────────────────────────────────────────
  const handleOptionSelect = (subcatId, optId) =>
    setSelectedOptions((p) => ({ ...p, [subcatId]: optId }));

  // ── Shuffle all options randomly ───────────────────────────────────────────
  const handleShuffle = () => {
    const next = {};
    Object.values(TABS_CONFIG).forEach((tab) =>
      tab.subcategories.forEach((sub) => {
        if (sub.options?.length > 0)
          next[sub.id] = sub.options[Math.floor(Math.random() * sub.options.length)].id;
      })
    );
    setSelectedOptions(next);
  };

  // ── Generate ──────────────────────────────────────────────────────────────
  const handleGenerate = async () => {
    if (isGenerating) return;
    if (!onGenerate && !isModelAvailable(activeModel)) {
      notifyError(copy.errors.modelUnavailable);
      return;
    }
    onGenerationStart?.();
    setIsGeneratingInternal(true);
    setErrorMsg("");

    const prompt = referenceUrl
      ? `${buildPrompt()}, keep the face and identity of the person in the reference photo`
      : buildPrompt();
    try {
      let res;
      if (onGenerate) {
        res = await onGenerate({ prompt, aspectRatio, selections: selectedOptions });
      } else {
        res = await generateImage(apiKey, {
          model: activeModel,
          prompt,
          aspect_ratio: aspectRatio,
          ...(referenceUrl ? { images_list: [referenceUrl] } : {}),
        });
      }
      if (res?.url) {
        setCurrentResult(res.url);
        setHistory((prev) => [{ url: res.url, prompt, ts: Date.now() }, ...prev]);
        setSelectedHistoryIdx(0);
        onGenerationComplete?.({
          url: res.url,
          model: activeModel,
          prompt,
          type: "image",
        });
      }
    } catch (err) {
      const message = formatErrorMessage(err, copy.errors.generationFailed);
      if (onGenerationError) onGenerationError(message);
      else notifyError(message);
    } finally {
      setIsGeneratingInternal(false);
      onGenerationEnd?.();
    }
  };

  // ── Download helper ───────────────────────────────────────────────────────
  const downloadImg = async (url) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `ai-influencer-${Date.now()}.webp`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      window.open(url, "_blank");
    }
  };

  // Preview image = selected history or current result
  const previewUrl =
    selectedHistoryIdx !== null && history[selectedHistoryIdx]
      ? history[selectedHistoryIdx].url
      : currentResult;

  const arMap = { "3:4": "3/4", "1:1": "1/1", "9:16": "9/16", "16:9": "16/9" };

  // ── Collect all selected options as flat list for the pill tags bar ─────────
  const selectedTags = [];
  Object.keys(TABS_CONFIG).forEach((tabKey) => {
    TABS_CONFIG[tabKey].subcategories.forEach((sub) => {
      const selId = selectedOptions[sub.id];
      const opt = sub.options.find((o) => o.id === selId);
      if (opt) selectedTags.push({ subcatId: sub.id, label: opt.label });
    });
  });

  const [showAllTags, setShowAllTags] = useState(false);
  const TAGS_VISIBLE = 7; // how many pills to show before "show more"

  return (
    <div className="flex flex-col md:flex-row h-full bg-[#0a1422] text-white overflow-y-auto md:overflow-hidden select-none font-sans">

      {/* ════════════════════════════════════════════════════════════
          LEFT — Builder / Options Panel
      ════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col w-full md:w-[320px] h-[45vh] min-h-[320px] md:h-auto md:min-h-0 shrink-0 border-b md:border-b-0 md:border-r border-white/[0.07] bg-[#0f1c2e] overflow-hidden">

        {/* Builder header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07] shrink-0">
          <span className="text-[13px] font-bold text-white tracking-tight">{copy.builder.title}</span>
          <button
            onClick={() => setSelectedOptions((() => {
              const init = {};
              Object.values(TABS_CONFIG).forEach((tab) =>
                tab.subcategories.forEach((sub) => {
                  if (sub.options?.length > 0) init[sub.id] = sub.options[0].id;
                })
              );
              return init;
            })())}
            className="text-[11px] text-gray-400 hover:text-white transition-colors font-medium"
          >
            {copy.builder.reset}
          </button>
        </div>

        {/* Tab pills */}
        <div className="flex gap-1 px-3 py-2 border-b border-white/[0.07] shrink-0">
          {Object.keys(TABS_CONFIG).map((key) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                activeTab === key
                  ? "bg-white text-black shadow"
                  : "text-gray-400 hover:text-white hover:bg-white/[0.06]"
              }`}
            >
              {copy.categoryTabs[key] || TABS_CONFIG[key].label}
            </button>
          ))}
        </div>

        {/* Subcategory options scroll area */}
        <div className="flex-1 overflow-y-auto p-3 space-y-5">
          {TABS_CONFIG[activeTab]?.subcategories?.map((subcat) => (
            <div key={subcat.id}>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-0.5">
                {copy.subcategories[subcat.id] || subcat.label}
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {subcat.options?.map((opt, optIndex) => {
                  const sel = selectedOptions[subcat.id] === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={sel}
                      onClick={() => handleOptionSelect(subcat.id, opt.id)}
                      className={`group relative min-h-[52px] rounded-xl overflow-hidden border bg-gradient-to-br ${TILE_TINTS[optIndex % TILE_TINTS.length]} px-1.5 py-2 flex items-center justify-center text-center transition-all ${
                        sel
                          ? "border-white/80 ring-1 ring-white/30 shadow-lg"
                          : "border-white/[0.08] hover:border-white/25"
                      }`}
                    >
                      <span className="text-[10px] font-semibold text-white leading-tight">{opt.label}</span>
                      {/* Selected check badge */}
                      {sel && (
                        <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-white text-black flex items-center justify-center">
                          <CheckIcon />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════
          CENTER — Current Character Preview
      ════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col flex-1 min-w-0 min-h-[560px] md:min-h-0 overflow-hidden bg-[#0a1422]">

        {/* Center top bar: aspect ratio + generate */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 md:px-6 py-3 border-b border-white/[0.07] shrink-0">
          {/* Aspect ratio */}
          <div className="flex gap-0.5 bg-white/[0.05] border border-white/[0.08] rounded-xl p-1">
            {["3:4", "1:1", "9:16", "16:9"].map((r) => (
              <button
                key={r}
                onClick={() => setAspectRatio(r)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                  aspectRatio === r
                    ? "bg-brand-400 text-black shadow-md shadow-brand-400/40"
                    : "text-gray-400 hover:text-white"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {/* Face reference (optional) */}
            <input
              ref={referenceInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              tabIndex={-1}
              onChange={(e) => handleReferenceFile(e.target.files?.[0])}
            />
            {referenceUrl ? (
              <div className="flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded-xl bg-white/[0.05] border border-brand/40">
                <img src={referenceUrl} alt={copy.reference.alt} className="w-7 h-7 rounded-lg object-cover" />
                <span className="text-[11px] font-semibold text-brand-300 hidden sm:inline">{copy.reference.active}</span>
                <button
                  type="button"
                  onClick={() => setReferenceUrl(null)}
                  aria-label={copy.reference.remove}
                  title={copy.reference.remove}
                  className="w-5 h-5 rounded-md flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => referenceInputRef.current?.click()}
                disabled={referenceProgress !== null}
                title={copy.reference.hint}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08] text-gray-300 hover:text-white hover:bg-white/10 text-[12px] font-semibold transition-all disabled:opacity-60"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
                {referenceProgress !== null
                  ? copy.reference.uploading.replace("{progress}", referenceProgress)
                  : copy.reference.upload}
              </button>
            )}

            {/* Shuffle */}
            <button
              onClick={handleShuffle}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08] text-gray-400 hover:text-white hover:bg-white/10 text-[12px] font-semibold transition-all"
            >
              <ShuffleIcon />
              {copy.toolbar.shuffle}
            </button>

            {/* Generate */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-[13px] font-bold transition-all shadow-lg ${
                isGenerating
                  ? "bg-brand-400/30 text-white/60 cursor-not-allowed"
                  : "bg-gradient-to-r from-brand-400 to-pop-500 hover:from-brand-300 hover:to-pop-400 text-black shadow-brand-400/30 hover:shadow-pop-500/40"
              }`}
            >
              {isGenerating ? (
                <>
                  <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" strokeOpacity="0.3" />
                    <path d="M21 12a9 9 0 00-9-9" />
                  </svg>
                  {copy.toolbar.generating}
                </>
              ) : (
                <><BoltIcon />{copy.toolbar.generate}</>
              )}
            </button>
          </div>
        </div>

        {/* Preview area */}
        <div className="flex-1 flex items-center justify-center p-6 overflow-hidden">
          <div
            className="relative rounded-2xl overflow-hidden bg-[#0f1c2e] border border-white/[0.07] shadow-2xl flex items-center justify-center"
            style={{ aspectRatio: arMap[aspectRatio] ?? "3/4", maxHeight: "100%", maxWidth: "100%" }}
          >
            {isGenerating ? (
              <div className="flex flex-col items-center gap-4 text-center px-8 py-12">
                <div className="w-12 h-12 border-[3px] border-brand-400/20 border-t-brand-400 rounded-full animate-spin" />
                <p className="text-sm text-gray-400 font-medium">{copy.preview.generating}</p>
              </div>
            ) : previewUrl ? (
              <>
                <img src={previewUrl} alt={copy.preview.altGenerated} className="w-full h-full object-cover" />
                {/* Download overlay button */}
                <button
                  onClick={() => downloadImg(previewUrl)}
                  className="absolute bottom-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 text-white text-[11px] font-semibold hover:bg-black/80 transition-all"
                >
                  <DownloadIcon />
                  {copy.preview.save}
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 text-center px-8 py-12">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" className="text-gray-700">
                  <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
                <p className="text-sm text-gray-300 font-medium">{copy.preview.emptyTitle}</p>
                <p className="text-xs text-gray-400">{copy.preview.emptySubtitleLine1}<br />{copy.preview.emptySubtitleLine2}</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Selected option pills ──────────────────────────────────── */}
        {selectedTags.length > 0 && (
          <div className="px-6 pb-3 shrink-0">
            <div className="flex flex-wrap gap-1.5 items-center">
              {(showAllTags ? selectedTags : selectedTags.slice(0, TAGS_VISIBLE)).map((tag) => (
                <HoverPill
                  key={tag.subcatId}
                  label={tag.label}
                  onClick={() => {
                    // Jump builder panel to the tab that owns this subcategory
                    const ownerTab = Object.keys(TABS_CONFIG).find((tk) =>
                      TABS_CONFIG[tk].subcategories.some((s) => s.id === tag.subcatId)
                    );
                    if (ownerTab) setActiveTab(ownerTab);
                  }}
                />
              ))}
              {selectedTags.length > TAGS_VISIBLE && (
                <button
                  type="button"
                  onClick={() => setShowAllTags((v) => !v)}
                  className="h-[22px] px-2 rounded-md bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.08] text-[11px] text-gray-400 hover:text-gray-300 whitespace-nowrap transition-all"
                >
                  {showAllTags ? copy.tags.hide : copy.tags.showMore}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {errorMsg && (
          <div className="mx-6 mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[12px] shrink-0">
            {errorMsg}
          </div>
        )}

        {/* Custom prompt bar at bottom */}
        <div className="px-6 pb-4 shrink-0">
          <input
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder={copy.customPrompt.placeholder}
            className="w-full h-9 bg-surface-card border border-white/[0.07] rounded-xl px-3 text-[12px] text-gray-200 placeholder-gray-600 outline-none focus:border-brand-400/40 transition-colors"
          />
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════
          RIGHT — Generated Characters History Gallery
      ════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col w-full md:w-[160px] shrink-0 border-t md:border-t-0 md:border-l border-white/[0.07] bg-[#0f1c2e] overflow-hidden">

        {/* Gallery header */}
        <div className="px-3 py-3 border-b border-white/[0.07] shrink-0">
          <p className="text-[11px] font-bold text-white tracking-tight">{copy.gallery.title}</p>
          <p className="text-[9px] text-gray-400 mt-0.5">{history.length} {copy.gallery.countSuffix}</p>
        </div>

        {/* Gallery scroll */}
        <div className="flex-1 overflow-y-auto p-2 grid grid-cols-3 md:grid-cols-1 gap-2 content-start">
          {history.length === 0 ? (
            <div className="col-span-3 md:col-span-1 flex flex-col items-center justify-center h-32 text-center px-2">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-gray-700 mb-2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
              </svg>
              <p className="text-[9px] text-gray-400 leading-relaxed">{copy.gallery.emptyText.split('\n')[0]}<br />{copy.gallery.emptyText.split('\n')[1]}</p>
            </div>
          ) : (
            history.map((item, idx) => (
              <div
                key={item.ts}
                className={`group relative w-full aspect-[3/4] rounded-xl overflow-hidden border transition-all ${
                  selectedHistoryIdx === idx
                    ? "border-brand-400 ring-1 ring-brand-400/40"
                    : "border-white/[0.08] hover:border-white/20"
                }`}
              >
                {/* Selecting a result is its own button; the hover actions
                    sit beside it rather than inside it. */}
                <button
                  type="button"
                  onClick={() => setSelectedHistoryIdx(idx)}
                  aria-pressed={selectedHistoryIdx === idx}
                  aria-label={`${copy.gallery.altPrefix} ${history.length - idx}`}
                  className="absolute inset-0 w-full h-full cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
                >
                  <img src={item.url} alt="" className="w-full h-full object-cover" />
                </button>
                {/* Download on hover */}
                <div className="pointer-events-none absolute inset-0 hidden md:flex bg-black/50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity items-end justify-center pb-2">
                  <div className="pointer-events-auto absolute right-2 top-2 flex flex-col gap-2">
                    <GenerationCopyButtons
                      prompt={item.prompt}
                      imageUrl={item.url}
                      onCopyError={onGenerationError}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadImg(item.url)}
                    aria-label={copy.gallery.download}
                    title={copy.gallery.download}
                    className="pointer-events-auto p-1.5 rounded-lg bg-white/10 backdrop-blur-sm border border-white/20 text-white hover:bg-white/20 transition-all cursor-pointer"
                  >
                    <DownloadIcon />
                  </button>
                </div>
                <MobileGenerationActions
                  prompt={item.prompt}
                  imageUrl={item.url}
                  onCopyError={onGenerationError}
                  actions={[
                    {
                      kind: "download",
                      label: copy.gallery.download,
                      onSelect: () => downloadImg(item.url),
                    },
                  ]}
                />
                {/* Index badge */}
                <div aria-hidden="true" className="pointer-events-none absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[8px] text-gray-300 font-bold">
                  #{history.length - idx}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
