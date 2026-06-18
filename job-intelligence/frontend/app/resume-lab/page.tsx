"use client";

import { ArrowLeft, ArrowUpRight, Copy, Download, Eye, FileText, Loader2, Save, Sparkles, Upload, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { exportCoverLetterDocx, exportResumeDocx, generateCoverLetter, getJob, getJobs, parseResume, rebuildResume, resumeModelChoices } from "@/lib/api";
import { defaultProfiles, loadProfiles, saveProfiles, type JobProfile } from "@/lib/job-profiles";
import type { ResumeRebuildResult } from "@/types/job";

interface AtsResult {
  score: number;
  grade: string;
  phraseMatches: string[];
  phraseMissing: string[];
  wordMatches: string[];
  wordMissing: string[];
  requiredMet: string[];
  requiredMissing: string[];
  experienceMatch: boolean | null;
  educationMatch: boolean | null;
}

// Known tech skills / tools / methodologies to look for in JD + resume
const TECH_SKILLS = new Set([
  // languages
  "c#","java","python","javascript","typescript","sql","t-sql","html","css","html5","css3","vb.net","powershell","bash",
  // .net
  "asp.net","asp.net core","asp.net mvc",".net",".net core",".net 6",".net 7",".net 8","entity framework","linq","ado.net","wcf","web api","razor","blazor","signalr","minimal api",
  // frontend
  "react","react.js","reactjs","angular","vue","next.js","redux","typescript","webpack","sass","bootstrap","jquery","ajax","tailwind",
  // cloud / azure
  "azure","aws","gcp","azure app service","azure functions","azure sql","azure devops","azure ad","azure active directory","azure key vault","azure service bus","azure event grid","azure monitor","azure pipelines","azure container","azure kubernetes","arm templates","bicep","apim","api management","application insights",
  // devops / ci-cd
  "docker","kubernetes","jenkins","github actions","ci/cd","devops","devsecops","terraform","ansible","helm","git","github","bitbucket","azure repos",
  // security
  "oauth","oauth 2.0","jwt","openid connect","owasp","rbac","role-based access","azure ad b2c","zero trust","ssl","tls",
  // databases
  "sql server","postgresql","mysql","oracle","mongodb","redis","sqlite","cosmos db","elasticsearch","nosql",
  // methodologies
  "agile","scrum","kanban","sdlc","tdd","bdd","ci/cd","devops","microservices","restful","rest api","soap","grpc","event-driven","domain-driven","solid","clean architecture","design patterns",
  // tools
  "visual studio","vs code","jira","confluence","postman","swagger","openapi","sonarqube","serilog","nunit","xunit","moq","selenium","playwright",
  // reporting
  "power bi","ssrs","ssis","crystal reports","tableau",
  // soft skills / certs
  "communication","collaboration","problem-solving","leadership","mentoring","code review","documentation",
]);

function computeAts(resumeText: string, jd: string): AtsResult {
  const clean = (t: string) => t
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_#`>|\\[\\]()]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();

  // Strip JD posting metadata (location lines, apply dates, requisition IDs, boilerplate header)
  const stripMeta = (text: string): string => {
    const lines = text.split("\n");
    // Find first line that looks like real content (sentence with verb or skill mention)
    const contentIdx = lines.findIndex(l =>
      l.length > 60 && /\b(develop|design|build|support|deliver|manage|collaborate|experience|skill|responsible|position|role|software|engineer|architect)\b/i.test(l)
    );
    return (contentIdx > 0 ? lines.slice(contentIdx) : lines).join(" ");
  };

  const resume = clean(resumeText);
  const jdBody = clean(stripMeta(jd));

  // --- extract skills/phrases from JD that are in our known tech list ---
  const jdSkills = new Set<string>();
  // Multi-word first (longest match wins)
  const sortedSkills = [...TECH_SKILLS].sort((a, b) => b.length - a.length);
  for (const skill of sortedSkills) {
    if (jdBody.includes(skill)) jdSkills.add(skill);
  }

  // Broad filler set: connectors, generic verbs, JD boilerplate, posting metadata.
  // These are never real ATS keywords, so they must not count for or against a resume.
  const STOP = new Set(["and","the","for","with","that","this","have","from","are","will","you","our","its","your","their","been","has","not","can","all","each","they","into","which","more","about","also","both","other","through","including","during","within","across","between","provide","ensure","support","work","ability","strong","high","new","may","own","per","use","used","using","based","well","must","required","ability","experience","including","related","equivalent","position","company","team","candidate","role","job","please","apply","date","time","location","posted","days","left","requisition","id","type","full","ohio","texas","antonio","findlay","mpc","june","exciting","career","awaits","committed","great","place","welcomes","encourages","diverse","perspectives","fosters","collaborative","environment",
    // generic verbs / filler seen polluting keyword lists
    "such","while","make","made","makes","impact","eager","curious","hands","ideal","developing","grow","contribute","contributing","enabled","actual","supports","support","performs","perform","stays","stay","conducts","conduct","collaborates","collaborate","produces","produce","carries","carry","knowing","know","applies","apply","tracks","track","belongs","belong","family","jobs","increasing","increase","responsibility","competency","motivated","opportunity","turn","deliver","delivers","build","builds","enhance","enhances","real","value","partners","partner","others","throughout","needed","need","meet","meets","effort","help","helps","join","joining","looking","seeking","want","wants","like","love","passion","passionate","excited","drive","driven","focus","focused","success","successful","ensure","ensures","various","multiple","several","etc","day","daily","year","years","month","plus","preferred","nice","bonus","etc","good","best","better","key","core","overall","general","specific","relevant","appropriate","necessary","effective","efficient","proper","ongoing","current","future","existing","new","large","small","fast","quick","easy","hard","complex","simple",
    // JD job-grade / level boilerplate (not skills)
    "title","grade","level","levels","selected","limited","medium","completion","complexity","execute","executes","roadmap","efforts","effort","leads","lead","scope","band","tier","rank","ranking","seniority","range","salary","compensation","pay","hourly","annual","bonus","equity","benefits","perks","eligible","eligibility","indianapolis","contract","contracts","w2","c2c","onsite","hybrid","remote"]);

  // Also extract capitalized tech terms not in our list (e.g. "Verint", "Dynamics CRM").
  // Reject any phrase containing a stop/filler word, which kills JD section-header
  // fragments like "Experience Bachelor" or "Skills Agile Methodologies".
  const originalJd = jd.replace(/\n/g, " ");
  const capTerms = originalJd.match(/\b[A-Z][A-Za-z0-9+#.]{2,}(?:\s[A-Z][A-Za-z0-9+#.]{2,}){0,2}\b/g) ?? [];
  const metaNoise = new Set(["Apply","End","Date","View","Posted","Today","Ohio","Texas","San","Antonio","Findlay","Full","Time","Position","Summary","Key","This","You","At","MPC","An","In","For","The","And","Or","With","Of","To","A","Is","Are","Was","Be","By","As","On","Not","From","That","Which","Have","Has","Will","Can","May","Its","Our","Their","Your","We","It","If","Who","When","Where","How","Education","Experience","Skills","Requirements","Responsibilities","Qualifications","Summary","Overview","About","Benefits","Description"]);
  for (const t of capTerms) {
    const cleaned = t.trim();
    const normalized = cleaned.replace(/[.,;:]+$/g, "").replace(/[.,;:]\s+/g, " ");
    const words = normalized.toLowerCase().split(" ");
    const firstWord = normalized.split(" ")[0] ?? "";
    // Drop if it leads with metadata, or any token is a stop word, or any token is a JD header
    if (normalized.includes(".")) continue;
    if (metaNoise.has(firstWord) || words.some(w => STOP.has(w) || metaNoise.has(w.charAt(0).toUpperCase() + w.slice(1)))) continue;
    if (normalized.length > 3) jdSkills.add(normalized.toLowerCase());
  }

  const phraseMatches: string[] = [];
  const phraseMissing: string[] = [];
  for (const skill of jdSkills) {
    (resume.includes(skill) ? phraseMatches : phraseMissing).push(skill);
  }

  // Extract unique non-stop words from JD body only (after metadata strip)
  const skillSet = [...jdSkills];
  const jdWords = [...new Set((jdBody.match(/\b[a-z][a-z0-9+#]{2,}\b/g) ?? []).filter(w => !STOP.has(w) && w.length > 3 && !skillSet.some(s => s.includes(w))))];
  const resumeWords = new Set(resume.match(/\b[a-z][a-z0-9+#]{2,}\b/g) ?? []);

  const wordMatches = jdWords.filter(w => resumeWords.has(w));
  const wordMissing = jdWords.filter(w => !resumeWords.has(w));

  // --- required qualifications block ---
  const reqBlock = jdBody.match(/(?:minimum qualifications?|required qualifications?|requirements?)[^]*?(?=preferred|education|skills|$)/i)?.[0] ?? "";
  const requiredMet: string[] = [];
  const requiredMissing: string[] = [];
  if (reqBlock) {
    const reqSkills = [...jdSkills].filter(s => reqBlock.includes(s));
    const reqWords = (reqBlock.match(/\b[a-z][a-z0-9+#]{3,}\b/g) ?? []).filter(w => !STOP.has(w) && !reqSkills.some(s => s.includes(w)));
    for (const s of [...new Set([...reqSkills, ...reqWords])]) {
      if (requiredMet.includes(s) || requiredMissing.includes(s)) continue;
      (resume.includes(s) ? requiredMet : requiredMissing).push(s);
    }
  }

  // --- experience check ---
  let experienceMatch: boolean | null = null;
  const expM = jdBody.match(/(\d+)\+?\s*years?\s+(?:of\s+)?(?:relevant\s+)?(?:it\s+)?experience/);
  if (expM) {
    const needed = parseInt(expM[1] ?? "0");
    const resumeExp = resumeText.match(/(\d{1,2})\+?\s*years?\s+(?:of\s+)?experience/i);
    if (resumeExp) experienceMatch = parseInt(resumeExp[1] ?? "0") >= needed;
    else {
      // count from job timeline
      const years = resumeText.match(/\b(20\d{2})\b/g)?.map(Number) ?? [];
      if (years.length >= 2) experienceMatch = (Math.max(...years) - Math.min(...years)) >= needed;
    }
  }

  // --- education check ---
  let educationMatch: boolean | null = null;
  if (/bachelor|master|degree/.test(jdBody)) {
    educationMatch = /bachelor|master|degree|b\.s\.|m\.s\.|university|college/i.test(resumeText);
  }

  // --- score: weight skills/phrases higher ---
  const skillTotal = phraseMatches.length + phraseMissing.length;
  const wordTotal = Math.min(wordMatches.length + wordMissing.length, 50); // cap noise
  const skillScore = skillTotal > 0 ? (phraseMatches.length / skillTotal) * 70 : 0;
  const wordScore = wordTotal > 0 ? (Math.min(wordMatches.length, 50) / wordTotal) * 30 : 0;
  const score = Math.round(skillScore + wordScore);
  const grade = score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "F";

  return {
    score, grade,
    phraseMatches, phraseMissing,
    wordMatches: wordMatches.slice(0, 40),
    wordMissing: wordMissing.slice(0, 40),
    requiredMet, requiredMissing,
    experienceMatch, educationMatch,
  };
}

// --- Writing-quality analysis (Resume Worded style) ---
interface WritingIssue {
  severity: "high" | "medium" | "low";
  bullet: string;       // the offending bullet text (trimmed)
  problem: string;      // what's wrong
}

interface WritingReport {
  score: number;                 // 0-100 content quality
  totalBullets: number;
  withMetrics: number;
  weakVerbCount: number;
  repeatedVerbs: { verb: string; count: number }[];
  buzzwords: string[];
  issues: WritingIssue[];
}

const WEAK_OPENERS = [
  "responsible for", "worked on", "helped", "assisted", "involved in", "participated in",
  "tasked with", "duties included", "in charge of", "handled", "dealt with", "various",
  "successfully", "effectively",
];

const BUZZWORDS = [
  "leverage", "leveraged", "utilize", "utilized", "spearhead", "spearheaded", "robust",
  "seamless", "seamlessly", "pivotal", "transformative", "synergy", "synergies", "go-getter",
  "team player", "results-driven", "detail-oriented", "self-starter", "think outside the box",
  "best of breed", "value-add", "dynamic", "passionate", "hardworking", "go-to person",
];

// Strong verbs worth not flagging even if repeated a little
const METRIC_RE = /\b\d+(\.\d+)?\s*(%|percent|x|k\b|m\b|million|billion|hours?|days?|weeks?|months?|users?|requests?|records?|services?|apis?|seconds?|ms\b|tps\b|qps\b)?/i;

function analyzeWriting(resumeText: string): WritingReport {
  const lines = resumeText.split("\n").map(l => l.trim());
  const bullets = lines
    .filter(l => /^[-•*]\s+/.test(l))
    .map(l => l.replace(/^[-•*]\s+/, "").trim())
    .filter(l => l.length > 0);

  const issues: WritingIssue[] = [];
  const verbCounts = new Map<string, number>();
  let withMetrics = 0;
  let weakVerbCount = 0;
  const buzzFound = new Set<string>();

  for (const b of bullets) {
    const lower = b.toLowerCase();

    // metric presence
    const hasMetric = METRIC_RE.test(b);
    if (hasMetric) withMetrics++;

    // weak opener
    const weak = WEAK_OPENERS.find(w => lower.startsWith(w));
    if (weak) {
      weakVerbCount++;
      issues.push({ severity: "high", bullet: b, problem: `Weak opener "${weak}" — start with a strong action verb` });
    }

    // first word as the action verb (only if not a weak opener)
    if (!weak) {
      const firstWord = lower.split(/\s+/)[0]?.replace(/[^a-z]/g, "") ?? "";
      if (firstWord.length > 2) verbCounts.set(firstWord, (verbCounts.get(firstWord) ?? 0) + 1);
    }

    // buzzwords
    for (const bw of BUZZWORDS) {
      if (lower.includes(bw)) buzzFound.add(bw);
    }

    // length checks
    const words = b.split(/\s+/).length;
    if (words > 38) issues.push({ severity: "low", bullet: b, problem: `Bullet is long (${words} words) — tighten to one idea` });
    if (words < 6) issues.push({ severity: "low", bullet: b, problem: `Bullet is very short (${words} words) — add impact or context` });
  }

  const repeatedVerbs = [...verbCounts.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([verb, count]) => ({ verb, count }));

  for (const { verb, count } of repeatedVerbs) {
    issues.push({ severity: "medium", bullet: "", problem: `"${verb}" starts ${count} bullets — vary your action verbs` });
  }

  const buzzwords = [...buzzFound];
  for (const bw of buzzwords) {
    issues.push({ severity: "medium", bullet: "", problem: `Buzzword "${bw}" — replace with a concrete achievement` });
  }

  const metricIssueLimit = 8;
  const metricCandidates = bullets
    .filter((bullet) => !METRIC_RE.test(bullet))
    .filter((bullet) => /\b(built|designed|developed|implemented|optimized|migrated|automated|reduced|improved|integrated|deployed|created|led|managed|refactored|monitored|configured|tested|validated|enhanced)\b/i.test(bullet))
    .slice(0, metricIssueLimit);
  for (const bullet of metricCandidates) {
    issues.push({
      severity: "medium",
      bullet,
      problem: "Could use a measurable result or concrete technical scope",
    });
  }

  // Content quality score
  const total = bullets.length || 1;
  const metricRatio = Math.min((withMetrics / total) / 0.25, 1); // target roughly 25% metric/scope bullets, not every bullet
  const weakRatio = weakVerbCount / total;          // want low
  const repeatPenalty = Math.min(repeatedVerbs.reduce((s, r) => s + (r.count - 2), 0) * 2, 20);
  const buzzPenalty = Math.min(buzzwords.length * 4, 20);
  let score = Math.round(
    metricRatio * 55 +
    (1 - Math.min(weakRatio * 2, 1)) * 25 +
    20
  ) - repeatPenalty - buzzPenalty;
  score = Math.max(0, Math.min(100, score));

  // sort issues by severity
  const order = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    score,
    totalBullets: bullets.length,
    withMetrics,
    weakVerbCount,
    repeatedVerbs,
    buzzwords,
    issues: issues.slice(0, 30),
  };
}

// --- Structural / parse checks (Resume.io / Kickresume style) ---
interface StructCheck {
  label: string;
  pass: boolean;
  detail: string;
}

interface StructReport {
  score: number;
  checks: StructCheck[];
}

interface RefineSuggestion {
  id: string;
  label: string;
  instruction: string;
  isCompleted?: boolean;
}

function analyzeStructure(resumeText: string): StructReport {
  const text = resumeText;
  const lower = text.toLowerCase();
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const bullets = lines.filter(l => /^[-•*]\s+/.test(l));

  const has = (re: RegExp) => re.test(text);
  const hasSection = (names: string[]) =>
    lines.some(l => names.includes(l.replace(/:$/, "").toLowerCase()));

  const checks: StructCheck[] = [];

  // Contact block
  const hasEmail = has(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  const hasPhone = has(/(\+?\d[\d\s().-]{7,}\d)/);
  const hasLinkedIn = /linkedin\.com\/in\//.test(lower) || lower.includes("linkedin");
  const hasLocation = /,\s*[A-Z]{2}\b/.test(text) || /\b(remote|tx|ca|ny|wa|dallas|austin|texas)\b/i.test(text);
  const contactBits = [hasEmail, hasPhone, hasLinkedIn, hasLocation].filter(Boolean).length;
  checks.push({
    label: "Contact details complete",
    pass: hasEmail && hasPhone && contactBits >= 3,
    detail: `${contactBits}/4 present (email ${hasEmail ? "✓" : "✗"}, phone ${hasPhone ? "✓" : "✗"}, LinkedIn ${hasLinkedIn ? "✓" : "✗"}, location ${hasLocation ? "✓" : "✗"})`,
  });

  // Required sections
  const sectionDefs: [string, string[]][] = [
    ["Summary", ["professional summary", "summary", "profile", "objective"]],
    ["Skills", ["technical skills", "skills", "core strengths", "core competencies"]],
    ["Experience", ["professional experience", "work experience", "experience", "employment history"]],
    ["Education", ["education"]],
  ];
  for (const [label, names] of sectionDefs) {
    checks.push({
      label: `${label} section present`,
      pass: hasSection(names),
      detail: hasSection(names) ? "Found" : "Missing — ATS expects this heading",
    });
  }

  // Word count
  const wcOk = wordCount >= 400 && wordCount <= 1000;
  checks.push({
    label: "Healthy length",
    pass: wcOk,
    detail: `${wordCount} words ${wcOk ? "(ideal 400-1000)" : wordCount < 400 ? "— too thin, add detail" : "— too long, trim"}`,
  });

  // Bullet density
  const bulletOk = bullets.length >= 8;
  checks.push({
    label: "Enough achievement bullets",
    pass: bulletOk,
    detail: `${bullets.length} bullets ${bulletOk ? "" : "— add more accomplishments"}`,
  });

  // Date presence / consistency
  const dateMatches = text.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d{2}\b/gi) ?? [];
  checks.push({
    label: "Dated work history",
    pass: dateMatches.length >= 2,
    detail: dateMatches.length >= 2 ? `${dateMatches.length} dated entries` : "Add month-year dates to roles",
  });

  // Parse-breakers: characters that confuse ATS parsers
  const parseBreakers = text.match(/[│┃▪▶◆●★☆➤»« ​﻿  ]/g) ?? [];
  checks.push({
    label: "No parse-breaking characters",
    pass: parseBreakers.length === 0,
    detail: parseBreakers.length === 0 ? "Clean plain text" : `${parseBreakers.length} risky glyph(s) found`,
  });

  const passed = checks.filter(c => c.pass).length;
  const score = Math.round((passed / checks.length) * 100);
  return { score, checks };
}

const SECTION_HEADINGS = new Set([
  "summary","objective","profile","technical skills","skills","core competencies",
  "experience","work experience","professional experience","employment history",
  "education","certifications","certification","projects","achievements","awards",
  "publications","languages","interests",
]);

function isResumeHeading(line: string): boolean {
  const stripped = line.trim().replace(/:$/, "").trim();
  if (!stripped || stripped.length > 60) return false;
  if (SECTION_HEADINGS.has(stripped.toLowerCase())) return true;
  return stripped === stripped.toUpperCase() && /[A-Z]/.test(stripped) && stripped.split(/\s+/).length <= 5;
}

function WordPreview({ text }: { text: string }) {
  const lines = text.trim().split("\n");
  const firstContent = lines.find(l => l.trim()) ?? "";
  let nameRendered = false;
  let pastFirstHeading = false;

  return (
    <div className="max-h-[600px] overflow-y-auto rounded-lg border bg-white dark:bg-zinc-900 px-10 py-8 shadow-inner">
      {lines.map((raw, i) => {
        const line = raw.trim();
        if (!line) return null;
        if (!nameRendered && line === firstContent.trim()) {
          nameRendered = true;
          return <p key={i} className="text-center text-xl font-bold text-zinc-900 dark:text-zinc-100">{line}</p>;
        }
        if (isResumeHeading(line)) {
          pastFirstHeading = true;
          return (
            <p key={i} className="mt-4 mb-1 border-b border-zinc-300 dark:border-zinc-700 pb-0.5 text-sm font-bold tracking-wide text-[#1f3a5f] dark:text-blue-300">
              {line.replace(/:$/, "").toUpperCase()}
            </p>
          );
        }
        if (!pastFirstHeading) {
          return <p key={i} className="text-center text-xs text-zinc-600 dark:text-zinc-400">{line}</p>;
        }
        if (/^[-•*]\s+/.test(line)) {
          return <p key={i} className="ml-5 text-sm text-zinc-800 dark:text-zinc-200">• {line.replace(/^[-•*]\s+/, "")}</p>;
        }
        return <p key={i} className="mt-0.5 text-sm text-zinc-800 dark:text-zinc-200">{line}</p>;
      })}
    </div>
  );
}

function bufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const modelChoices = resumeModelChoices();
const defaultModelChoice = modelChoices[0] ?? {
  provider: "openrouter",
  model: "meta-llama/llama-3.3-70b-instruct:free",
  label: "Free: OpenRouter Llama 3.3 70B",
  tier: "Free / Low cost" as const,
};

export default function ResumeLabPage() {
  const router = useRouter();
  const [profiles, setProfiles] = useState<JobProfile[]>(defaultProfiles);
  const [profileId, setProfileId] = useState("dotnet");
  const [resumeText, setResumeText] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [jobContext, setJobContext] = useState("No job selected");
  const [jobTitle, setJobTitle] = useState("");
  const [jobCompany, setJobCompany] = useState("");
  const [jobUrl, setJobUrl] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<ResumeRebuildResult | null>(null);
  const [selectedModel, setSelectedModel] = useState(`${defaultModelChoice.provider}|${defaultModelChoice.model}`);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [refineLoading, setRefineLoading] = useState(false);
  const [atsBefore, setAtsBefore] = useState<AtsResult | null>(null);
  const [atsAfter, setAtsAfter] = useState<AtsResult | null>(null);
  const atsDropped = Boolean(atsBefore && atsAfter && atsAfter.score < atsBefore.score);

  // Auto-compute ATS when preloaded resume + job description arrive
  useEffect(() => {
    if (rebuildResult && jobDescription.trim().length > 50 && !atsAfter) {
      const after = computeAts(rebuildResult.rebuilt_resume, jobDescription);
      setAtsAfter(after);
      setAtsBefore(after); // ponytail: no "before" for preloaded — set equal so no drop warning
    }
  }, [rebuildResult, jobDescription, atsAfter]);

  const [showPreview, setShowPreview] = useState(true);
  const [docxLoading, setDocxLoading] = useState(false);
  const [refinePulse, setRefinePulse] = useState(false);
  const [activeChipLabel, setActiveChipLabel] = useState<string | null>(null);
  const [completedSuggestionIds, setCompletedSuggestionIds] = useState<string[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const atsResultRef = useRef<HTMLDivElement>(null);
  const [coverLetter, setCoverLetter] = useState("");
  const [coverLetterProvider, setCoverLetterProvider] = useState("");
  const [coverLetterLoading, setCoverLetterLoading] = useState(false);
  const [coverLetterDocxLoading, setCoverLetterDocxLoading] = useState(false);

  async function downloadWord() {
    if (!rebuildResult) return;
    setDocxLoading(true);
    try {
      const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_").slice(0, 50);
      const candidateName = sanitize(rebuildResult.rebuilt_resume.trim().split("\n")[0]?.trim() || "Santosh_Mulakidi");
      const titlePart = sanitize(jobTitle.trim() || "Resume");
      const companyPart = sanitize(jobCompany.trim());
      const name = [candidateName, titlePart, companyPart].filter(Boolean).join("_").replace(/_+/g, "_").slice(0, 120);
      const { blob, savedTo } = await exportResumeDocx(rebuildResult.rebuilt_resume, name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.docx`;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(savedTo ? `Word resume saved to ${savedTo}` : "Word resume downloaded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Word export failed");
    } finally {
      setDocxLoading(false);
    }
  }

  const activeProfile = profiles.find((profile) => profile.id === profileId) ?? profiles[0];

  useEffect(() => {
    const storedProfiles = loadProfiles();
    setProfiles(storedProfiles);
    setProfileId(storedProfiles[0]?.id ?? "dotnet");
    setResumeText(storedProfiles[0]?.baseResume ?? "");

    async function loadJobContext() {
      const params = new URLSearchParams(window.location.search);
      const jobId = Number(params.get("jobId"));
      const stored = window.sessionStorage.getItem("resumeLabJob");
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as {
            id?: number;
            title?: string;
            company?: string | null;
            location?: string | null;
            description?: string;
            jobUrl?: string | null;
            returnTo?: string;
            preloadedResume?: string;
          };
          if (parsed.preloadedResume?.trim()) {
            setRebuildResult({ provider: "saved", model: null, rebuilt_resume: parsed.preloadedResume, change_summary: [], warnings: [], prompt: "" });
          }
          if (parsed.jobUrl) setJobUrl(parsed.jobUrl);
          if (!jobId || parsed.id === jobId) {
            setJobContext(`${parsed.title ?? "Selected job"}${parsed.company ? ` at ${parsed.company}` : ""}${parsed.location ? ` | ${parsed.location}` : ""}`);
            if (parsed.title) setJobTitle(parsed.title);
            if (parsed.company) setJobCompany(parsed.company);
            setReturnTo(parsed.returnTo ?? "/jobs");
            if (parsed.description?.trim()) {
              setJobDescription(parsed.description);
              return;
            }
            if (parsed.id) {
              const job = await getJob(parsed.id);
              setJobDescription(job.description ?? "");
              setJobContext(`${job.title}${job.company_name ? ` at ${job.company_name}` : ""}${job.location ? ` | ${job.location}` : ""}`);
              setJobTitle(job.title);
              if (job.company_name) setJobCompany(job.company_name);
              if (job.job_url) setJobUrl(job.job_url);
              return;
            }
            if (parsed.title) {
              const jobs = await getJobs(200);
              const matchedJob = jobs.find((job) => (
                job.title === parsed.title
                && (!parsed.company || job.company_name === parsed.company)
              ));
              if (matchedJob) {
                setJobDescription(matchedJob.description ?? "");
                setJobContext(`${matchedJob.title}${matchedJob.company_name ? ` at ${matchedJob.company_name}` : ""}${matchedJob.location ? ` | ${matchedJob.location}` : ""}`);
                if (matchedJob.company_name) setJobCompany(matchedJob.company_name);
                window.sessionStorage.setItem("resumeLabJob", JSON.stringify({
                  id: matchedJob.id,
                  title: matchedJob.title,
                  company: matchedJob.company_name,
                  location: matchedJob.location,
                  jobUrl: matchedJob.job_url,
                  description: matchedJob.description ?? "",
                  returnTo: parsed.returnTo ?? "/jobs",
                }));
                return;
              }
            }
            setJobDescription("");
            return;
          }
        } catch {
          window.sessionStorage.removeItem("resumeLabJob");
        }
      }

      if (jobId) {
        try {
          const job = await getJob(jobId);
          setJobDescription(job.description ?? "");
          setJobContext(`${job.title}${job.company_name ? ` at ${job.company_name}` : ""}${job.location ? ` | ${job.location}` : ""}`);
          setJobTitle(job.title);
          if (job.company_name) setJobCompany(job.company_name);
          setReturnTo("/jobs");
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not load job description");
        }
      }
    }

    void loadJobContext();
  }, []);

  function updateActiveProfile(values: Partial<JobProfile>) {
    setProfiles((current) => current.map((profile) => (
      profile.id === profileId ? { ...profile, ...values } : profile
    )));
  }

  function selectProfile(nextProfileId: string) {
    const nextProfile = profiles.find((profile) => profile.id === nextProfileId);
    setProfileId(nextProfileId);
    setResumeText(nextProfile?.baseResume ?? "");
  }

  function createProfile() {
    const name = window.prompt("Profile name");
    if (!name?.trim()) return;
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    const nextProfile: JobProfile = {
      id,
      name: name.trim(),
      searchTerm: "",
      locations: "United States, Remote",
      preferredTitles: [],
      skills: [],
      baseResume: "",
    };
    const nextProfiles = [...profiles, nextProfile];
    setProfiles(nextProfiles);
    setProfileId(id);
    setResumeText("");
    saveProfiles(nextProfiles);
    toast.success("Profile created");
  }

  function saveActiveProfile() {
    const nextProfiles = profiles.map((profile) => (
      profile.id === profileId ? { ...profile, baseResume: resumeText } : profile
    ));
    setProfiles(nextProfiles);
    saveProfiles(nextProfiles);
    toast.success("Profile saved");
  }

  async function importResume(file: File | undefined) {
    if (!file) return;
    try {
      const text = bufferToBase64(await file.arrayBuffer());
      const result = await parseResume(file.name, text);
      setResumeText(result.text);
      updateActiveProfile({ baseResume: result.text });
      toast.success("Resume imported");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Resume import failed");
    }
  }

  async function rebuildTailoredResume() {
    if (resumeText.trim().length < 50) {
      toast.error("Attach or paste your base resume first");
      return;
    }
    if (jobDescription.trim().length < 50) {
      toast.error("Add a job description first");
      return;
    }

    setRebuildLoading(true);
    setRebuildResult(null);
    setAtsBefore(null);
    setAtsAfter(null);
    setCompletedSuggestionIds([]);
    try {
      const before = computeAts(resumeText, jobDescription);
      const result = await rebuildResume({
        base_resume: resumeText,
        job_description: jobDescription,
        profile_name: activeProfile?.name ?? null,
        target_title: jobContext,
        provider: selectedModel.slice(0, selectedModel.indexOf("|")),
        model: selectedModel.slice(selectedModel.indexOf("|") + 1),
      });
      setRebuildResult(result);
      setAtsBefore(before);
      const after = computeAts(result.rebuilt_resume, jobDescription);
      setAtsAfter(after);
      if (after.score < before.score) {
        toast.warning("Rebuild completed, but ATS score dropped. Use Refine to restore missing exact keywords.");
      } else {
        toast.success(result.provider === "prompt_only" ? "Prompt ready for manual AI rebuild" : `Resume rebuilt with ${result.provider}`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Resume rebuild failed");
    } finally {
      setRebuildLoading(false);
    }
  }

  async function refineRebuiltResume(instructionOverride?: string, chipLabel?: string, markIds?: string[]) {
    const instruction = (instructionOverride ?? refineInstruction).trim();
    if (!rebuildResult || !instruction) return;
    setRefineLoading(true);
    if (chipLabel) setActiveChipLabel(chipLabel);
    try {
      const result = await rebuildResume({
        base_resume: rebuildResult.rebuilt_resume,
        job_description: jobDescription,
        profile_name: activeProfile?.name ?? null,
        target_title: jobContext,
        provider: selectedModel.slice(0, selectedModel.indexOf("|")),
        model: selectedModel.slice(selectedModel.indexOf("|") + 1),
        refine_instruction: instruction,
      });
      setRebuildResult(result);
      setAtsAfter(computeAts(result.rebuilt_resume, jobDescription));
      setRefineInstruction("");
      const idsToMark = markIds ?? (chipLabel ? [chipLabel] : []);
      if (idsToMark.length) {
        setCompletedSuggestionIds((current) => [...new Set([...current, ...idsToMark])]);
      }
      toast.success("Resume refined");
      // Scroll to score panel and pulse to show what updated
      setTimeout(() => {
        atsResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        setRefinePulse(true);
        setTimeout(() => setRefinePulse(false), 1500);
      }, 100);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Refinement failed");
    } finally {
      setRefineLoading(false);
      setActiveChipLabel(null);
    }
  }

  // Data-driven refine suggestions based on the current ATS gap analysis.
  function buildRefineSuggestions(): RefineSuggestion[] {
    const out: RefineSuggestion[] = [];
    const ats = atsAfter;
    const resume = rebuildResult?.rebuilt_resume ?? "";
    const bulletCount = (resume.match(/^\s*[-•*]\s+/gm) ?? []).length;

    const missingKeywords = [
      ...new Set([...(ats?.phraseMissing ?? []), ...(ats?.requiredMissing ?? [])]),
    ].filter(Boolean).slice(0, 12);

    if (missingKeywords.length) {
      out.push({
        id: "ats-missing-keywords",
        label: `Add ${missingKeywords.length} missing keywords`,
        instruction:
          `Naturally weave these job-description keywords into the most relevant bullets and the skills section, only where truthful: ${missingKeywords.join(", ")}. Use the exact spelling from the job description. Do not fabricate experience.`,
      });
    }

    if (ats && ats.score < 80) {
      out.push({
        id: "ats-raise-score",
        label: `Raise ATS score (now ${ats.score}%) toward 85%+`,
        instruction:
          `The resume currently scores ${ats.score}% against this job description. Increase keyword and phrase coverage by mirroring the exact job-description terminology across the summary, skills, and experience bullets wherever the candidate genuinely has that experience. Prioritize required keywords. Do not invent skills or employers.`,
      });
    }

    if (bulletCount < 24) {
      out.push({
        id: "content-add-recent-bullets",
        label: "Add 2-3 achievement bullets per recent role",
        instruction:
          "For the two most recent roles, add 2 to 3 additional achievement bullets that incorporate missing job-description keywords. Start each with a varied action verb and include a measurable result only when the base resume supports it. Keep all existing bullets.",
      });
    }

    // Content-quality driven chips — only appear when the analyzer finds the issue.
    const wr = resume ? analyzeWriting(resume) : null;
    if (wr && wr.totalBullets) {
      if (wr.weakVerbCount > 0) {
        out.push({
          id: "quality-weak-openers",
          label: `Fix ${wr.weakVerbCount} weak opener${wr.weakVerbCount > 1 ? "s" : ""}`,
          instruction:
            "Fix Content quality (recruiter view): rewrite every bullet that starts with a weak phrase (Responsible for, Worked on, Assisted, Helped, Involved in, Various, Successfully) so it begins with a strong, specific action verb. Keep the facts identical and preserve the existing resume format.",
        });
      }
      const metricCandidateCount = wr.issues.filter((issue) => issue.problem.includes("measurable result or concrete technical scope")).length;
      if (metricCandidateCount >= 3) {
        out.push({
          id: "quality-metrics-or-context",
          label: `Improve ${metricCandidateCount} bullets with metrics/context`,
          instruction:
            "Fix Content quality (recruiter view): strengthen bullets that have no measurable result. Add concrete metrics only where the base resume supports them; otherwise add truthful scope, system, domain, integration, production support, migration, testing, or cloud context. Do not fabricate numbers.",
        });
      }
      if (wr.repeatedVerbs.length > 0) {
        const verbs = wr.repeatedVerbs.map(r => r.verb).join(", ");
        out.push({
          id: "quality-repeated-verbs",
          label: `Vary repeated verbs (${verbs})`,
          instruction:
            `Fix Content quality (recruiter view): these action verbs are overused at the start of bullets: ${verbs}. Replace the repeats with varied, equally strong action verbs without changing meaning, facts, employers, dates, or tools.`,
        });
      }
      if (wr.buzzwords.length > 0) {
        out.push({
          id: "quality-buzzwords",
          label: `Remove ${wr.buzzwords.length} buzzword${wr.buzzwords.length > 1 ? "s" : ""}`,
          instruction:
            `Fix Content quality (recruiter view): remove these filler buzzwords and replace each with concrete, specific project context from the resume: ${wr.buzzwords.join(", ")}. Keep the writing plain, factual, and recruiter-authentic.`,
        });
      }
    } else {
      out.push({
        id: "quality-add-metrics",
        label: "Add measurable metrics to bullets",
        instruction:
          "Strengthen existing bullets by adding concrete, realistic metrics (percentages, counts, time saved, scale) only where the original resume context supports them. Do not fabricate numbers that contradict the source.",
      });
    }

    out.push({
      id: "quality-tighten-summary",
      label: "Tighten summary with top JD keywords",
      instruction:
        "Fix Content quality (recruiter view): rewrite the professional summary into 3 to 4 sharp sentences that lead with the most important job-description keywords and the candidate's strongest matching experience. Keep it truthful, specific, and free of AI filler words.",
    });

    for (const [index, warning] of (rebuildResult?.warnings ?? []).entries()) {
      const trimmedWarning = warning.trim();
      if (!trimmedWarning) continue;
      out.push({
        id: `warning-${index}-${trimmedWarning.slice(0, 32).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        label: `Fix warning: ${trimmedWarning.slice(0, 46)}${trimmedWarning.length > 46 ? "..." : ""}`,
        instruction:
          `Build a truthful fix for this warning: "${trimmedWarning}". If it is a keyword gap and the base resume supports the skill, add the exact phrase naturally in the relevant skills or experience section. If the base resume does not support it, keep it out of the resume and add a brief KEYWORD GAPS note. Do not fabricate experience, tools, metrics, employers, dates, visa status, or project names.`,
      });
    }

    return out.map((suggestion) => ({
      ...suggestion,
      isCompleted: completedSuggestionIds.includes(suggestion.id),
    })).filter((suggestion) => !suggestion.isCompleted);
  }

  async function generateCoverLetterText() {
    const resumeSource = rebuildResult?.rebuilt_resume ?? resumeText;
    if (resumeSource.trim().length < 50) {
      toast.error("Generate or paste a resume first");
      return;
    }
    if (jobDescription.trim().length < 50) {
      toast.error("Add a job description first");
      return;
    }
    setCoverLetterLoading(true);
    setCoverLetter("");
    try {
      const result = await generateCoverLetter({
        base_resume: resumeSource,
        job_description: jobDescription,
        job_title: jobTitle || null,
        company_name: jobContext.includes(" at ") ? jobContext.split(" at ")[1]?.split(" | ")[0] ?? null : null,
        provider: selectedModel.slice(0, selectedModel.indexOf("|")),
        model: selectedModel.slice(selectedModel.indexOf("|") + 1),
      });
      setCoverLetter(result.cover_letter);
      setCoverLetterProvider(result.provider);
      toast.success(`Cover letter generated with ${result.provider}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cover letter generation failed");
    } finally {
      setCoverLetterLoading(false);
    }
  }

  async function downloadCoverLetterDocx() {
    if (!coverLetter.trim()) return;
    setCoverLetterDocxLoading(true);
    try {
      const resumeSource = rebuildResult?.rebuilt_resume ?? resumeText;
      const { blob, savedTo } = await exportCoverLetterDocx({
        base_resume: resumeSource,
        job_description: jobDescription,
        cover_letter_text: coverLetter,
        job_title: jobTitle || null,
        company_name: jobContext.includes(" at ") ? jobContext.split(" at ")[1]?.split(" | ")[0] ?? null : null,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "_").slice(0, 50);
      const candidateName = sanitize((rebuildResult?.rebuilt_resume ?? resumeText).trim().split("\n")[0]?.trim() || "Candidate");
      const titlePart = sanitize(jobTitle.trim());
      const companyPart = sanitize(jobCompany.trim());
      a.download = [candidateName, "Cover_Letter", titlePart, companyPart].filter(Boolean).join("_").replace(/_+/g, "_").slice(0, 120) + ".docx";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(savedTo ? `Cover letter saved to ${savedTo}` : "Cover letter downloaded as Word document");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cover letter Word export failed");
    } finally {
      setCoverLetterDocxLoading(false);
    }
  }

  async function copyText(text: string, message: string) {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Resume Lab</p>
          <h1 className="mt-1 text-3xl font-medium tracking-tight">Tailor resume and review credibility</h1>
          {returnTo ? (
            <Button className="mt-3" variant="outline" onClick={() => router.push(returnTo)}>
              <ArrowLeft className="h-4 w-4" /> Back to selected job
            </Button>
          ) : null}
        </div>
        <Card className="surface shadow-none">
          <CardHeader>
            <CardTitle>Profile and base resume</CardTitle>
            <CardDescription>Store separate resume and job preferences for each person/profile.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[220px_1fr_auto]">
              <Select value={profileId} onValueChange={selectProfile}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground hover:bg-muted">
                <Upload className="h-4 w-4" /> Attach resume
                <input className="sr-only" type="file" accept=".docx,.txt" onChange={(event) => importResume(event.target.files?.[0])} />
              </label>
              <Button variant="outline" onClick={createProfile}>New profile</Button>
            </div>
            {activeProfile ? (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2 text-sm font-medium">
                  Target search
                  <Input value={activeProfile.searchTerm} onChange={(event) => updateActiveProfile({ searchTerm: event.target.value })} placeholder=".NET developer or Java developer" />
                </label>
                <label className="space-y-2 text-sm font-medium">
                  Location preferences
                  <Input value={activeProfile.locations} onChange={(event) => updateActiveProfile({ locations: event.target.value })} placeholder="United States, Remote, Dallas, TX" />
                </label>
              </div>
            ) : null}
            <Textarea value={resumeText} onChange={(event) => setResumeText(event.target.value)} placeholder="Upload or paste your base resume..." className="min-h-96" />
            <div className="flex flex-wrap gap-2">
              <Button onClick={saveActiveProfile}><Save className="h-4 w-4" /> Save profile</Button>
              <Button variant="outline" onClick={() => copyText(resumeText, "Resume copied")}>Copy resume text</Button>
            </div>
          </CardContent>
        </Card>
        <Card className="surface shadow-none">
          <CardHeader>
            <CardTitle>Job description</CardTitle>
            <CardDescription className="flex items-center gap-2 flex-wrap">
              <span>{jobContext}</span>
              {jobUrl && (
                <a href={jobUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline text-xs font-medium shrink-0">
                  Apply <ArrowUpRight className="h-3 w-3" />
                </a>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
              placeholder="Open a job from the Jobs page or paste a job description here..."
              className="min-h-80"
            />
            <div className="flex flex-wrap gap-2">
              <select
                aria-label="Choose AI model"
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring sm:w-[360px]"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
              >
                {(["Free / Low cost", "Premium"] as const).map((tier) => (
                  <optgroup key={tier} label={tier}>
                    {modelChoices.filter((choice) => choice.tier === tier).map((choice) => (
                      <option key={`${choice.provider}|${choice.model}`} value={`${choice.provider}|${choice.model}`}>
                        {choice.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <Button onClick={rebuildTailoredResume} disabled={rebuildLoading}>
                {rebuildLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Rebuild Resume
              </Button>
              <Button variant="outline" onClick={() => copyText(jobDescription, "Job description copied")}>
                <Copy className="h-4 w-4" /> Copy job description
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card className="surface shadow-none">
          <CardHeader>
            <CardTitle>AI rebuilt resume</CardTitle>
            <CardDescription>
              Choose a free/low-cost model first, or switch to premium Claude models for final polishing. Falls back to a copy-ready prompt when no API key is configured.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {rebuildResult ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="rounded-full border px-3 py-1">Provider: {rebuildResult.provider}</span>
                  {rebuildResult.model ? <span className="rounded-full border px-3 py-1">Model: {rebuildResult.model}</span> : null}
                </div>
                {atsBefore && atsAfter && (
                  <div
                    ref={atsResultRef}
                    className={`rounded-lg border bg-muted/40 p-4 space-y-4 transition-all duration-500 ${refinePulse ? "ring-2 ring-primary ring-offset-2" : ""}`}
                  >
                    {/* Score header */}
                    <div className="flex flex-wrap items-center gap-6">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground mb-1">Before</p>
                        <p className="text-3xl font-bold text-destructive">{atsBefore.score}%</p>
                        <p className="text-sm font-medium text-muted-foreground">Grade {atsBefore.grade}</p>
                      </div>
                      <div className="text-2xl text-muted-foreground">→</div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground mb-1">After</p>
                        <p className={`text-3xl font-bold ${atsAfter.score >= atsBefore.score ? "text-green-600" : "text-destructive"}`}>{atsAfter.score}%</p>
                        <p className="text-sm font-medium text-muted-foreground">Grade {atsAfter.grade}</p>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {atsAfter.score > atsBefore.score
                          ? `+${atsAfter.score - atsBefore.score}% improvement`
                          : atsAfter.score === atsBefore.score ? "No change" : `${atsAfter.score - atsBefore.score}% drop`}
                      </div>
                    </div>

                    {atsDropped && (
                      <div className="rounded border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-300">
                        The AI draft removed or renamed exact JD keywords that your base resume already had. Treat this as a draft, not the final resume. Use Refine with: restore missing exact JD keywords, preserve the full Technical Skills and Education sections, and keep acronyms plus full phrases.
                      </div>
                    )}

                    {/* Required keywords */}
                    {(atsAfter.requiredMet.length > 0 || atsAfter.requiredMissing.length > 0) && (
                      <div>
                        <p className="text-xs font-semibold mb-1 uppercase tracking-wide text-muted-foreground">Required Keywords</p>
                        <div className="flex flex-wrap gap-1">
                          {atsAfter.requiredMet.map(k => <span key={k} className="rounded px-2 py-0.5 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">✓ {k}</span>)}
                          {atsAfter.requiredMissing.map(k => <span key={k} className="rounded px-2 py-0.5 text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">✗ {k}</span>)}
                        </div>
                      </div>
                    )}

                    {/* Phrase matches */}
                    <div>
                      <p className="text-xs font-semibold mb-1 uppercase tracking-wide text-muted-foreground">
                        Phrases — {atsAfter.phraseMatches.length} matched / {atsAfter.phraseMissing.length} missing
                      </p>
                      <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                        {atsAfter.phraseMatches.slice(0, 30).map(k => <span key={k} className="rounded px-2 py-0.5 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">✓ {k}</span>)}
                        {atsAfter.phraseMissing.slice(0, 20).map(k => <span key={k} className="rounded px-2 py-0.5 text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">✗ {k}</span>)}
                      </div>
                    </div>

                    {/* Single keywords */}
                    <div>
                      <p className="text-xs font-semibold mb-1 uppercase tracking-wide text-muted-foreground">
                        Keywords — {atsAfter.wordMatches.length} matched / {atsAfter.wordMissing.length} missing
                      </p>
                      <div className="flex flex-wrap gap-1 max-h-28 overflow-y-auto">
                        {atsAfter.wordMatches.slice(0, 40).map(k => <span key={k} className="rounded px-2 py-0.5 text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">✓ {k}</span>)}
                        {atsAfter.wordMissing.slice(0, 30).map(k => <span key={k} className="rounded px-2 py-0.5 text-xs bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">✗ {k}</span>)}
                      </div>
                    </div>

                    {/* Experience / Education */}
                    <div className="flex flex-wrap gap-4 text-sm">
                      {atsAfter.experienceMatch !== null && (
                        <span className={atsAfter.experienceMatch ? "text-green-600" : "text-destructive"}>
                          {atsAfter.experienceMatch ? "✓" : "✗"} Experience requirement
                        </span>
                      )}
                      {atsAfter.educationMatch !== null && (
                        <span className={atsAfter.educationMatch ? "text-green-600" : "text-destructive"}>
                          {atsAfter.educationMatch ? "✓" : "✗"} Education requirement
                        </span>
                      )}
                    </div>

                    {/* Missing critical phrases — actionable */}
                    {atsAfter.phraseMissing.length > 0 && (
                      <div className="rounded border border-orange-200 bg-orange-50 dark:bg-orange-900/20 dark:border-orange-800 p-3">
                        <p className="text-xs font-semibold text-orange-800 dark:text-orange-400 mb-1">Add these phrases to improve score:</p>
                        <p className="text-xs text-orange-700 dark:text-orange-300">{atsAfter.phraseMissing.slice(0, 10).join(" · ")}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Writing-quality analysis (Resume Worded style) */}
                {(() => {
                  const wr = analyzeWriting(rebuildResult.rebuilt_resume);
                  if (!wr.totalBullets) return null;
                  const sevColor = (s: WritingIssue["severity"]) =>
                    s === "high" ? "text-red-700 dark:text-red-400"
                    : s === "medium" ? "text-orange-700 dark:text-orange-400"
                    : "text-zinc-600 dark:text-zinc-400";
                  const scoreColor = wr.score >= 75 ? "text-green-600" : wr.score >= 55 ? "text-yellow-600" : "text-destructive";
                  return (
                    <div className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium">Content quality (recruiter view)</h3>
                        <span className={`text-lg font-bold ${scoreColor}`}>{wr.score}%</span>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        <span className="rounded bg-muted px-2 py-0.5">{wr.totalBullets} bullets</span>
                        <span className={`rounded px-2 py-0.5 ${wr.withMetrics / wr.totalBullets >= 0.5 ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400"}`}>
                          {wr.withMetrics}/{wr.totalBullets} with metrics
                        </span>
                        {wr.weakVerbCount > 0 && (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-red-800 dark:bg-red-900/30 dark:text-red-400">{wr.weakVerbCount} weak openers</span>
                        )}
                        {wr.buzzwords.length > 0 && (
                          <span className="rounded bg-orange-100 px-2 py-0.5 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">{wr.buzzwords.length} buzzwords</span>
                        )}
                        {wr.repeatedVerbs.length > 0 && (
                          <span className="rounded bg-yellow-100 px-2 py-0.5 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">{wr.repeatedVerbs.length} repeated verbs</span>
                        )}
                      </div>
                      {wr.issues.length > 0 && (
                        <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                          {wr.issues.map((iss, i) => (
                            <li key={i} className="flex gap-1.5">
                              <span className={`font-medium ${sevColor(iss.severity)}`}>•</span>
                              <span>
                                <span className={sevColor(iss.severity)}>{iss.problem}</span>
                                {iss.bullet && <span className="text-muted-foreground"> — “{iss.bullet.slice(0, 70)}{iss.bullet.length > 70 ? "…" : ""}”</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })()}

                {/* Structural / parse checks (Resume.io / Kickresume style) */}
                {(() => {
                  const sr = analyzeStructure(rebuildResult.rebuilt_resume);
                  const scoreColor = sr.score >= 85 ? "text-green-600" : sr.score >= 60 ? "text-yellow-600" : "text-destructive";
                  return (
                    <div className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium">Format & ATS parseability</h3>
                        <span className={`text-lg font-bold ${scoreColor}`}>{sr.score}%</span>
                      </div>
                      <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                        {sr.checks.map((c, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className={c.pass ? "text-green-600" : "text-destructive"}>{c.pass ? "✓" : "✗"}</span>
                            <span>
                              <span className={c.pass ? "" : "text-destructive"}>{c.label}</span>
                              <span className="text-muted-foreground"> — {c.detail}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {rebuildResult.change_summary.length ? (
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <h3 className="mb-2 text-sm font-medium">Change summary</h3>
                    <ul className="max-h-40 overflow-y-auto list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {rebuildResult.change_summary.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </div>
                ) : null}
                {rebuildResult.warnings.length ? (
                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
                    <h3 className="mb-2 text-sm font-medium">Warnings</h3>
                    <ul className="max-h-40 overflow-y-auto list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                      {rebuildResult.warnings.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </div>
                ) : null}
                <div className={`transition-all duration-500 ${refinePulse ? "ring-2 ring-primary ring-offset-2 rounded-lg" : ""}`}>
                  {showPreview
                    ? <WordPreview text={rebuildResult.rebuilt_resume} />
                    : <Textarea value={rebuildResult.rebuilt_resume} readOnly className="min-h-96 max-h-[600px] overflow-y-auto font-mono text-sm" />}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={downloadWord} disabled={docxLoading}>
                    {docxLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download Word (.docx)
                  </Button>
                  <Button variant="outline" onClick={() => setShowPreview(!showPreview)}>
                    <Eye className="h-4 w-4" /> {showPreview ? "Show raw text" : "Show preview"}
                  </Button>
                  <Button variant="outline" onClick={() => copyText(rebuildResult.rebuilt_resume, "Rebuilt resume copied")}>
                    <Copy className="h-4 w-4" /> Copy rebuilt resume
                  </Button>
                  <Button variant="outline" onClick={() => copyText(rebuildResult.prompt, "AI prompt copied")}>
                    <FileText className="h-4 w-4" /> Copy prompt
                  </Button>
                </div>
                <div className="rounded-lg border p-4 space-y-4">
                  <div>
                    <p className="text-sm font-medium">Action plan — click any item to apply</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Sorted by impact. Each click sends an AI refinement pass.</p>
                  </div>

                  {(() => {
                    const suggestions = buildRefineSuggestions();
                    if (!suggestions.length) {
                      return (
                        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-xs text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
                          No action items left. Rebuild or edit the resume again to refresh the action plan.
                        </div>
                      );
                    }
                    const priorityColor = (i: number) =>
                      i === 0 ? "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300 hover:bg-red-100"
                      : i <= 2 ? "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-300 hover:bg-orange-100"
                      : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300 hover:bg-blue-100";
                    const applySelected = async () => {
                      const selected = suggestions.filter(s => selectedSuggestions.has(s.id));
                      if (!selected.length) return;
                      const combined = selected.map(s => s.instruction).join("\n\n");
                      const ids = selected.map(s => s.id);
                      setSelectedSuggestions(new Set());
                      await refineRebuiltResume(combined, "multi-select", ids);
                    };
                    const allSelected = suggestions.every(s => selectedSuggestions.has(s.id));
                    return (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between pb-1">
                          <span className="text-xs font-medium text-muted-foreground">Click items to select, then apply together</span>
                          <button
                            type="button"
                            disabled={refineLoading}
                            onClick={() => setSelectedSuggestions(allSelected ? new Set() : new Set(suggestions.map(s => s.id)))}
                            className="text-xs text-primary hover:underline disabled:opacity-50"
                          >
                            {allSelected ? "Deselect all" : "Select all"}
                          </button>
                        </div>
                        {suggestions.map((s, i) => {
                          const isActive = activeChipLabel === s.id || (activeChipLabel === "multi-select" && selectedSuggestions.has(s.id));
                          const isSelected = selectedSuggestions.has(s.id);
                          return (
                            <button
                              key={s.id}
                              type="button"
                              disabled={refineLoading}
                              onClick={() => {
                                setSelectedSuggestions(prev => {
                                  const next = new Set(prev);
                                  if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                                  return next;
                                });
                              }}
                              className={`w-full text-left flex items-center gap-3 rounded-lg border px-3 py-2.5 text-xs transition disabled:opacity-50 ${isSelected ? "ring-2 ring-primary ring-offset-1 " : ""}${priorityColor(i)}`}
                            >
                              {isActive && activeChipLabel === "multi-select"
                                ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                : isSelected
                                  ? <span className="shrink-0 text-primary font-bold">✓</span>
                                  : <span className="shrink-0 rounded-full bg-current/10 px-1.5 py-0.5 font-bold opacity-60">{i + 1}</span>
                              }
                              <span className="font-medium">{s.label}</span>
                            </button>
                          );
                        })}
                        {selectedSuggestions.size > 0 && (
                          <div className="flex gap-2 pt-1">
                            <button
                              type="button"
                              disabled={refineLoading}
                              onClick={() => void applySelected()}
                              className="flex-1 rounded-lg border border-primary bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition"
                            >
                              {refineLoading && activeChipLabel === "multi-select"
                                ? <span className="flex items-center justify-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Applying…</span>
                                : `Apply ${selectedSuggestions.size} selected`
                              }
                            </button>
                            <button
                              type="button"
                              disabled={refineLoading}
                              onClick={() => setSelectedSuggestions(new Set())}
                              className="rounded-lg border px-3 py-2 text-xs text-muted-foreground hover:bg-muted transition disabled:opacity-50"
                            >
                              Clear
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div className="flex gap-2 pt-1 border-t">
                    <Input
                      value={refineInstruction}
                      onChange={(e) => setRefineInstruction(e.target.value)}
                      placeholder='Custom instruction, e.g. "remove oldest job", "shorten bullets"'
                      onKeyDown={(e) => { if (e.key === "Enter" && !refineLoading) void refineRebuiltResume(); }}
                    />
                    <Button onClick={() => void refineRebuiltResume()} disabled={refineLoading || !refineInstruction.trim()}>
                      {refineLoading && !activeChipLabel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                      Refine
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Attach a base resume, add a job description, then click Rebuild Resume.
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="surface shadow-none">
          <CardHeader>
            <CardTitle>Cover letter</CardTitle>
            <CardDescription>
              Generated from your {rebuildResult ? "rebuilt resume" : "base resume"} and the job description above.
              {jobContext !== "No job selected" ? ` Targeting: ${jobContext}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={generateCoverLetterText} disabled={coverLetterLoading}>
                {coverLetterLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate Cover Letter
              </Button>
              {coverLetter && (
                <>
                  <Button variant="outline" onClick={() => copyText(coverLetter, "Cover letter copied")}>
                    <Copy className="h-4 w-4" /> Copy
                  </Button>
                  <Button variant="outline" onClick={downloadCoverLetterDocx} disabled={coverLetterDocxLoading}>
                    {coverLetterDocxLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    Download Word (.docx)
                  </Button>
                </>
              )}
            </div>
            {coverLetter ? (
              <div className="space-y-2">
                {coverLetterProvider && (
                  <p className="text-xs text-muted-foreground">
                    Generated with <span className="font-medium">{coverLetterProvider}</span> · uses {rebuildResult ? "rebuilt resume" : "base resume"}
                  </p>
                )}
                <Textarea
                  value={coverLetter}
                  onChange={(e) => setCoverLetter(e.target.value)}
                  className="min-h-80 font-sans text-sm leading-relaxed"
                />
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                {rebuildResult
                  ? "Resume rebuilt — click Generate Cover Letter to create a tailored cover letter."
                  : "Add a job description and resume, then click Generate Cover Letter."}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
