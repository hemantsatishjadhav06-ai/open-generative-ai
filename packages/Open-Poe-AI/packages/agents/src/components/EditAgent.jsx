import React, { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { IoChevronBack, IoPencilOutline, IoShareOutline, IoTrashOutline, IoCloseOutline, IoImageOutline, IoSparklesOutline, IoChatbubblesOutline } from "react-icons/io5";
import { BiLoaderAlt } from "react-icons/bi";
import { RiRobot2Fill } from "react-icons/ri";
import toast from "react-hot-toast";
import { FaRegTrashCan } from "react-icons/fa6";
import { MdClose } from "react-icons/md";
import { themes } from "./themes";
import { getAgentCopy, localePath } from "../i18n";
import { AGENTS_API as BASE_URL, errorMessage, uploadImage } from "../utils/api";

// Catalog model used for "Generate with AI" profile icons (fast + cheap).
const ICON_MODEL = "flux-schnell-image";

const sameSkills = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const EditAgent = ({ locale = "en" }) => {
  const copy = getAgentCopy(locale);
  const { id } = useParams();
  const router = useRouter();
  const fileInputRef = useRef(null);
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    system_prompt: "",
    icon_url: "",
    skill_ids: [],
    theme: "cosmic",
  });
  
  const [availableSkills, setAvailableSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState(null);
  const [initialSkills, setInitialSkills] = useState([]);
  const [realignedPrompt, setRealignedPrompt] = useState("");
  const [isRealigning, setIsRealigning] = useState(false);
  const [showRealignModal, setShowRealignModal] = useState(false);
  const [generatingIcon, setGeneratingIcon] = useState(false);
  const [showIconPromptModal, setShowIconPromptModal] = useState(false);
  const [showIconSelectionModal, setShowIconSelectionModal] = useState(false);
  const [iconPrompt, setIconPrompt] = useState("");

  useEffect(() => {
    if (id) {
      fetchData();
    }
  }, [id]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [agentRes, skillsRes] = await Promise.all([
        axios.get(`${BASE_URL}/by-slug/${id}`),
        axios.get(`${BASE_URL}/skills`)
      ]);
      
      const agent = agentRes.data;
      if (!agent.is_owner) {
        setError(copy.errors.templateReadOnly);
        setLoading(false);
        return;
      }
      const skillIds = (agent.skills || []).map(s => s.id);
      setFormData({
        name: agent.name,
        description: agent.description || "",
        system_prompt: agent.system_prompt,
        icon_url: agent.icon_url || "",
        skill_ids: skillIds,
        theme: agent.theme || "cosmic",
      });
      setInitialSkills(skillIds);
      setAvailableSkills(Array.isArray(skillsRes.data) ? skillsRes.data : []);
    } catch (err) {
      setError(errorMessage(err, copy, copy.errors.loadFailed));
    } finally {
      setLoading(false);
    }
  };
  
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSkillToggle = (skillId) => {
    setFormData(prev => {
      const isSelected = prev.skill_ids.includes(skillId);
      if (isSelected) {
        return { ...prev, skill_ids: prev.skill_ids.filter(id => id !== skillId) };
      } else {
        return { ...prev, skill_ids: [...prev.skill_ids, skillId] };
      }
    });
  };

  const handleDelete = async () => {
    if (!window.confirm(copy.edit.confirmDelete)) {
      return;
    }

    try {
      setSaving(true);
      await axios.delete(`${BASE_URL}/by-slug/${id}`);
      toast.success(copy.edit.deleted);
      router.push(localePath(locale, "/agents"));
    } catch (err) {
      toast.error(errorMessage(err, copy, copy.edit.deleteFailed));
    } finally {
      setSaving(false);
    }
  };

  const handleShare = () => {
    const url = `${window.location.origin}${localePath(locale, `/agents/${id}`)}`;
    navigator.clipboard.writeText(url);
    toast.success(copy.edit.linkCopied);
  };

  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    handleFileUpload(e);
  };

  const handleFileUpload = async (eOrFiles) => {
    let file = null;
    if (Array.isArray(eOrFiles)) {
      file = eOrFiles[0];
    } else if (eOrFiles?.dataTransfer?.files && eOrFiles.dataTransfer.files.length > 0) {
      file = eOrFiles.dataTransfer.files[0];
    } else {
      file = eOrFiles?.target?.files?.[0];
    }
    if (!file) return;

    try {
      setUploading(true);
      setUploadProgress(0);
      const uploadedUrl = await uploadImage(file, { copy, onProgress: setUploadProgress });
      setFormData(prev => ({ ...prev, icon_url: uploadedUrl }));
      toast.success(copy.edit.imageUpdated);
    } catch (err) {
      toast.error(err?.message || copy.errors.uploadFailed);
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleGenerateIcon = async (customPrompt) => {
    if (!formData.name && !customPrompt) {
      toast.error(copy.edit.nameFirst);
      return;
    }

    try {
      setGeneratingIcon(true);
      const prompt = customPrompt || `A professional, clean profile icon for an AI agent named "${formData.name}". Description: ${formData.description || "An AI assistant"}. Minimalist, high-quality, circular composition.`;
      
      // Runs synchronously through the gateway (sync:true) → {outputs:[url]}.
      const response = await axios.post(`/api/v1/${ICON_MODEL}`, {
        prompt,
        image_size: "square_hd",
        num_images: 1,
        sync: true
      });

      const generatedUrl = response.data?.outputs?.[0] || response.data?.url;
      if (!generatedUrl) throw new Error(copy.errors.iconFailed);
      setFormData(prev => ({ ...prev, icon_url: generatedUrl }));
      setShowIconPromptModal(false);
      toast.success(copy.edit.iconGenerated);
    } catch (err) {
      toast.error(err?.response ? errorMessage(err, copy, copy.errors.iconFailed) : copy.errors.iconFailed);
    } finally {
      setGeneratingIcon(false);
    }
  };

  const handleRealign = async () => {
    try {
      setIsRealigning(true);
      const res = await axios.post(`${BASE_URL}/by-slug/${id}/preview-realign`, {
        current_prompt: formData.system_prompt,
        new_skill_ids: formData.skill_ids
      });
      setRealignedPrompt(res.data.proposed_prompt);
      setShowRealignModal(true);
      toast.success(copy.edit.realigned);
    } catch (err) {
      toast.error(errorMessage(err, copy, copy.edit.realignFailed));
    } finally {
      setIsRealigning(false);
    }
  };

  const applyRealignedPrompt = () => {
    setFormData(prev => ({ ...prev, system_prompt: realignedPrompt }));
    setShowRealignModal(false);
    toast.success(copy.edit.applied);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError(null);
      
      await axios.put(`${BASE_URL}/by-slug/${id}`, formData);
      
      toast.success(copy.edit.saved);
      setTimeout(() => {
        router.push(localePath(locale, "/agents"));
      }, 1500);
    } catch (err) {
      toast.error(errorMessage(err, copy, copy.edit.saveFailed));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <BiLoaderAlt className="w-12 h-12 text-blue-600 animate-spin" />
          <p className="text-gray-500 font-medium animate-pulse">{copy.edit.loading}</p>
        </div>
      </main>
    );
  }
  
  if (error) {
    return (
      <main className="flex-1 flex flex-col items-center justify-center h-full gap-4 text-center p-8">
        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-2">
          <IoCloseOutline className="w-10 h-10 text-red-500 dark:text-red-400" />
        </div>
        <h2 role="alert" className="text-xl font-bold text-gray-900 dark:text-white max-w-md">{error}</h2>
        <Link 
          href={localePath(locale, "/agents")}
          className="mt-4 px-8 py-3 bg-brand text-on-brand font-bold rounded-xl hover:bg-brand-hover transition-all shadow-lg active:scale-95"
        >
          {copy.edit.returnToAgents}
        </Link>
      </main>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-8 items-center w-full max-w-[95%] sm:max-w-[90%] lg:max-w-[80%] relative">
      <div className="flex items-center justify-between pb-2 border-b border-gray-50 dark:border-divider w-full">
        <Link 
          href={localePath(locale, "/agents")}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-900 dark:text-secondary-text dark:hover:text-primary-text transition-colors text-sm font-medium"
        >
          <IoChevronBack className="w-4 h-4" />
          {copy.edit.back}
        </Link>
        <div className="flex items-center gap-3">
          <Link 
            href={localePath(locale, `/agents/${id}`)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-bold text-white transition-all active:scale-95 shadow-sm"
          >
            <IoChatbubblesOutline className="w-4 h-4" />
            {copy.edit.chat}
          </Link>
          <button 
            type="button"
            onClick={handleShare}
            aria-label={copy.edit.copyLink}
            title={copy.edit.copyLink}
            className="flex items-center gap-2 px-4 py-2 border border-gray-100 dark:border-divider rounded-xl text-sm font-bold text-gray-600 dark:text-primary-text hover:bg-gray-50 dark:hover:bg-secondary-bg transition-all active:scale-95"
          >
            <IoShareOutline aria-hidden="true" className="w-4 h-4" />
          </button>
          <button 
            type="button"
            onClick={handleDelete}
            disabled={saving}
            aria-label={copy.edit.deleteAgent}
            title={copy.edit.deleteAgent}
            className="flex items-center gap-2 px-4 py-2 border border-red-50 dark:border-red-900/30 rounded-xl text-sm font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-all active:scale-95 disabled:opacity-50"
          >
            <IoTrashOutline aria-hidden="true" className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="flex flex-col items-center gap-2 w-full">
        <form id="edit-agent-form" onSubmit={handleSubmit} className="flex flex-col gap-12 w-full">
          <div className="flex flex-col md:flex-row md:items-center gap-8 w-full">
            <div className="flex items-center gap-8 w-full">
              <div className="relative">
                <div 
                  role="button"
                  tabIndex={0}
                  aria-label={copy.edit.profileIcon}
                  onClick={() => setShowIconSelectionModal(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setShowIconSelectionModal(true);
                    }
                  }}
                  className="w-28 h-28 rounded-full bg-gray-100 dark:bg-secondary-bg overflow-hidden ring-4 ring-white dark:ring-primary-bg shadow-sm border border-gray-100 dark:border-divider cursor-pointer group transition-all hover:ring-blue-500/30"
                >
                  {formData.icon_url ? (
                    <img src={formData.icon_url} alt="Profile" className="w-full h-full object-cover transition-transform group-hover:scale-110" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-50 dark:bg-primary-bg transition-colors group-hover:bg-gray-100 dark:group-hover:bg-secondary-bg">
                      <RiRobot2Fill className="w-12 h-12 text-gray-300 dark:text-divider group-hover:text-blue-500 transition-colors" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-full">
                    <IoPencilOutline className="w-6 h-6 text-white" />
                  </div>
                  {uploading && (
                    <div className="absolute inset-0 bg-white/95 dark:bg-primary-bg/95 flex items-center justify-center rounded-full z-10 backdrop-blur-[1px]">
                      <div className="relative w-16 h-16">
                        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                          <circle
                            cx="18"
                            cy="18"
                            r="16"
                            fill="none"
                            className="stroke-gray-100 dark:stroke-divider"
                            strokeWidth="3.5"
                          />
                          <circle
                            cx="18"
                            cy="18"
                            r="16"
                            fill="none"
                            className="stroke-black dark:stroke-primary transition-all duration-500 ease-out"
                            strokeWidth="3.5"
                            strokeDasharray="100.53"
                            strokeDashoffset={100.53 * (1 - uploadProgress / 100)}
                            strokeLinecap="round"
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-xs font-bold text-gray-900 dark:text-white">
                            {uploadProgress}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*" />
              </div>
              <div className="flex flex-col gap-2 w-full">
                <div className="flex items-center gap-2 group/title w-full">
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    className="text-3xl font-bold text-gray-900 dark:text-white leading-tight tracking-tight truncate bg-transparent border-none p-0 focus:ring-0 w-full"
                    placeholder={copy.edit.unnamed}
                    required
                  />
                  <IoPencilOutline className="w-5 h-5 text-gray-300 dark:text-divider opacity-0 group-hover/title:opacity-100 transition-opacity" />
                </div>
                <div className="flex items-center gap-3 mt-1 mr-auto">
                  {/* Toggles moved to better location */}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <button
                type="submit"
                form="edit-agent-form"
                disabled={saving}
                className="px-6 py-3 whitespace-nowrap bg-brand text-on-brand hover:bg-brand-hover disabled:opacity-50 font-bold rounded-xl transition-all shadow-lg text-sm active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
              >
                {saving ? copy.edit.saving : copy.edit.saveChanges}
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-12">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">{copy.edit.behavior}</h2>
                <p className="text-sm text-gray-500 dark:text-secondary-text font-medium">
                  {copy.edit.behaviorHint}
                </p>
              </div>
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between border-l-4 border-black dark:border-primary pl-3 ml-1 mb-1">
                    <label className="text-base font-bold text-gray-900 dark:text-white">{copy.edit.instructions}</label>
                    <button
                      type="button"
                      onClick={handleRealign}
                      disabled={isRealigning || sameSkills(formData.skill_ids, initialSkills)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:bg-gray-100 disabled:text-gray-400 text-white text-xs font-bold rounded-lg transition-all active:scale-95 shadow-sm"
                      title={sameSkills(formData.skill_ids, initialSkills) ? copy.edit.noSkillChanges : copy.edit.syncSkills}
                    >
                      {isRealigning ? <BiLoaderAlt className="animate-spin" /> : copy.edit.realign}
                    </button>
                  </div>
                  <div className="relative group">
                    <textarea
                      name="system_prompt"
                      value={formData.system_prompt}
                      onChange={handleInputChange}
                      className="w-full bg-white dark:bg-secondary-bg border border-gray-100 dark:border-divider rounded-2xl px-6 py-6 text-gray-800 dark:text-primary-text text-sm focus:ring-4 focus:ring-black/5 dark:focus:ring-primary/5 focus:border-black dark:focus:border-primary transition-all outline-none min-h-[200px] leading-relaxed shadow-sm font-medium"
                      placeholder={copy.edit.instructionsPlaceholder}
                      required
                    />
                    <p className="text-xs text-gray-400 dark:text-secondary-text font-medium ml-1">
                      Define how your agent thinks and communicates. Start with &quot;You are...&quot; and include specific examples.
                    </p>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-base font-bold text-gray-900 dark:text-white border-l-4 border-black dark:border-primary pl-3 ml-1">{copy.edit.description}</label>
                  <textarea
                    name="description"
                    value={formData.description}
                    onChange={handleInputChange}
                    className="w-full bg-white dark:bg-secondary-bg border border-gray-100 dark:border-divider rounded-2xl px-6 py-4 text-gray-800 dark:text-primary-text text-sm focus:ring-4 focus:ring-black/5 dark:focus:ring-primary/5 focus:border-black dark:focus:border-primary transition-all outline-none min-h-[100px] leading-relaxed shadow-sm font-medium"
                    placeholder={copy.edit.descriptionPlaceholder}
                  />
                  <p className="text-xs text-gray-400 dark:text-secondary-text font-medium ml-1">
                    {copy.edit.descriptionHint}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-6 border-t border-gray-50 dark:border-divider pt-12">
              <div className="flex flex-col gap-2">
                <h2 className="text-base font-bold text-gray-900 dark:text-white border-l-4 border-black dark:border-primary pl-3 ml-1">{copy.edit.theme}</h2>
                <p className="text-sm text-gray-500 dark:text-secondary-text font-medium ml-1">
                  {copy.edit.themeHint}
                </p>
              </div>
              
              <div className="bg-white dark:bg-secondary-bg shadow-lg rounded-3xl p-8 border border-gray-100 dark:border-divider flex flex-col lg:flex-row gap-8">
                {/* Theme Selection */}
                <div className="flex-1 flex flex-col gap-4">
                  <h4 className="text-xs text-gray-400 dark:text-secondary-text font-bold uppercase tracking-wider ml-1">{copy.edit.selectTheme}</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {Object.values(themes || {}).map((theme) => (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => setFormData(prev => ({ ...prev, theme: theme.id }))}
                        className={`group relative flex flex-col items-center gap-2 p-3 rounded-2xl border-2 transition-all ${
                          formData.theme === theme.id 
                            ? "border-black dark:border-primary bg-gray-50 dark:bg-primary-bg shadow-md scale-[1.02]" 
                            : "border-gray-100 dark:border-divider hover:border-gray-200 dark:hover:border-primary bg-white dark:bg-primary-bg/50"
                        }`}
                      >
                        <div 
                          className="w-full aspect-video rounded-xl shadow-inner border border-black/5 flex items-center justify-center relative overflow-hidden"
                          style={{ background: theme.colors.background }}
                        >
                          <div className="flex flex-col gap-1 w-[60%]">
                            <div className="h-1.5 w-[80%] rounded-full opacity-40" style={{ background: theme.colors.foreground }}></div>
                            <div className="h-1.5 w-[50%] rounded-full opacity-40 ml-auto" style={{ background: theme.colors.userBubble }}></div>
                          </div>
                        </div>
                        <span className={`text-xs font-bold transition-colors ${
                          formData.theme === theme.id ? "text-black dark:text-white" : "text-gray-500 dark:text-secondary-text group-hover:text-gray-700 dark:group-hover:text-primary-text"
                        }`}>
                          {theme.name}
                        </span>
                        {formData.theme === theme.id && (
                          <div className="absolute -top-2 -right-2 w-5 h-5 bg-black dark:bg-primary text-white rounded-full flex items-center justify-center shadow-lg">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 flex flex-col gap-4">
                  <h4 className="text-xs text-gray-400 dark:text-secondary-text font-bold uppercase tracking-wider ml-1">{copy.edit.chatPreview}</h4>
                  <div 
                    className="w-full h-[300px] rounded-3xl overflow-hidden shadow-2xl border border-gray-100 dark:border-divider relative"
                    style={{
                      background: (themes[formData.theme] || themes.cosmic)?.colors.background,
                      color: (themes[formData.theme] || themes.cosmic)?.colors.foreground
                    }}
                  >
                    <div 
                      className="px-4 py-3 flex items-center gap-2 border-b"
                      style={{ 
                        background: (themes[formData.theme] || themes.cosmic)?.colors.headerBg,
                        borderColor: (themes[formData.theme] || themes.cosmic)?.colors.border
                      }}
                    >
                      <div className="w-8 h-8 rounded-full bg-gray-400 overflow-hidden">
                        {formData.icon_url ? (
                          <img src={formData.icon_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <RiRobot2Fill className="w-full h-full p-1.5 text-white/50" />
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-bold truncate">{formData.name || "Agent Name"}</span>
                        <span className="text-[10px] opacity-60">{copy.edit.online}</span>
                      </div>
                    </div>
                    <div className="p-4 flex flex-col gap-4 h-[180px] overflow-y-auto">
                      <div className="flex flex-col items-end gap-1 max-w-[85%] ml-auto">
                        <div 
                          className="px-3 py-2 rounded-2xl text-xs font-medium shadow-sm"
                          style={{ 
                            background: (themes[formData.theme] || themes.cosmic)?.colors.userBubble,
                            color: (themes[formData.theme] || themes.cosmic)?.colors.userText
                          }}
                        >
                          {copy.edit.previewMessage}
                        </div>
                      </div>
                      <div className="flex flex-col items-start gap-1 max-w-[85%]">
                        <div 
                          className="px-3 py-2 rounded-2xl text-xs font-medium border shadow-sm"
                          style={{ 
                            background: (themes[formData.theme] || themes.cosmic)?.colors.agentBubble,
                            color: (themes[formData.theme] || themes.cosmic)?.colors.agentText,
                            borderColor: (themes[formData.theme] || themes.cosmic)?.colors.border
                          }}
                        >
                          I can help you with tasks, answer questions, and much more using {formData.skill_ids.length} configured skills!
                        </div>
                      </div>
                    </div>
                    <div className="absolute bottom-0 w-full p-4">
                      <div 
                        className="h-10 rounded-xl flex items-center px-4 gap-2 border shadow-inner"
                        style={{ 
                          background: (themes[formData.theme] || themes.cosmic)?.colors.inputBg,
                          borderColor: (themes[formData.theme] || themes.cosmic)?.colors.border
                        }}
                      >
                        <span className="text-xs opacity-30 flex-1">{copy.edit.typeMessage}</span>
                        <div 
                          className="w-6 h-6 rounded-lg flex items-center justify-center"
                          style={{ background: (themes[formData.theme] || themes.cosmic)?.colors.accent }}
                        >
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: (themes[formData.theme] || themes.cosmic)?.colors.accentText }}></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-400 dark:text-secondary-text font-medium ml-1">
                {copy.edit.themeApplied}
              </p>
            </div>

            <div className="flex flex-col gap-6 border-t border-gray-50 dark:border-divider pt-12">
              <h2 className="text-base font-bold text-gray-900 dark:text-white border-l-4 border-black dark:border-primary pl-3 ml-1">{copy.edit.capabilities}</h2>
              <div className="bg-white dark:bg-secondary-bg shadow-lg rounded-3xl p-8 border border-gray-100 dark:border-divider flex flex-col gap-4">
                <div className="relative">
                  <input
                    type="text"
                    placeholder={copy.edit.skillSearch}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-white dark:bg-primary-bg border border-gray-100 dark:border-divider rounded-xl px-5 py-3.5 text-sm dark:text-white focus:ring-4 focus:ring-black/5 dark:focus:ring-primary/5 focus:border-black dark:focus:border-primary transition-all outline-none shadow-sm"
                  />
                </div>
                <div className="flex flex-col gap-4">
                  <h4 className="text-xs text-gray-400 dark:text-secondary-text ml-1">
                    Active Agent Skills ({formData.skill_ids.length})
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {formData.skill_ids.length > 0 ? (
                      formData.skill_ids.map((id) => {
                        const skill = availableSkills.find(s => s.id === id);
                        if (!skill) return null;
                        return (
                          <button
                            key={skill.id}
                            type="button"
                            onClick={() => handleSkillToggle(skill.id)}
                            className="relative p-4 flex items-center justify-between rounded-2xl bg-white dark:bg-primary-bg border border-gray-100 dark:border-divider shadow-sm transition-all hover:border-black dark:hover:border-primary group"
                          >
                            <div className="flex flex-col text-left">
                              <span title={skill.name} className="text-base font-bold text-gray-900 dark:text-white line-clamp-1">
                                {skill.name}
                              </span>
                              <span title={skill.description} className="text-xs text-gray-400 dark:text-secondary-text line-clamp-2">
                                {skill.description}
                              </span>
                            </div>
                            <FaRegTrashCan size={18} className="absolute right-4 opacity-0 group-hover:opacity-100 transition-all duration-300 ease-in-out bg-white dark:bg-primary-bg text-red-500" />
                          </button>
                        );
                      })
                    ) : (
                      <div className="col-span-full p-12 rounded-2xl border border-dashed border-gray-200 dark:border-divider text-center bg-white/50 dark:bg-primary-bg/50">
                        <p className="text-sm text-gray-400 dark:text-secondary-text">{copy.edit.noSkills}</p>
                      </div>
                    )}
                  </div>
                    <div className="border-t border-gray-200/50 dark:border-divider pt-4">
                      <h4 className="text-xs text-gray-400 dark:text-secondary-text ml-1 mb-2">
                        {copy.edit.registry}
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                        {availableSkills
                          .filter(skill => 
                            !formData.skill_ids.includes(skill.id) && 
                            (skill.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                              skill.id.toLowerCase().includes(searchTerm.toLowerCase()))
                          )
                          .map((skill) => (
                            <button
                              key={skill.id}
                              type="button"
                              onClick={() => {
                                handleSkillToggle(skill.id);
                                setSearchTerm("");
                              }}
                              className="p-4 flex items-center justify-between rounded-2xl border border-gray-100 dark:border-divider bg-white dark:bg-primary-bg hover:border-black dark:hover:border-primary transition-all shadow-sm hover:shadow-md group"
                            >
                              <div className="flex flex-col text-left">
                                <span title={skill.name} className="text-base font-bold text-gray-900 dark:text-white line-clamp-1">
                                  {skill.name}
                                </span>
                                <span title={skill.description} className="text-xs text-gray-400 dark:text-secondary-text line-clamp-2">
                                  {skill.description}
                                </span>
                              </div>
                              <span className="text-lg text-white bg-black dark:bg-primary rounded-full p-0.5 w-5 h-5 flex items-center justify-center flex-shrink-0">+</span>
                            </button>
                          ))
                        }
                      </div>
                    </div>
                </div>
              </div>
              <p className="text-xs text-gray-400 dark:text-secondary-text font-medium ml-1">
                {copy.edit.capabilitiesHint}
              </p>
            </div>
          </div>
          {error && (
            <div className="p-4 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl text-red-600 dark:text-red-400 text-sm flex items-center gap-3 animate-shake">
              <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">{error}</span>
            </div>
          )}
        </form>
      </div>
      {showRealignModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-secondary-bg rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
            <div className="px-8 py-6 border-b border-gray-100 dark:border-divider flex items-center justify-between bg-violet-50/50 dark:bg-violet-900/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center text-white shadow-lg shadow-violet-200 dark:shadow-none">
                  <RiRobot2Fill className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white">{copy.edit.reviewRealign}</h3>
                  <p className="text-xs text-gray-500 dark:text-secondary-text font-medium">{copy.edit.reviewRealignHint}</p>
                </div>
              </div>
              <button
                onClick={() => setShowRealignModal(false)}
                className="p-2 hover:bg-white dark:hover:bg-primary-bg rounded-full transition-colors text-gray-400 dark:text-secondary-text hover:text-gray-900 dark:hover:text-white"
              >
                <MdClose className="w-6 h-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-8 flex flex-col md:flex-row gap-6 custom-scrollbar">
              <div className="flex-1 flex flex-col gap-3">
                <label className="text-xs font-bold text-gray-400 dark:text-secondary-text uppercase tracking-wider ml-1">{copy.edit.currentInstructions}</label>
                <div className="flex-1 p-5 bg-gray-50 dark:bg-primary-bg border border-gray-100 dark:border-divider rounded-2xl text-sm text-gray-600 dark:text-secondary-text font-medium whitespace-pre-wrap overflow-y-auto max-h-[400px]">
                  {formData.system_prompt}
                </div>
              </div>
              <div className="hidden md:flex items-center justify-center text-violet-300 dark:text-violet-500">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
              </div>
              <div className="flex-1 flex flex-col gap-3">
                <label className="text-xs font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wider ml-1">{copy.edit.proposedInstructions}</label>
                <textarea
                  value={realignedPrompt}
                  onChange={(e) => setRealignedPrompt(e.target.value)}
                  className="flex-1 p-5 bg-violet-50/30 dark:bg-violet-900/10 border-2 border-violet-100 dark:border-violet-800/50 rounded-2xl text-sm text-gray-800 dark:text-primary-text font-medium leading-relaxed focus:ring-4 focus:ring-violet-500/10 focus:border-violet-500 outline-none transition-all resize-none min-h-[400px]"
                />
              </div>
            </div>

            <div className="px-8 py-6 bg-gray-50 dark:bg-primary-bg border-t border-gray-100 dark:border-divider flex items-center justify-end gap-3">
              <button
                onClick={() => setShowRealignModal(false)}
                className="px-6 py-2.5 text-sm font-bold text-gray-600 dark:text-secondary-text hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                {copy.edit.discard}
              </button>
              <button
                onClick={applyRealignedPrompt}
                className="px-8 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl transition-all shadow-lg shadow-violet-200 dark:shadow-none active:scale-95"
              >
                {copy.edit.accept}
              </button>
            </div>
          </div>
        </div>
      )}
      {showIconPromptModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-secondary-bg w-full max-w-lg rounded-3xl shadow-2xl border border-gray-100 dark:border-divider overflow-hidden transform animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-gray-100 dark:border-divider flex items-center justify-between bg-gray-50/50 dark:bg-primary-bg/50">
              <h3 className="text-xl font-bold dark:text-white flex items-center gap-2">
                <span className="text-2xl">✨</span> Customize AI Icon Prompt
              </h3>
              <button
                onClick={() => setShowIconPromptModal(false)}
                className="p-2 hover:bg-white dark:hover:bg-secondary-bg rounded-full transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-primary-text"
              >
                <IoCloseOutline className="w-6 h-6" />
              </button>
            </div>

            <div className="p-8">
              <p className="text-sm text-gray-500 dark:text-secondary-text mb-6">
                {copy.edit.iconPromptHint}
              </p>

              <div className="space-y-4">
                <textarea
                  value={iconPrompt}
                  onChange={(e) => setIconPrompt(e.target.value)}
                  placeholder={copy.edit.iconPromptPlaceholder}
                  className="w-full h-40 p-5 bg-gray-50 dark:bg-primary-bg border border-gray-200 dark:border-divider rounded-2xl text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 outline-none transition-all resize-none dark:text-white placeholder:text-gray-400"
                />

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowIconPromptModal(false)}
                    className="flex-1 px-6 py-4 border border-gray-200 dark:border-divider rounded-2xl text-sm font-bold text-gray-600 dark:text-primary-text hover:bg-gray-50 dark:hover:bg-primary-bg transition-all active:scale-[0.98]"
                  >
                    {copy.edit.cancel}
                  </button>
                  <button
                    onClick={() => handleGenerateIcon(iconPrompt)}
                    disabled={generatingIcon || !iconPrompt.trim()}
                    className="flex-[2] px-6 py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-2xl transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    {generatingIcon ? (
                      <>
                        <BiLoaderAlt className="w-5 h-5 animate-spin" />
                        {copy.edit.generating}
                      </>
                    ) : (
                      <>
                        <span className="text-lg">✨</span>
                        {copy.edit.generateIcon}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {showIconSelectionModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-secondary-bg w-full max-w-md rounded-[2.5rem] shadow-2xl border border-gray-100 dark:border-divider overflow-hidden transform animate-in zoom-in-95 duration-200">
            <div className="p-8 border-b border-gray-50 dark:border-divider flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-black dark:text-white leading-tight">{copy.edit.iconTitle}</h3>
                <p className="text-sm text-gray-500 dark:text-secondary-text mt-1 font-medium">{copy.edit.iconSubtitle}</p>
              </div>
              <button 
                onClick={() => setShowIconSelectionModal(false)}
                className="w-10 h-10 flex items-center justify-center bg-gray-50 dark:bg-primary-bg rounded-full text-gray-400 hover:text-black dark:hover:text-white transition-colors"
              >
                <IoCloseOutline className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-8 grid grid-cols-1 gap-4">
              <div
                onClick={() => {
                  setShowIconSelectionModal(false);
                  fileInputRef.current?.click();
                }}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={(e) => {
                  setShowIconSelectionModal(false);
                  handleDrop(e);
                }}
                role="button"
                tabIndex={0}
                className={`group flex flex-col items-center gap-4 p-8 rounded-[2rem] border transition-all duration-300 active:scale-[0.98] cursor-pointer ${
                  isDragging
                    ? "border-2 border-dashed border-blue-500 bg-blue-50 dark:bg-blue-500/10"
                    : "bg-gray-50 dark:bg-primary-bg border-gray-100 dark:border-divider hover:border-blue-500/50 hover:bg-white dark:hover:bg-secondary-bg hover:shadow-xl hover:shadow-blue-500/5"
                }`}
              >
                <div className="w-16 h-16 rounded-2xl bg-white dark:bg-secondary-bg shadow-sm flex items-center justify-center text-gray-400 group-hover:text-blue-500 transition-colors duration-300">
                  <IoImageOutline className="w-8 h-8" />
                </div>
                <div className="text-center">
                  <h4 className="font-bold text-gray-900 dark:text-white text-lg">{copy.edit.uploadPhoto}</h4>
                  <p className="text-sm text-gray-500 dark:text-secondary-text mt-1">
                    {isDragging ? copy.edit.dropFile : copy.edit.pickFile}
                  </p>
                </div>
              </div>

              <button
                onClick={() => {
                  setShowIconSelectionModal(false);
                  setIconPrompt(`A professional, clean profile icon for an AI agent named "${formData.name}". Description: ${formData.description || "An AI assistant"}. Minimalist, high-quality, circular composition.`);
                  setShowIconPromptModal(true);
                }}
                className="group flex flex-col items-center gap-4 p-8 bg-blue-50/30 dark:bg-blue-500/5 rounded-[2rem] border border-blue-100/50 dark:border-blue-500/20 hover:border-blue-500 hover:bg-white dark:hover:bg-secondary-bg transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/10 active:scale-[0.98]"
              >
                <div className="w-16 h-16 rounded-2xl bg-blue-600 shadow-lg shadow-blue-500/30 flex items-center justify-center text-white transform transition-transform duration-500 group-hover:rotate-12 group-hover:scale-110">
                  <IoSparklesOutline className="w-8 h-8" />
                </div>
                <div className="text-center">
                  <h4 className="font-bold text-blue-600 dark:text-primary text-lg">{copy.edit.generateWithAi}</h4>
                  <p className="text-sm text-blue-500/70 dark:text-primary/70 mt-1">{copy.edit.generateWithAiHint}</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default EditAgent
