import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Code2,
  Download,
  FileText,
  ImageIcon,
  Leaf,
  LoaderCircle,
  Orbit,
  Paperclip,
  Plus,
  Sparkles,
  Stars,
  UserRound,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react';

type ChatMode = 'gpt4' | 'gpt5' | 'gpt6astra' | 'claude';
type AttachmentStatus = 'uploading' | 'ready' | 'error';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments?: Attachment[];
};

type ImageRecord = {
  id: string;
  prompt: string;
  src: string;
};

type Attachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
  url?: string;
  status: AttachmentStatus;
};

type Artifact = {
  title: string;
  html: string;
};

type ChatModeOption = {
  id: ChatMode;
  title: string;
  subtitle: string;
  description: string;
  systemText: string;
};

const STARTER_MESSAGES: Message[] = [
  {
    id: 'welcome',
    role: 'assistant',
    text: 'سلام! من GreenAi هستم. مدل دلخواهت را انتخاب کن تا در نوشتن، ایده‌پردازی و یادگیری کنارت باشم. امروز چه کاری برات انجام بدم؟',
  },
];

const CHAT_MODES: ChatModeOption[] = [
  {
    id: 'gpt4',
    title: 'GPT-4',
    subtitle: 'دقیق و منظم',
    description: 'برای پاسخ‌های روشن و کاربردی',
    systemText: 'You are GreenAi in GPT-4 mode, a precise and helpful Persian assistant. Reply in Persian unless the user asks for another language. Be direct, factual, and practical.',
  },
  {
    id: 'gpt5',
    title: 'GPT-5',
    subtitle: 'تحلیل و ایده‌پردازی',
    description: 'برای فکر کردن عمیق‌تر و ساختن ایده',
    systemText: 'You are GreenAi in GPT-5 mode, a thoughtful and creative Persian assistant. Reply in Persian unless the user asks for another language. Give useful structured answers when appropriate.',
  },
  {
    id: 'gpt6astra',
    title: 'GPT-6 ASTRA',
    subtitle: 'خلاق و پیشرو',
    description: 'برای مسیرهای تازه و نگاه راهبردی',
    systemText: 'You are GreenAi in GPT-6 ASTRA mode, an imaginative, strategic Persian assistant. Reply in Persian unless the user asks for another language. Offer clear, inventive, useful answers while staying honest about uncertainty.',
  },
  {
    id: 'claude',
    title: 'Claude',
    subtitle: 'سازنده وب',
    description: 'برای ساخت و اصلاح وب‌سایت',
    systemText: 'You are Claude Workspace inside GreenAi, a capable Persian web designer and developer. Reply in Persian unless asked otherwise. When the user asks to create or edit a website, produce a short Persian summary and then exactly one complete, responsive, self-contained HTML document in a fenced html code block. Put all CSS and JavaScript inside that document. Do not use external images, web fonts, CDNs, or libraries. Make every visible button work in the generated site. Respect any attached image or text file context. For requests that are not about a website, answer helpfully and concisely.',
  },
];

const QUICK_PROMPTS = [
  'برای شروع یک کسب‌وکار آنلاین ایده بده',
  'این متن را حرفه‌ای‌تر بازنویسی کن',
  'برای هفتهٔ آینده برنامه‌ریزی کن',
];

const WEB_PROMPTS = [
  'یک صفحهٔ معرفی مدرن برای کافهٔ سبز طراحی کن',
  'یک سایت شخصی مینیمال برای طراح رابط کاربری بساز',
  'یک صفحهٔ فروش دورهٔ آنلاین با بخش قیمت‌گذاری بساز',
];

function getFriendlyError(error: unknown): string {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: number }).status)
    : 0;

  if (status === 401) return 'اتصال این قابلیت درست تنظیم نشده است. کمی بعد دوباره تلاش کنید.';
  if (status === 402) return 'اعتبار این قابلیت فعلاً تمام شده است.';
  if (status === 413) return 'حجم فایل بیشتر از حد مجاز است.';
  if (status === 429) return 'درخواست‌ها زیاد شده‌اند؛ لطفاً چند لحظه دیگر دوباره تلاش کنید.';
  return 'این قابلیت فعلاً در دسترس نیست. لطفاً دوباره تلاش کنید.';
}

function makeId(prefix: string): string {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function formatSize(size: number): string {
  if (size < 1024 * 1024) return Math.max(1, Math.round(size / 1024)) + ' کیلوبایت';
  return (size / (1024 * 1024)).toFixed(1) + ' مگابایت';
}

function isImageAttachment(attachment: Attachment): boolean {
  return attachment.type.startsWith('image/');
}

function isTextFile(file: File): boolean {
  return file.type.startsWith('text/') || /\.(txt|md|csv|json|html|css|js|ts|tsx|jsx|xml|yml|yaml)$/i.test(file.name);
}

async function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('file reading failed'));
    reader.onload = () => {
      const value = String(reader.result || '');
      resolve(value.includes(',') ? value.split(',')[1] : value);
    };
    reader.readAsDataURL(file);
  });
}

async function uploadFile(file: File): Promise<string> {
  const serviceUrl = import.meta.env.VITE_PLATFORM_SERVICES_URL;
  const serviceToken = import.meta.env.VITE_PLATFORM_SERVICE_TOKEN;
  if (!serviceUrl || !serviceToken) throw new Error('storage not configured');
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(serviceUrl + '/storage/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + serviceToken },
    body: formData,
  });
  if (!response.ok) {
    const error = new Error('upload failed') as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  const data = await response.json() as { url?: string };
  if (!data.url) throw new Error('missing upload url');
  return data.url;
}

function extractArtifact(text: string): Artifact | null {
  const match = text.match(/```html\s*([\s\S]*?)```/i);
  const html = match?.[1]?.trim();
  if (!html || !/<[a-z][\s\S]*>/i.test(html)) return null;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || 'وب‌سایت ساخته‌شده';
  return { title, html };
}

function ModeIcon({ mode, size = 17 }: { mode: ChatMode; size?: number }) {
  if (mode === 'gpt4') return <Orbit size={size} />;
  if (mode === 'gpt5') return <Zap size={size} />;
  if (mode === 'gpt6astra') return <Stars size={size} />;
  return <Code2 size={size} />;
}

function AttachmentChip({ attachment, onRemove }: { attachment: Attachment; onRemove?: () => void }) {
  const hasError = attachment.status === 'error';
  return (
    <div data-testid={'attachment-' + attachment.id} className={'flex min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-right ' + (hasError ? 'border-[#f1c9c4] bg-[#fff5f3] text-[#a3453d]' : 'border-[#d9e6d6] bg-white text-[#48634e]')}>
      <span className={'grid size-8 shrink-0 place-items-center rounded-lg ' + (isImageAttachment(attachment) ? 'bg-[#e5f4de] text-[#237447]' : 'bg-[#f1ede5] text-[#8b6030]')}>
        {isImageAttachment(attachment) ? <ImageIcon size={16} /> : <FileText size={16} />}
      </span>
      <span className="min-w-0 flex-1"><strong className="block truncate text-xs">{attachment.name}</strong><small className="block text-[10px] opacity-75">{attachment.status === 'uploading' ? 'در حال آماده‌سازی…' : hasError ? 'ارسال نشد' : formatSize(attachment.size)}</small></span>
      {attachment.status === 'uploading' && <LoaderCircle className="shrink-0 animate-spin" size={15} />}
      {onRemove && <button type="button" onClick={onRemove} data-testid={'remove-attachment-' + attachment.id} aria-label={'حذف ' + attachment.name} className="grid size-7 shrink-0 place-items-center rounded-lg transition hover:bg-black/5"><X size={15} /></button>}
    </div>
  );
}

function App() {
  const [mode, setMode] = useState<ChatMode>('gpt5');
  const [messages, setMessages] = useState<Message[]>(STARTER_MESSAGES);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [imagePrompt, setImagePrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [imageError, setImageError] = useState('');
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [imagePanelOpen, setImagePanelOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [artifactView, setArtifactView] = useState<'preview' | 'code'>('preview');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const selectedMode = CHAT_MODES.find((item) => item.id === mode) ?? CHAT_MODES[1];
  const uploading = attachments.some((attachment) => attachment.status === 'uploading');

  const openAiClient = useMemo(() => {
    const serviceUrl = import.meta.env.VITE_PLATFORM_SERVICES_URL;
    const serviceToken = import.meta.env.VITE_PLATFORM_SERVICE_TOKEN;
    if (!serviceUrl || !serviceToken) return null;
    return new OpenAI({ baseURL: serviceUrl + '/openai/v1', apiKey: serviceToken, dangerouslyAllowBrowser: true });
  }, []);

  const claudeClient = useMemo(() => {
    const serviceUrl = import.meta.env.VITE_PLATFORM_SERVICES_URL;
    const serviceToken = import.meta.env.VITE_PLATFORM_SERVICE_TOKEN;
    if (!serviceUrl || !serviceToken) return null;
    return new Anthropic({ baseURL: serviceUrl + '/anthropic', apiKey: serviceToken, dangerouslyAllowBrowser: true });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isSending, artifact]);

  const chooseMode = (nextMode: ChatMode) => {
    setMode(nextMode);
    setModelMenuOpen(false);
    setChatError('');
  };

  const startNewChat = () => {
    setMessages(STARTER_MESSAGES);
    setInput('');
    setAttachments([]);
    setArtifact(null);
    setChatError('');
    setUploadError('');
  };

  const useQuickPrompt = (prompt: string) => {
    setInput(prompt);
    setChatError('');
  };

  const removeAttachment = (id: string) => setAttachments((current) => current.filter((attachment) => attachment.id !== id));

  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!selectedFiles.length) return;
    setUploadError('');
    const acceptable = selectedFiles.filter((file) => file.size <= 5 * 1024 * 1024);
    if (acceptable.length !== selectedFiles.length) setUploadError('هر فایل باید حداکثر ۵ مگابایت باشد.');

    const newAttachments = acceptable.map((file) => ({
      id: makeId('file'),
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
      file,
      status: 'uploading' as AttachmentStatus,
    }));
    setAttachments((current) => [...current, ...newAttachments]);

    await Promise.all(newAttachments.map(async (attachment) => {
      try {
        const url = await uploadFile(attachment.file);
        setAttachments((current) => current.map((item) => item.id === attachment.id ? { ...item, status: 'ready', url } : item));
      } catch (error) {
        setAttachments((current) => current.map((item) => item.id === attachment.id ? { ...item, status: 'error' } : item));
        setUploadError(getFriendlyError(error));
      }
    }));
  };

  const createClaudeContent = async (userText: string, readyAttachments: Attachment[]) => {
    const blocks: Array<Record<string, unknown>> = [{ type: 'text', text: userText }];
    for (const attachment of readyAttachments) {
      if (isImageAttachment(attachment) && ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(attachment.type)) {
        const base64 = await readFileAsBase64(attachment.file);
        blocks.push({ type: 'image', source: { type: 'base64', media_type: attachment.type, data: base64 } });
      } else if (isTextFile(attachment.file)) {
        const text = (await attachment.file.text()).slice(0, 25000);
        blocks.push({ type: 'text', text: '\n\nمحتوای فایل «' + attachment.name + '»:\n' + text });
      } else {
        blocks.push({ type: 'text', text: '\n\nفایل پیوست‌شده: «' + attachment.name + '» (' + formatSize(attachment.size) + ')' + (attachment.url ? '\nنشانی فایل: ' + attachment.url : '') });
      }
    }
    return blocks;
  };

  const sendMessage = async () => {
    const userText = input.trim();
    const readyAttachments = attachments.filter((attachment) => attachment.status === 'ready');
    if ((!userText && !readyAttachments.length) || isSending || uploading) return;

    const userMessage: Message = { id: makeId('user'), role: 'user', text: userText || 'این پیوست را بررسی کن.', attachments: readyAttachments };
    const conversation = [...messages, userMessage];
    setMessages(conversation);
    setInput('');
    setAttachments([]);
    setChatError('');
    setIsSending(true);

    try {
      let reply = '';
      if (mode === 'claude') {
        if (!claudeClient) throw new Error('claude not configured');
        const currentContent = await createClaudeContent(userMessage.text, readyAttachments);
        const response = await claudeClient.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 3000,
          system: selectedMode.systemText,
          messages: [
            ...conversation.slice(0, -1).map((message) => ({ role: message.role === 'assistant' ? 'assistant' as const : 'user' as const, content: message.text })),
            { role: 'user' as const, content: currentContent as never },
          ],
        });
        reply = response.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n').trim();
      } else {
        if (!openAiClient) throw new Error('openai not configured');
        const attachmentNote = readyAttachments.length ? '\n\nپیوست‌های این پیام: ' + readyAttachments.map((attachment) => attachment.name).join('، ') : '';
        const response = await openAiClient.chat.completions.create({
          model: 'gpt-5.4-mini',
          max_completion_tokens: 1000,
          messages: [
            { role: 'system', content: selectedMode.systemText },
            ...conversation.map((message) => ({ role: message.role === 'assistant' ? 'assistant' as const : 'user' as const, content: message.text + (message.id === userMessage.id ? attachmentNote : '') })),
          ],
        });
        reply = response.choices[0]?.message?.content?.trim() || '';
      }
      if (!reply) throw new Error('empty response');
      const nextArtifact = mode === 'claude' ? extractArtifact(reply) : null;
      if (nextArtifact) {
        setArtifact(nextArtifact);
        setArtifactView('preview');
      }
      setMessages((current) => [...current, { id: makeId('assistant'), role: 'assistant', text: reply }]);
    } catch (error) {
      setChatError(getFriendlyError(error));
    } finally {
      setIsSending(false);
    }
  };

  const generateImage = async () => {
    const prompt = imagePrompt.trim();
    if (!prompt || isGenerating) return;
    setImageError('');
    setIsGenerating(true);
    if (!openAiClient) {
      setImageError('قابلیت ساخت تصویر هنوز برای این برنامه فعال نشده است.');
      setIsGenerating(false);
      return;
    }
    try {
      const response = await openAiClient.images.generate({ model: 'gpt-image-2', prompt: 'Create a polished, high-quality image based on this request. Do not add text unless explicitly requested. User request in Persian: ' + prompt, size: '1024x1024', quality: 'low' });
      const base64 = response.data?.[0]?.b64_json;
      if (!base64) throw new Error('empty image');
      setImages((current) => [{ id: makeId('image'), prompt, src: 'data:image/png;base64,' + base64 }, ...current]);
      setImagePrompt('');
    } catch (error) {
      setImageError(getFriendlyError(error));
    } finally {
      setIsGenerating(false);
    }
  };

  const downloadImage = (image: ImageRecord) => {
    const link = document.createElement('a');
    link.href = image.src;
    link.download = 'greenai-' + image.id + '.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadArtifact = () => {
    if (!artifact) return;
    const blob = new Blob([artifact.html], { type: 'text/html;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'greenai-website.html';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  };

  const isClaude = mode === 'claude';

  return (
    <main className="app-shell min-h-screen overflow-hidden bg-[#082418] text-[#153125]" data-testid="greenai-app">
      <div className="app-glow app-glow-one" />
      <div className="app-glow app-glow-two" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1680px] flex-col lg:flex-row lg:gap-5 lg:p-5">
        <aside className="relative z-10 flex shrink-0 items-center justify-between border-b border-white/10 bg-[#0b2c1d]/95 px-4 py-3 text-white shadow-lg shadow-[#06170e]/15 backdrop-blur-xl lg:w-[290px] lg:flex-col lg:items-stretch lg:justify-start lg:rounded-[30px] lg:border lg:border-white/10 lg:p-5">
          <div className="flex items-center gap-3" data-testid="brand-logo"><span className="grid size-11 place-items-center rounded-2xl bg-gradient-to-br from-[#c9ff8d] via-[#72df86] to-[#23a969] text-[#07321d] shadow-lg shadow-[#6ae58a]/20"><Leaf size={24} strokeWidth={2.5} /></span><div><h1 className="text-lg font-black tracking-tight">Green<span className="text-[#9af4aa]">Ai</span></h1><p className="mt-0.5 text-xs text-[#b0cbbb]">فضایی برای خلق کردن</p></div></div>
          <button onClick={startNewChat} data-testid="new-chat-button" className="hidden min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#dcffab] px-4 text-sm font-extrabold text-[#103724] shadow-lg shadow-[#071d12]/20 transition hover:-translate-y-0.5 hover:bg-white focus-visible:bg-white lg:mt-10 lg:flex"><Plus size={19} strokeWidth={2.7} /> گفت‌وگوی تازه</button>
          <div className="hidden lg:mt-8 lg:block"><div className="mb-3 flex items-center justify-between px-1"><p className="text-xs font-bold text-[#a9c7b2]">انتخاب مدل</p><span className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold text-[#c4f4cc]">۴ مدل</span></div><div className="space-y-2" data-testid="model-selector">{CHAT_MODES.map((item) => <button key={item.id} onClick={() => chooseMode(item.id)} data-testid={'mode-' + item.id} className={'group flex w-full items-center gap-3 rounded-2xl border p-3 text-right transition ' + (mode === item.id ? (item.id === 'claude' ? 'border-[#f7c99c]/60 bg-[#fff2e4] text-[#3d2a1a] shadow-lg shadow-[#061b10]/15' : 'border-[#bdff9d]/45 bg-[#d8ffb7] text-[#103724] shadow-lg shadow-[#061b10]/15') : 'border-transparent text-[#d5e5d8] hover:border-white/10 hover:bg-white/8')}><span className={'grid size-10 shrink-0 place-items-center rounded-xl transition ' + (mode === item.id ? (item.id === 'claude' ? 'bg-[#23211e] text-[#ffd1ab]' : 'bg-[#167148] text-[#dcffad]') : 'bg-white/10 text-[#a2efad] group-hover:bg-white/15')}><ModeIcon mode={item.id} size={18} /></span><span className="min-w-0 flex-1"><strong className="block text-sm font-extrabold">{item.title}</strong><small className={'block pt-0.5 text-xs font-normal ' + (mode === item.id ? 'text-[#6c5b4a]' : 'text-[#abc4b2]')}>{item.subtitle}</small></span>{mode === item.id && <Check className="shrink-0" size={17} strokeWidth={3} />}</button>)}</div></div>
          <button onClick={() => setImagePanelOpen(true)} data-testid="open-astra-image-button" className="hidden rounded-2xl border border-[#a0efaa]/20 bg-gradient-to-l from-[#1c7047] to-[#134531] p-4 text-right text-white shadow-lg shadow-[#061b10]/10 transition hover:-translate-y-0.5 hover:border-[#a0efaa]/40 lg:mt-5 lg:block"><span className="mb-2 flex items-center justify-between"><span className="grid size-9 place-items-center rounded-xl bg-[#d8ffb7] text-[#195839]"><WandSparkles size={18} /></span><span className="text-[10px] font-bold text-[#bbf5bf]">ASTRA STUDIO</span></span><strong className="block text-sm">تصویر بساز</strong><small className="mt-1 block text-xs leading-5 text-[#bbd6c2]">ایده‌ات را به یک قاب تبدیل کن</small></button>
          <div className="hidden lg:mt-auto lg:block"><div className="h-px bg-white/10" /><p className="pt-4 text-center text-[11px] leading-6 text-[#9cb9a5]">پاسخ‌ها ممکن است خطا داشته باشند؛ اطلاعات مهم را بررسی کنید.</p></div>
        </aside>

        <section className="relative z-10 flex min-h-0 flex-1 flex-col bg-[#f8fbf6] shadow-2xl shadow-[#062016]/15 lg:rounded-[30px] lg:border lg:border-white/70">
          <header className="relative flex min-h-[76px] items-center justify-between border-b border-[#e6eee2] bg-white/85 px-4 backdrop-blur-xl sm:px-6 lg:rounded-t-[30px]" data-testid="chat-header"><div className="flex min-w-0 items-center gap-3"><span className={'relative grid size-11 shrink-0 place-items-center rounded-2xl ' + (isClaude ? 'bg-[#f6e3d2] text-[#6b4530]' : 'bg-[#e7f8df] text-[#1b7a48]')}>{isClaude ? <Code2 size={22} /> : <Bot size={22} />}<i className={'absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-white ' + (isClaude ? 'bg-[#df8552]' : 'bg-[#6ecf7e]')} /></span><div className="min-w-0"><button onClick={() => setModelMenuOpen((open) => !open)} data-testid="mobile-model-menu-button" aria-expanded={modelMenuOpen} className="flex min-h-9 max-w-full items-center gap-1 rounded-lg text-right font-extrabold transition hover:text-[#1f864c] lg:pointer-events-none"><span className="truncate">{selectedMode.title} <span className="text-[#1f864c]">GreenAi</span></span><ChevronDown className="shrink-0 lg:hidden" size={16} /></button><p className="truncate text-xs text-[#77877d]">{isClaude ? 'وب‌سایتت را توصیف کن تا بسازم' : selectedMode.subtitle + ' · آماده برای خلق ایده‌های تازه'}</p></div></div><div className="flex items-center gap-2"><button onClick={startNewChat} data-testid="new-chat-mobile-button" aria-label="گفت‌وگوی تازه" className="grid size-11 place-items-center rounded-xl text-[#52705e] transition hover:bg-[#eef7eb] lg:hidden"><Plus size={21} /></button><button onClick={() => setImagePanelOpen(true)} data-testid="image-mobile-button" className="flex min-h-11 items-center gap-2 rounded-xl bg-[#e3f7d5] px-3 text-sm font-bold text-[#176a3c] transition hover:bg-[#d3f0c5]"><ImageIcon size={18} /><span className="hidden sm:inline">ساخت تصویر</span></button></div>
            {modelMenuOpen && <div data-testid="mobile-model-selector" className="absolute right-4 top-[calc(100%+8px)] z-30 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-3xl border border-[#dce9d9] bg-white p-2 shadow-2xl shadow-[#123c23]/15 lg:hidden"><p className="px-3 py-2 text-xs font-bold text-[#708175]">مدل گفت‌وگو را انتخاب کنید</p>{CHAT_MODES.map((item) => <button key={item.id} onClick={() => chooseMode(item.id)} data-testid={'mobile-mode-' + item.id} className={'flex min-h-16 w-full items-center gap-3 rounded-2xl px-3 text-right transition ' + (mode === item.id ? (item.id === 'claude' ? 'bg-[#fff1e5] text-[#6b4530]' : 'bg-[#e4f7d9] text-[#155d36]') : 'hover:bg-[#f4f8f2]')}><span className={'grid size-9 place-items-center rounded-xl ' + (mode === item.id ? 'bg-white' : 'bg-[#edf4ea]')}><ModeIcon mode={item.id} /></span><span className="flex-1"><strong className="block text-sm">{item.title}</strong><small className="text-xs text-[#718174]">{item.description}</small></span>{mode === item.id && <Check size={17} />}</button>)}</div>}
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8" data-testid="messages-list" aria-live="polite"><div className="mx-auto w-full max-w-3xl space-y-6">
            {messages.length === 1 && <div className={'welcome-panel overflow-hidden rounded-[26px] border p-5 sm:p-6 ' + (isClaude ? 'claude-welcome border-[#e4d5c4]' : 'border-[#dcebd8]')} data-testid="welcome-panel"><div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between"><div className="max-w-xl"><div className={'mb-3 flex items-center gap-2 ' + (isClaude ? 'text-[#a25534]' : 'text-[#27864b]')}><span className="grid size-8 place-items-center rounded-xl bg-white shadow-sm">{isClaude ? <Code2 size={16} /> : <Sparkles size={16} />}</span><span className="text-xs font-extrabold tracking-wide">{isClaude ? 'کارگاه ساخت وب شما' : 'فضای خلاقیت شما'}</span></div><h2 className="text-2xl font-black leading-relaxed text-[#173a26] sm:text-3xl">{isClaude ? <>ایده‌ات را بگو؛<br className="hidden sm:block" /> وب‌سایتش را بساز.</> : <>یک فکر کوچک را به<br className="hidden sm:block" /> اتفاقی بزرگ تبدیل کن.</>}</h2><p className="mt-2 text-sm leading-7 text-[#53705d]">{isClaude ? 'رنگ، موضوع و بخش‌های موردنظرت را بنویس یا عکس و فایل مرجع پیوست کن.' : 'با ' + selectedMode.title + ' سؤال بپرس، مسیر بساز و ایده‌هایت را بهتر ببین.'}</p></div><div className={'hidden size-20 shrink-0 place-items-center rounded-[25px] bg-white/80 shadow-sm sm:grid ' + (isClaude ? 'text-[#b76540]' : 'text-[#2e9a54]')}>{isClaude ? <Code2 size={34} strokeWidth={1.7} /> : <Leaf size={34} strokeWidth={1.7} />}</div></div><div className="mt-5 flex flex-wrap gap-2">{(isClaude ? WEB_PROMPTS : QUICK_PROMPTS).map((prompt) => <button key={prompt} onClick={() => useQuickPrompt(prompt)} data-testid={'quick-prompt-' + prompt.slice(0, 8)} className={'rounded-full border bg-white/75 px-3 py-2 text-xs font-bold transition hover:-translate-y-0.5 hover:bg-white ' + (isClaude ? 'border-[#e2c9b3] text-[#875138] hover:border-[#d2916e]' : 'border-[#cfe5ca] text-[#3a6e4b] hover:border-[#83c990]')}>{prompt}</button>)}</div></div>}
            {messages.map((message) => <article key={message.id} data-testid={'message-' + message.role} className={'flex max-w-[94%] gap-3 sm:max-w-[82%] ' + (message.role === 'user' ? 'mr-auto flex-row-reverse' : '')}><span className={'grid size-9 shrink-0 place-items-center rounded-xl shadow-sm ' + (message.role === 'assistant' ? (isClaude ? 'bg-[#38312b] text-[#ffe3cf]' : 'bg-[#166b42] text-[#dffff0]') : 'bg-[#e0eee3] text-[#42694f]')}>{message.role === 'assistant' ? (isClaude ? <Code2 size={18} /> : <Bot size={18} />) : <UserRound size={17} />}</span><div className="min-w-0"><p className={'whitespace-pre-wrap break-words rounded-2xl px-4 py-3 text-sm leading-7 sm:text-[15px] ' + (message.role === 'assistant' ? 'rounded-tr-sm bg-white text-[#294633] shadow-sm ring-1 ring-[#e3ece1]' : 'rounded-tl-sm bg-[#176b42] text-white shadow-lg shadow-[#176b42]/15')}>{message.text}</p>{message.attachments && message.attachments.length > 0 && <div className="mt-2 grid gap-2">{message.attachments.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} />)}</div>}<p className={'mt-1 px-1 text-[10px] text-[#9ba9a0] ' + (message.role === 'user' ? 'text-left' : '')}>{message.role === 'assistant' ? (isClaude ? 'Claude در GreenAi' : 'GreenAi') : 'شما'}</p></div></article>)}
            {isSending && <div data-testid="chat-loading" className="flex items-center gap-3"><span className={'grid size-9 place-items-center rounded-xl shadow-sm ' + (isClaude ? 'bg-[#38312b] text-[#ffe3cf]' : 'bg-[#166b42] text-[#dffff0]')}>{isClaude ? <Code2 size={18} /> : <Bot size={18} />}</span><div className="flex gap-1.5 rounded-2xl rounded-tr-sm bg-white px-4 py-4 shadow-sm ring-1 ring-[#e3ece1]"><i className="size-1.5 animate-bounce rounded-full bg-[#4d9570] [animation-delay:-0.2s]" /><i className="size-1.5 animate-bounce rounded-full bg-[#4d9570] [animation-delay:-0.1s]" /><i className="size-1.5 animate-bounce rounded-full bg-[#4d9570]" /></div></div>}
            {chatError && <div data-testid="chat-error" className="rounded-2xl border border-[#f0caca] bg-[#fff6f5] p-4 text-sm leading-6 text-[#a33d3d]">{chatError}</div>}<div ref={bottomRef} />
          </div></div>

          <div className="border-t border-[#e5ede2] bg-white/90 px-4 py-3 backdrop-blur sm:px-6 sm:py-4 lg:rounded-b-[30px]"><div className="mx-auto w-full max-w-3xl">
            {attachments.length > 0 && <div className="mb-2 flex flex-wrap gap-2" data-testid="pending-attachments">{attachments.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} onRemove={() => removeAttachment(attachment.id)} />)}</div>}
            {uploadError && <p data-testid="upload-error" className="mb-2 rounded-xl border border-[#f0caca] bg-[#fff6f5] p-2.5 text-xs leading-5 text-[#a33d3d]">{uploadError}</p>}
            <div className="flex items-end gap-2 rounded-[22px] border border-[#d7e5d4] bg-[#fbfdf9] p-2 shadow-sm transition focus-within:border-[#66ae76] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#dff2df]"><input ref={fileInputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,.pdf,.txt,.md,.csv,.json,.html,.css,.js,.ts,.tsx,.jsx,.doc,.docx,.xls,.xlsx" onChange={(event) => void addFiles(event)} data-testid="file-upload-input" className="sr-only" /><button type="button" onClick={() => fileInputRef.current?.click()} data-testid="attach-file-button" aria-label="پیوست عکس یا فایل" className="grid size-11 shrink-0 place-items-center rounded-2xl text-[#56715d] transition hover:bg-[#e7f3e5] hover:text-[#1c7140]"><Paperclip size={20} /></button><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} data-testid="chat-input" rows={1} placeholder={isClaude ? 'سایت موردنظرت را توصیف کن…' : 'پیامتان را برای ' + selectedMode.title + ' بنویسید…'} className="max-h-32 min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-7 outline-none placeholder:text-[#93a297]" /><button onClick={() => void sendMessage()} disabled={(!input.trim() && !attachments.some((item) => item.status === 'ready')) || isSending || uploading} data-testid="send-message-button" aria-label="ارسال پیام" className={'grid size-11 shrink-0 place-items-center rounded-2xl text-white shadow-md transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-[#b7c8ba] ' + (isClaude ? 'bg-[#3b342e] shadow-[#3b342e]/20 hover:bg-[#211d19]' : 'bg-[#176b42] shadow-[#176b42]/20 hover:bg-[#105735]')}><ArrowUp size={20} strokeWidth={2.7} /></button></div>
            <div className="mt-2 flex items-center justify-center gap-2 text-center text-[11px] leading-5 text-[#89958b]"><span className="size-1 rounded-full bg-[#6abd78]" /> عکس و فایل تا ۵ مگابایت قابل پیوست است <span className="size-1 rounded-full bg-[#6abd78]" /> GreenAi ممکن است اشتباه کند</div>
          </div></div>
        </section>

        <aside className="relative z-10 hidden w-[330px] shrink-0 overflow-hidden rounded-[30px] border border-white/70 bg-[#f8fbf6] p-5 shadow-xl shadow-[#092819]/10 xl:block">
          {isClaude || artifact ? <div data-testid="artifact-panel"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-[#f8e3d2] text-[#8a4c30]"><Code2 size={19} /></span><div><p className="text-[10px] font-extrabold tracking-[0.12em] text-[#af6445]">CLAUDE WORKSPACE</p><h3 className="text-sm font-black">بوم وب‌سایت</h3></div></div>{artifact ? <><div className="mt-5 flex rounded-lg bg-[#ece8e1] p-1"><button onClick={() => setArtifactView('preview')} data-testid="artifact-preview-tab" className={'min-h-9 flex-1 rounded-md text-xs font-bold transition ' + (artifactView === 'preview' ? 'bg-white text-[#342a23] shadow-sm' : 'text-[#77695e]')}>پیش‌نمایش</button><button onClick={() => setArtifactView('code')} data-testid="artifact-code-tab" className={'min-h-9 flex-1 rounded-md text-xs font-bold transition ' + (artifactView === 'code' ? 'bg-white text-[#342a23] shadow-sm' : 'text-[#77695e]')}>کد</button></div><div className="mt-3 overflow-hidden rounded-xl border border-[#dcd5cd] bg-white">{artifactView === 'preview' ? <iframe title={artifact.title} srcDoc={artifact.html} sandbox="allow-scripts" data-testid="website-preview" className="h-[430px] w-full bg-white" /> : <pre data-testid="website-code" dir="ltr" className="h-[430px] overflow-auto bg-[#25211e] p-4 text-left text-[11px] leading-5 text-[#f5e8de]"><code>{artifact.html}</code></pre>}</div><p className="mt-3 truncate text-xs font-bold text-[#5b4b3f]">{artifact.title}</p><button onClick={downloadArtifact} data-testid="download-website-button" className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2d2925] px-3 text-sm font-bold text-white transition hover:bg-black"><Download size={17} /> دریافت وب‌سایت</button></> : <div data-testid="artifact-empty-state" className="mt-5 grid min-h-72 place-items-center rounded-2xl border border-dashed border-[#d9c9b8] bg-[#fdf9f4] p-5 text-center"><div><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-white text-[#b76643] shadow-sm"><Code2 size={25} /></span><p className="mt-4 text-sm font-extrabold text-[#513a2b]">ایده‌ات اینجا جان می‌گیرد</p><p className="mt-2 text-xs leading-6 text-[#806c5b]">به کلاد بگو چه وب‌سایتی می‌خواهی تا پیش‌نمایش زنده‌اش را ببینی.</p></div></div>}</div> : <><div className="absolute -left-10 -top-10 size-32 rounded-full bg-[#d8f3be]/55 blur-2xl" /><div className="relative flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-[#fff0ce] text-[#b87918]"><WandSparkles size={19} /></span><div><p className="text-[10px] font-extrabold tracking-[0.12em] text-[#bd7e1b]">ASTRA STUDIO</p><h3 className="text-sm font-black">استودیوی تصویر</h3></div></div><div className="relative mt-6 rounded-[24px] bg-[#173d29] p-5 text-white shadow-lg shadow-[#173d29]/15"><span className="relative grid size-10 place-items-center rounded-2xl bg-white/10 text-[#d5ff9e]"><ImageIcon size={20} /></span><p className="relative mt-4 text-base font-extrabold leading-7">چیزی را تصور کن؛<br />ASTRA آن را می‌سازد.</p><button onClick={() => setImagePanelOpen(true)} data-testid="open-image-studio-button" className="relative mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#dfffaa] px-4 text-sm font-extrabold text-[#16412b] transition hover:bg-white"><Sparkles size={17} /> شروع ساخت تصویر</button></div><div className="relative mt-6"><p className="mb-3 text-xs font-extrabold text-[#607464]">ایده برای شروع</p><button onClick={() => { setImagePanelOpen(true); setImagePrompt('یک کافه مدرن و سبز در دل طبیعت، نور صبحگاهی، سبک عکاسی حرفه‌ای'); }} data-testid="suggested-image-prompt" className="w-full rounded-2xl border border-[#dce9d9] bg-white p-3 text-right text-xs font-bold leading-6 text-[#39734b] transition hover:border-[#8acb93] hover:bg-[#f5fbf3]">«یک کافه سبز در دل طبیعت بساز»</button></div></>}
        </aside>
      </div>

      {artifact && <button onClick={() => setMode('claude')} data-testid="mobile-artifact-button" className="fixed bottom-5 left-4 z-20 flex min-h-12 items-center gap-2 rounded-2xl bg-[#302a25] px-4 text-sm font-bold text-white shadow-xl shadow-[#082719]/25 transition hover:scale-105 xl:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}><Code2 size={18} /> پیش‌نمایش وب</button>}
      {!artifact && <button onClick={() => setImagePanelOpen(true)} data-testid="floating-image-button" aria-label="ساخت تصویر" className="fixed bottom-5 left-4 z-20 grid size-14 place-items-center rounded-2xl bg-[#dfffaa] text-[#174c30] shadow-xl shadow-[#082719]/25 transition hover:scale-105 lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}><WandSparkles size={23} /></button>}

      {imagePanelOpen && <div className="fixed inset-0 z-50 flex items-end bg-[#071a10]/55 p-0 backdrop-blur-md sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="studio-title" data-testid="image-studio-modal"><div className="relative max-h-[92dvh] w-full overflow-y-auto rounded-t-[30px] bg-[#f8fbf6] shadow-2xl sm:max-w-5xl sm:rounded-[30px]"><div className="absolute left-0 right-0 top-0 h-1 bg-gradient-to-l from-[#8ee58a] via-[#d9ff9d] to-[#47b971]" /><div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#e0ebe0] bg-[#f8fbf6]/95 px-5 py-4 backdrop-blur sm:px-7"><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-[#173d29] text-[#dfffad]"><WandSparkles size={21} /></span><div><p className="text-[10px] font-extrabold tracking-[0.12em] text-[#b87717]">ASTRA STUDIO</p><h2 id="studio-title" className="font-black">تصویرساز GreenAi</h2><p className="text-xs text-[#748177]">ایده‌ات را با جزئیات توصیف کن</p></div></div><button onClick={() => setImagePanelOpen(false)} data-testid="close-image-studio-button" aria-label="بستن استودیو" className="grid size-11 place-items-center rounded-xl text-[#526457] transition hover:bg-[#e8f0e8]"><X size={21} /></button></div><div className="grid gap-6 p-5 sm:p-7 md:grid-cols-5"><div className="md:col-span-2"><div className="rounded-[24px] bg-[#eaf6e7] p-4"><label htmlFor="image-prompt" className="text-sm font-extrabold text-[#254b33]">چه تصویری بسازم؟</label><textarea id="image-prompt" value={imagePrompt} onChange={(event) => setImagePrompt(event.target.value)} data-testid="image-prompt-input" rows={7} placeholder="مثلاً یک خانهٔ مدرن میان جنگل با پنجره‌های بزرگ، نور عصرگاهی، تصویر واقع‌گرایانه" className="mt-4 w-full resize-none rounded-2xl border border-[#d3e5cf] bg-white p-4 text-sm leading-7 outline-none transition placeholder:text-[#94a196] focus:border-[#62a77b] focus:ring-4 focus:ring-[#d9f0d9]" /></div><button onClick={() => void generateImage()} disabled={!imagePrompt.trim() || isGenerating} data-testid="generate-image-button" className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#176b42] px-4 text-sm font-extrabold text-white shadow-lg shadow-[#176b42]/15 transition hover:-translate-y-0.5 hover:bg-[#105735] disabled:cursor-not-allowed disabled:bg-[#b7c8ba]">{isGenerating ? <LoaderCircle className="animate-spin" size={19} /> : <Sparkles size={19} />}{isGenerating ? 'در حال ساخت تصویر...' : 'ساخت تصویر'}</button>{imageError && <p data-testid="image-error" className="mt-3 rounded-xl border border-[#f0caca] bg-[#fff5f5] p-3 text-xs leading-6 text-[#a33d3d]">{imageError}</p>}</div><div className="min-h-72 md:col-span-3">{isGenerating ? <div data-testid="image-loading" className="grid min-h-72 place-items-center overflow-hidden rounded-[26px] border border-dashed border-[#9dcc9f] bg-[#eef8ed] p-6 text-center"><div><span className="mx-auto mb-4 grid size-16 place-items-center rounded-3xl bg-white text-[#277a47] shadow-sm"><LoaderCircle className="animate-spin" size={29} /></span><p className="font-extrabold text-[#285337]">ASTRA مشغول خلق تصویر است</p></div></div> : images.length > 0 ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{images.map((image) => <figure key={image.id} className="group overflow-hidden rounded-[26px] border border-[#dce8dc] bg-white shadow-sm"><div className="relative"><img src={image.src} alt={image.prompt} className="aspect-square w-full object-cover" /></div><figcaption className="flex items-center justify-between gap-3 p-3"><p className="min-w-0 text-xs leading-5 text-[#526457]">{image.prompt}</p><button onClick={() => downloadImage(image)} data-testid={'download-image-' + image.id} aria-label="دانلود تصویر" className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e4f5e8] text-[#176638] transition hover:bg-[#cfe9d5]"><Download size={18} /></button></figcaption></figure>)}</div> : <div data-testid="image-empty-state" className="grid min-h-72 place-items-center overflow-hidden rounded-[26px] border border-dashed border-[#b7d6bd] bg-[#f0f8ee] p-6 text-center"><div><span className="mx-auto grid size-16 place-items-center rounded-3xl bg-white text-[#1f7a43] shadow-sm"><ImageIcon size={28} /></span><p className="mt-4 font-extrabold text-[#2c583a]">ایده‌ات آمادهٔ تبدیل شدن است</p><p className="mt-2 max-w-xs text-xs leading-6 text-[#6e836f]">توضیحت را بنویس و اجازه بده ASTRA یک قاب تازه برایت بسازد.</p></div></div>}</div></div></div></div>}
    </main>
  );
}

export default App;
