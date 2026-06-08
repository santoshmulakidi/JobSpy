const state = {
  jobs: [],
  companies: [],
  companyTargets: [],
  analytics: null,
  stats: null,
  sourceCounts: {},
  applications: [],
  savedSearches: [],
  currentView: "overview",
  activeWorkMode: "",
  qualificationFilter: "",
  resumeLabJobId: null,
  expandedJobIds: new Set(),
  applicationTracker: JSON.parse(localStorage.getItem("job-intelligence-applications") || "{}"),
  baseResumeText: localStorage.getItem("job-intelligence-base-resume") || "",
  activeProfileKey: localStorage.getItem("job-intelligence-active-profile") || "santosh",
  profileStore: JSON.parse(localStorage.getItem("job-intelligence-profile-store") || "null"),
  preferences: JSON.parse(localStorage.getItem("job-intelligence-preferences") || "null") || {
    roles: ".NET Developer, Java Developer, Software Engineer",
    skills: "C#, Java, SQL, AWS, React, API",
    locations: "Dallas, Remote, United States",
    experience: "Senior",
    visa: "H1B/TN/GC friendly",
  },
};

function defaultProfileStore() {
  return {
    santosh: {
      label: "Santosh",
      preferences: state.preferences,
      baseResumeText: state.baseResumeText,
    },
    wife: {
      label: "Wife",
      preferences: {
        roles: "Software Developer, QA Analyst, Business Analyst",
        skills: "SQL, Java, Python, Excel, Testing, API, Agile",
        locations: "Remote, United States",
        experience: "Experienced",
        visa: "H1B/TN/GC friendly",
      },
      baseResumeText: "",
    },
  };
}

if (!state.profileStore) {
  state.profileStore = defaultProfileStore();
}

const themeButtons = document.querySelectorAll("[data-theme-button]");
const savedTheme = localStorage.getItem("job-intelligence-theme");

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("job-intelligence-theme", theme);
  themeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.themeButton === theme);
  });
}

themeButtons.forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.themeButton));
});

if (savedTheme) {
  applyTheme(savedTheme);
}

const supportedSources = [
  "linkedin",
  "indeed",
  "google",
  "zip_recruiter",
  "glassdoor",
  "career_page",
  "jobright_h1b",
  "dice",
  "governmentjobs",
  "usajobs_api",
  "jobspresso",
  "dynamitejobs",
  "skipthedrive",
  "remotive",
  "yc_jobs",
  "remotely",
  "simplify_new_grad",
  "github_internships",
];

const els = {
  apiStatusDot: document.querySelector("#apiStatusDot"),
  apiStatusText: document.querySelector("#apiStatusText"),
  viewTitle: document.querySelector("#viewTitle"),
  totalJobs: document.querySelector("#totalJobs"),
  remoteJobs: document.querySelector("#remoteJobs"),
  companyCount: document.querySelector("#companyCount"),
  visaScoreJobs: document.querySelector("#visaScoreJobs"),
  companyChart: document.querySelector("#companyChart"),
  locationChart: document.querySelector("#locationChart"),
  skillCloud: document.querySelector("#skillCloud"),
  latestJobs: document.querySelector("#latestJobs"),
  jobsTableBody: document.querySelector("#jobsTableBody"),
  jobCountLabel: document.querySelector("#jobCountLabel"),
  trackerTableBody: document.querySelector("#trackerTableBody"),
  trackerCountLabel: document.querySelector("#trackerCountLabel"),
  savedSearchesBody: document.querySelector("#savedSearchesBody"),
  savedSearchCountLabel: document.querySelector("#savedSearchCountLabel"),
  profileSelect: document.querySelector("#profileSelect"),
  resumeJobSelect: document.querySelector("#resumeJobSelect"),
  resumeFileInput: document.querySelector("#resumeFileInput"),
  resumeImportStatus: document.querySelector("#resumeImportStatus"),
  baseResumeInput: document.querySelector("#baseResumeInput"),
  resumeLabOutput: document.querySelector("#resumeLabOutput"),
  refreshResumeLabButton: document.querySelector("#refreshResumeLabButton"),
  copyPromptButton: document.querySelector("#copyPromptButton"),
  downloadPromptButton: document.querySelector("#downloadPromptButton"),
  downloadAuthenticityButton: document.querySelector("#downloadAuthenticityButton"),
  sourceHealthGrid: document.querySelector("#sourceHealthGrid"),
  sourceHealthLabel: document.querySelector("#sourceHealthLabel"),
  companyTargetsGrid: document.querySelector("#companyTargetsGrid"),
  companyTargetCountLabel: document.querySelector("#companyTargetCountLabel"),
  companiesGrid: document.querySelector("#companiesGrid"),
  companyCountLabel: document.querySelector("#companyCountLabel"),
  collectOutput: document.querySelector("#collectOutput"),
  collectButton: document.querySelector("#collectButton"),
  quickCollectButton: document.querySelector("#quickCollectButton"),
  selectAllSourcesButton: document.querySelector("#selectAllSourcesButton"),
  clearAllSourcesButton: document.querySelector("#clearAllSourcesButton"),
  linkedinOnlyButton: document.querySelector("#linkedinOnlyButton"),
  linkedinLatestButton: document.querySelector("#linkedinLatestButton"),
  linkedinLatestHoursSelect: document.querySelector("#linkedinLatestHoursSelect"),
  saveSearchButton: document.querySelector("#saveSearchButton"),
  startHourlyRefreshButton: document.querySelector("#startHourlyRefreshButton"),
  stopHourlyRefreshButton: document.querySelector("#stopHourlyRefreshButton"),
  schedulerStatusText: document.querySelector("#schedulerStatusText"),
  linkedinCompanyTargetsButton: document.querySelector("#linkedinCompanyTargetsButton"),
  visaFriendlyCompaniesButton: document.querySelector("#visaFriendlyCompaniesButton"),
  toast: document.querySelector("#toast"),
  drawer: document.querySelector("#jobDrawer"),
  drawerSource: document.querySelector("#drawerSource"),
  drawerTitle: document.querySelector("#drawerTitle"),
  drawerCompany: document.querySelector("#drawerCompany"),
  drawerMeta: document.querySelector("#drawerMeta"),
  drawerDescription: document.querySelector("#drawerDescription"),
  drawerLink: document.querySelector("#drawerLink"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

function setApiStatus(ok) {
  els.apiStatusDot.classList.toggle("is-ok", ok);
  els.apiStatusDot.classList.toggle("is-error", !ok);
  els.apiStatusText.textContent = ok ? "API online" : "API offline";
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  window.setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
}

function formatSalary(job) {
  const min = job.min_amount ? Math.round(job.min_amount).toLocaleString() : null;
  const max = job.max_amount ? Math.round(job.max_amount).toLocaleString() : null;
  const currency = job.currency || "USD";
  if (min && max) return `${currency} ${min}-${max}`;
  if (min) return `${currency} ${min}+`;
  if (max) return `Up to ${currency} ${max}`;
  return "Not listed";
}

function shortDate(value) {
  if (!value) return "Unknown";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function shortDateTime(value) {
  if (!value) return "Not scheduled";
  return parseApiDateTime(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseApiDateTime(value) {
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text) && !/(Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    return new Date(`${text}Z`);
  }
  return new Date(text);
}

function centralDateTime(value) {
  if (!value) return "Not captured";
  return parseApiDateTime(value).toLocaleString(undefined, {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function postingTimestamp(job) {
  if (!job.date_posted) return "Posting time not provided";
  if (/^\d{4}-\d{2}-\d{2}$/.test(job.date_posted)) {
    return `Posted ${shortDate(job.date_posted)} (source date)`;
  }
  return `Posted ${centralDateTime(job.date_posted)}`;
}

function splitTerms(value) {
  return String(value || "")
    .split(/[,|]/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function jobText(job) {
  return [
    job.title,
    job.company_name,
    job.location,
    job.description,
    job.job_type,
    job.visa_status,
    job.work_mode,
  ].join(" ").toLowerCase();
}

function jobIntelligenceScore(job) {
  if (job.qualification_status) {
    return {
      score: job.fit_score || 0,
      qualified: job.qualification_status === "Qualified",
      status: job.qualification_status,
      reasons: job.qualification_reasons?.length ? job.qualification_reasons : ["needs review"],
    };
  }
  const text = jobText(job);
  const roles = splitTerms(state.preferences.roles);
  const skills = splitTerms(state.preferences.skills);
  const locations = splitTerms(state.preferences.locations);
  let score = 0;
  const reasons = [];

  if (roles.some((role) => text.includes(role))) {
    score += 25;
    reasons.push("role match");
  }
  const skillMatches = skills.filter((skill) => text.includes(skill));
  if (skillMatches.length) {
    score += Math.min(30, skillMatches.length * 8);
    reasons.push(`${skillMatches.length} skill match${skillMatches.length === 1 ? "" : "es"}`);
  }
  if (locations.some((location) => text.includes(location)) || job.is_remote) {
    score += 15;
    reasons.push("location match");
  }
  if (job.visa_score === "High") {
    score += 20;
    reasons.push("strong visa signal");
  } else if (job.visa_score === "Medium") {
    score += 10;
    reasons.push("possible visa signal");
  }
  if ((job.apply_priority || "").toLowerCase() === "high") {
    score += 10;
    reasons.push("high priority");
  }

  const finalScore = Math.min(100, score);
  return {
    score: finalScore,
    qualified: finalScore >= 45 && job.visa_status !== "USC/GC required",
    status: finalScore >= 45 && job.visa_status !== "USC/GC required" ? "Qualified" : "Disqualified",
    reasons: reasons.length ? reasons : ["needs review"],
  };
}

function jobTrustScore(job) {
  return {
    score: job.trust_score ?? 0,
    status: job.trust_status || "Review",
    reasons: job.trust_reasons?.length ? job.trust_reasons : ["needs source review"],
  };
}

function saveApplicationTracker() {
  localStorage.setItem("job-intelligence-applications", JSON.stringify(state.applicationTracker));
}

function trackerEntry(job) {
  return state.applications.find((item) => String(item.job_id) === String(job.id))
    || state.applicationTracker[String(job.id)]
    || (job.application_status ? { status: job.application_status, applied_at: job.applied_at } : null);
}

async function markApplied(jobId) {
  const job = state.jobs.find((item) => String(item.id) === String(jobId));
  if (!job) return;
  const resumeText = generateResume(job);
  const coverLetterText = generateCoverLetter(job);
  try {
    const application = await api(`/jobs/${job.id}/apply`, {
      method: "POST",
      body: JSON.stringify({
        status: "Applied",
        resume_text: resumeText,
        cover_letter_text: coverLetterText,
      }),
    });
    state.applications = [
      application,
      ...state.applications.filter((item) => String(item.job_id) !== String(job.id)),
    ];
    job.application_status = application.status;
    job.applied_at = application.applied_at;
  } catch (error) {
    showToast("Could not save application to database; saved locally.");
  }
  state.applicationTracker[String(job.id)] = {
    job_id: job.id,
    title: job.title,
    company_name: job.company_name,
    location: job.location,
    job_url: job.job_url,
    source: job.source,
    status: "Applied",
    applied_at: new Date().toISOString(),
  };
  saveApplicationTracker();
  renderJobs();
  renderTracker();
  showToast("Job marked as applied.");
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeFilename(value) {
  return String(value || "job").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function generateResume(job) {
  const score = jobIntelligenceScore(job);
  return [
    `${state.preferences.roles.split(",")[0]?.trim() || "Software Developer"} Resume`,
    "",
    "Target Job",
    `${job.title} at ${job.company_name || "Unknown company"}`,
    "",
    "Profile Summary",
    `${state.preferences.experience || "Experienced"} developer aligned to ${job.title}. Strong fit signals: ${score.reasons.join(", ")}.`,
    "",
    "Core Skills",
    state.preferences.skills,
    "",
    "Relevant Keywords",
    [job.title, job.job_type, job.work_mode, job.visa_status].filter(Boolean).join(", "),
    "",
    "Job Notes",
    (job.description || "No description captured.").slice(0, 1200),
  ].join("\n");
}

function recruiterAuthenticityReview(resumeText, job) {
  const text = String(resumeText || "");
  const lower = text.toLowerCase();
  const bullets = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 30);
  const genericTerms = [
    "leveraged", "cutting-edge", "dynamic", "results-driven", "organizational efficiency",
    "synergy", "innovative solutions", "proven track record", "cross-functional",
    "fast-paced environment", "business outcomes",
  ];
  const concreteTech = [
    ".net", "c#", "java", "spring", "sql", "postgresql", "azure", "aws", "aks",
    "kubernetes", "docker", "terraform", "kafka", "redis", "react", "angular",
    "api", "microservices", "github actions", "ci/cd",
  ];
  const metricMatches = text.match(/(\d+(\.\d+)?%|\$[\d,.]+|\d+[kKmM+]|\d+\s*(ms|seconds|minutes|hours|days|requests|users|services|apis|deployments|members|engineers))/g) || [];
  const genericMatches = genericTerms.filter((term) => lower.includes(term));
  const techMatches = concreteTech.filter((term) => lower.includes(term));
  const starts = bullets.map((line) => line.split(/\s+/).slice(0, 2).join(" ").toLowerCase());
  const repeatedStarts = starts.length - new Set(starts).size;
  const jobKeywordHits = jobKeywords(job).filter((term) => lower.includes(term.toLowerCase()));

  let score = 62;
  const strengths = [];
  const risks = [];
  const fixes = [];

  if (metricMatches.length >= 3) {
    score += 16;
    strengths.push("Uses multiple measurable outcomes.");
  } else if (metricMatches.length) {
    score += 8;
    strengths.push("Includes some measurable outcomes.");
    fixes.push("Add more quantified impact: latency, cost, throughput, users, deployments, or team size.");
  } else {
    score -= 18;
    risks.push("No measurable outcomes found.");
    fixes.push("Add real metrics such as API latency reduction, request volume, cloud cost savings, or release-time improvement.");
  }

  if (techMatches.length >= 5) {
    score += 12;
    strengths.push("Contains concrete technical stack details.");
  } else {
    score -= 8;
    risks.push("Technical stack is not specific enough.");
    fixes.push("Name exact services/frameworks used, such as .NET 8, Azure AKS, Terraform, Kafka, SQL Server, or GitHub Actions.");
  }

  if (jobKeywordHits.length >= 4) {
    score += 8;
    strengths.push("Aligns with several job-description keywords.");
  } else if (job.description) {
    score -= 6;
    risks.push("Low job-keyword overlap.");
    fixes.push("Add truthful job keywords only where your experience supports them.");
  }

  if (genericMatches.length >= 3) {
    score -= 16;
    risks.push("Generic AI-style buzzwords appear repeatedly.");
    fixes.push(`Replace vague phrases: ${genericMatches.slice(0, 4).join(", ")}.`);
  } else if (genericMatches.length) {
    score -= 6;
    risks.push("Some generic wording appears.");
  }

  if (repeatedStarts >= 3) {
    score -= 10;
    risks.push("Several bullets start with similar phrasing.");
    fixes.push("Vary bullet structure and verbs so the resume reads less templated.");
  }

  if (bullets.length < 6) {
    score -= 8;
    risks.push("Resume draft is too thin for senior-level review.");
    fixes.push("Add senior-level project bullets with architecture decisions, ownership, and production impact.");
  }

  const authenticityScore = Math.max(0, Math.min(100, score));
  const credibilityLevel = authenticityScore >= 78 ? "Strong" : authenticityScore >= 58 ? "Needs polish" : "Weak";
  if (!strengths.length) strengths.push("Draft has a usable structure but needs more proof.");
  if (!risks.length) risks.push("No major recruiter credibility issues found.");
  if (!fixes.length) fixes.push("Keep claims truthful and be ready to explain every technology in interviews.");

  return {
    authenticityScore,
    credibilityLevel,
    metricCount: metricMatches.length,
    techCount: techMatches.length,
    genericCount: genericMatches.length,
    repeatedStarts,
    jobKeywordCount: jobKeywordHits.length,
    strengths,
    risks,
    fixes,
  };
}

function generateCoverLetter(job) {
  return [
    `Cover Letter - ${job.title}`,
    "",
    `Dear ${job.company_name || "Hiring"} Team,`,
    "",
    `I am interested in the ${job.title} role${job.company_name ? ` at ${job.company_name}` : ""}. My background in ${state.preferences.skills} aligns well with this opportunity, and I am especially interested because the role matches my target profile: ${state.preferences.roles}.`,
    "",
    `I am targeting ${state.preferences.locations} opportunities and my work authorization preference is ${state.preferences.visa}.`,
    "",
    "Thank you for your time and consideration.",
  ].join("\n");
}

function sendForResume(jobId) {
  const job = state.jobs.find((item) => String(item.id) === String(jobId));
  if (!job) return;
  downloadTextFile(`${safeFilename(job.company_name)}-${safeFilename(job.title)}-resume.txt`, generateResume(job));
  showToast("Tailored resume downloaded.");
}

function sendForCoverLetter(jobId) {
  const job = state.jobs.find((item) => String(item.id) === String(jobId));
  if (!job) return;
  downloadTextFile(`${safeFilename(job.company_name)}-${safeFilename(job.title)}-cover-letter.txt`, generateCoverLetter(job));
  showToast("Cover letter downloaded.");
}

function selectedResumeJob() {
  const selectedId = state.resumeLabJobId || els.resumeJobSelect?.value;
  return state.jobs.find((job) => String(job.id) === String(selectedId)) || state.jobs[0] || null;
}

function jobKeywords(job) {
  const profileSkills = splitTermsForSave(state.preferences.skills);
  const technologyTerms = [
    "C#", ".NET", "ASP.NET", "Java", "Spring Boot", "SQL", "PostgreSQL", "AWS", "Azure",
    "React", "Angular", "TypeScript", "REST", "API", "Microservices", "Docker",
    "Kubernetes", "CI/CD", "Kafka", "Redis", "NoSQL", "Agile", "Leadership",
  ];
  const text = jobText(job);
  return [...new Set([...profileSkills, ...technologyTerms])]
    .filter((term) => text.includes(term.toLowerCase()))
    .slice(0, 18);
}

function resumeLabReview(job) {
  const scoring = jobIntelligenceScore(job);
  const trust = jobTrustScore(job);
  const matched = job.matched_skills?.length ? job.matched_skills : jobKeywords(job).slice(0, 8);
  const missing = job.missing_skills?.length ? job.missing_skills : splitTermsForSave(state.preferences.skills)
    .filter((skill) => !matched.map((item) => item.toLowerCase()).includes(skill.toLowerCase()))
    .slice(0, 8);
  const keywords = jobKeywords(job);
  const checklist = [
    scoring.score >= 55 ? "Profile fit is strong enough for tailoring." : "Profile fit needs more targeted evidence.",
    trust.status === "Risk" ? "Review source quality before applying." : "Source quality is acceptable for review.",
    job.description ? "Job description is available for keyword extraction." : "Job description is missing, so use title/company signals only.",
    missing.length ? "Add truthful evidence for missing keywords before applying." : "Core profile skills are covered.",
  ];
  return { scoring, trust, matched, missing, keywords, checklist };
}

function buildTailoringPrompt(job) {
  const review = resumeLabReview(job);
  const baseResume = state.baseResumeText || "Use my stored profile preferences as the resume source. Do not invent experience.";
  return [
    "Act as a senior technical resume editor for US software engineering roles.",
    "",
    "Goal:",
    "Tailor my resume and cover letter for this job while staying truthful, ATS-friendly, concise, and senior-level.",
    "",
    "Rules:",
    "- Do not fabricate employers, titles, dates, degrees, skills, certifications, immigration status, or metrics.",
    "- Preserve my real experience and only reframe wording when supported by the source resume.",
    "- Prefer impact bullets with action, system/context, measurable result, and relevant technology.",
    "- Optimize for ATS keyword coverage without keyword stuffing.",
    "- Flag any keyword that is important but not supported by my resume.",
    "",
    "Target job:",
    `Title: ${job.title}`,
    `Company: ${job.company_name || "Unknown company"}`,
    `Location: ${job.location || "Unknown location"}`,
    `Work mode: ${job.work_mode || "Unknown"}`,
    `Visa signal: ${job.visa_status || "Not specified"}`,
    `Profile fit score: ${review.scoring.score}`,
    `Trust score: ${review.trust.status} ${review.trust.score}`,
    "",
    "Important job keywords:",
    review.keywords.join(", ") || "No keywords captured.",
    "",
    "Matched skills:",
    review.matched.join(", ") || "No matched skills captured.",
    "",
    "Missing or weak skills to handle carefully:",
    review.missing.join(", ") || "No major missing skills captured.",
    "",
    "Job description:",
    job.description || "No full job description captured. Use only title, company, source, and profile signals.",
    "",
    "My resume/profile source:",
    baseResume,
    "",
    "Output:",
    "1. ATS match summary with strengths, gaps, and risk notes.",
    "2. Rewritten professional summary, 3-4 lines.",
    "3. 6-8 tailored senior engineering bullets.",
    "4. Skills section ordered by relevance.",
    "5. Short cover letter draft.",
    "6. Final checklist of claims I must verify before applying.",
  ].join("\n");
}

function renderResumeLab() {
  if (!els.resumeJobSelect || !els.resumeLabOutput) return;
  if (els.profileSelect) {
    els.profileSelect.value = state.activeProfileKey;
  }
  if (els.baseResumeInput) {
    els.baseResumeInput.value = state.baseResumeText;
  }
  if (!state.jobs.length) {
    els.resumeJobSelect.innerHTML = "<option>No jobs loaded</option>";
    els.resumeLabOutput.innerHTML = `<div class="empty-state">Load or collect jobs before using Resume Lab.</div>`;
    return;
  }
  if (!state.resumeLabJobId) {
    state.resumeLabJobId = String(state.jobs[0].id);
  }
  els.resumeJobSelect.innerHTML = state.jobs.slice(0, 100).map((job) => `
    <option value="${job.id}" ${String(job.id) === String(state.resumeLabJobId) ? "selected" : ""}>
      ${escapeHtml(job.title)} | ${escapeHtml(job.company_name || "Unknown company")}
    </option>
  `).join("");
  const job = selectedResumeJob();
  if (!job) return;
  const review = resumeLabReview(job);
  const generatedResume = generateResume(job);
  const authenticity = recruiterAuthenticityReview(generatedResume, job);
  els.resumeLabOutput.innerHTML = `
    <div class="resume-score-grid">
      <article><span>Profile fit</span><strong>${escapeHtml(review.scoring.status)} ${review.scoring.score}</strong></article>
      <article><span>Trust</span><strong>${escapeHtml(review.trust.status)} ${review.trust.score}</strong></article>
      <article><span>Recruiter credibility</span><strong>${escapeHtml(authenticity.credibilityLevel)} ${authenticity.authenticityScore}</strong></article>
      <article><span>Matched skills</span><strong>${review.matched.length}</strong></article>
      <article><span>Keyword gaps</span><strong>${review.missing.length}</strong></article>
    </div>
    <div class="resume-lab-section">
      <h4>Recruiter credibility review</h4>
      <p>This score estimates how believable and interview-ready the draft feels to a recruiter. It is not an AI detector. Use it to find generic wording, missing proof, weak metrics, and claims you may need to defend in an interview.</p>
      <div class="authenticity-metrics">
        <span>Metrics: ${authenticity.metricCount}</span>
        <span>Tech specifics: ${authenticity.techCount}</span>
        <span>Generic terms: ${authenticity.genericCount}</span>
        <span>Repeated starts: ${authenticity.repeatedStarts}</span>
      </div>
      <ul>${authenticity.risks.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
    <div class="resume-lab-section">
      <h4>How to make it recruiter-safe</h4>
      <ul>${authenticity.fixes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
    <div class="resume-lab-section">
      <h4>ATS match review</h4>
      <ul>${review.checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
    <div class="resume-lab-section">
      <h4>Matched skills</h4>
      <p>${escapeHtml(review.matched.join(", ") || "No matched skills captured.")}</p>
    </div>
    <div class="resume-lab-section">
      <h4>Missing keywords</h4>
      <p>${escapeHtml(review.missing.join(", ") || "No major missing keywords captured.")}</p>
    </div>
    <div class="resume-lab-section">
      <h4>Prompt preview</h4>
      <pre>${escapeHtml(buildTailoringPrompt(job).slice(0, 1800))}</pre>
    </div>
  `;
}

function buildAuthenticityReport(job) {
  const resumeText = generateResume(job);
  const authenticity = recruiterAuthenticityReview(resumeText, job);
  return [
    `Recruiter Credibility Report - ${job.title}`,
    "",
    `Company: ${job.company_name || "Unknown company"}`,
    `Recruiter credibility: ${authenticity.credibilityLevel}`,
    `Credibility score: ${authenticity.authenticityScore}/100`,
    "",
    "How to use this score:",
    "This is not an AI detector. It estimates whether the draft has the evidence recruiters usually trust: measurable outcomes, concrete technical details, varied writing, role alignment, and claims you can explain in interviews.",
    "",
    "Signals:",
    `- Measurable outcomes: ${authenticity.metricCount}`,
    `- Technical specifics: ${authenticity.techCount}`,
    `- Generic terms: ${authenticity.genericCount}`,
    `- Repeated bullet starts: ${authenticity.repeatedStarts}`,
    `- Job keyword overlap: ${authenticity.jobKeywordCount}`,
    "",
    "Strengths:",
    ...authenticity.strengths.map((item) => `- ${item}`),
    "",
    "Risks:",
    ...authenticity.risks.map((item) => `- ${item}`),
    "",
    "Fixes:",
    ...authenticity.fixes.map((item) => `- ${item}`),
    "",
    "Generated resume draft reviewed:",
    resumeText,
  ].join("\n");
}

async function copyTailoringPrompt() {
  const job = selectedResumeJob();
  if (!job) return;
  const prompt = buildTailoringPrompt(job);
  try {
    await navigator.clipboard.writeText(prompt);
    showToast("AI tailoring prompt copied.");
  } catch (error) {
    downloadTextFile(`${safeFilename(job.company_name)}-${safeFilename(job.title)}-ai-prompt.txt`, prompt);
    showToast("Clipboard unavailable; prompt downloaded.");
  }
}

function downloadTailoringPrompt() {
  const job = selectedResumeJob();
  if (!job) return;
  downloadTextFile(`${safeFilename(job.company_name)}-${safeFilename(job.title)}-ai-prompt.txt`, buildTailoringPrompt(job));
  showToast("AI tailoring prompt downloaded.");
}

function downloadAuthenticityReport() {
  const job = selectedResumeJob();
  if (!job) return;
  downloadTextFile(
    `${safeFilename(job.company_name)}-${safeFilename(job.title)}-credibility-report.txt`,
    buildAuthenticityReport(job),
  );
  showToast("Credibility report downloaded.");
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

async function importResumeFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (els.resumeImportStatus) {
    els.resumeImportStatus.textContent = `Reading ${file.name}...`;
  }
  try {
    const contentBase64 = arrayBufferToBase64(await file.arrayBuffer());
    const parsed = await api("/resume/parse", {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        content_base64: contentBase64,
      }),
    });
    state.baseResumeText = parsed.text;
    if (els.baseResumeInput) {
      els.baseResumeInput.value = state.baseResumeText;
    }
    localStorage.setItem("job-intelligence-base-resume", state.baseResumeText);
    saveActiveProfile();
    renderResumeLab();
    if (els.resumeImportStatus) {
      els.resumeImportStatus.textContent = `Imported ${parsed.filename}.`;
    }
    showToast("Resume imported into Resume Lab.");
  } catch (error) {
    if (els.resumeImportStatus) {
      els.resumeImportStatus.textContent = "Could not import resume.";
    }
    showToast("Resume import failed.");
  } finally {
    event.target.value = "";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function empty(container, message) {
  container.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function scoreClass(value) {
  return `score-${String(value || "unknown").toLowerCase()}`;
}

function priorityClass(value) {
  return `priority-${String(value || "low").toLowerCase()}`;
}

function workModeClass(value) {
  return `mode-${String(value || "on-site").toLowerCase().replace(/[^a-z]/g, "")}`;
}

function renderBars(container, rows, labelKey) {
  if (!rows?.length) {
    empty(container, "No data yet. Run a collection to populate this view.");
    return;
  }
  const max = Math.max(...rows.map((row) => row.job_count || 0), 1);
  container.innerHTML = rows
    .slice(0, 8)
    .map((row) => {
      const label = row[labelKey] || "Unknown";
      const width = Math.max(6, Math.round(((row.job_count || 0) / max) * 100));
      return `
        <div class="bar-row">
          <span class="bar-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
          <strong class="bar-value">${row.job_count || 0}</strong>
        </div>
      `;
    })
    .join("");
}

function renderSkills() {
  const skills = state.analytics?.most_requested_skills || [];
  if (!skills.length) {
    empty(els.skillCloud, "Skills appear after descriptions are collected.");
    return;
  }
  els.skillCloud.innerHTML = skills
    .slice(0, 10)
    .map(
      (skill) => `
        <div class="skill-pill">
          <strong>${escapeHtml(skill.skill)}</strong>
          <span>${skill.job_count} jobs</span>
        </div>
      `
    )
    .join("");
}

function renderOverview() {
  const jobs = state.jobs;
  const stats = state.stats || {};

  els.totalJobs.textContent = (stats.total_jobs ?? jobs.length).toLocaleString();
  els.remoteJobs.textContent = (
    stats.remote_jobs ?? jobs.filter((job) => job.is_remote).length
  ).toLocaleString();
  els.companyCount.textContent = (stats.companies ?? state.companies.length).toLocaleString();
  els.visaScoreJobs.textContent = jobs.filter((job) => job.visa_score === "High").length.toLocaleString();

  renderBars(els.companyChart, state.analytics?.trending_companies || [], "company");
  renderBars(els.locationChart, state.analytics?.location_trends || [], "location");
  renderSkills();

  if (!jobs.length) {
    empty(els.latestJobs, "No jobs stored yet.");
    return;
  }
  els.latestJobs.innerHTML = jobs
    .slice(0, 6)
    .map(
      (job) => `
        <button class="job-card link-button" type="button" data-job-id="${job.id}">
          <strong>${escapeHtml(job.title)}</strong>
          <span>${escapeHtml(job.company_name || "Unknown company")} | ${escapeHtml(job.location || "Unknown location")}</span>
        </button>
      `
    )
    .join("");
}

function renderJobs() {
  const visibleJobs = state.jobs.filter((job) => {
    const scoring = jobIntelligenceScore(job);
    if (state.qualificationFilter === "qualified") return scoring.qualified;
    if (state.qualificationFilter === "disqualified") return !scoring.qualified;
    return true;
  });
  els.jobCountLabel.textContent = `${visibleJobs.length} jobs`;
  if (!visibleJobs.length) {
    els.jobsTableBody.innerHTML = `
      <div class="empty-state">No matching jobs found.</div>
    `;
    return;
  }

  els.jobsTableBody.innerHTML = visibleJobs
    .map((job) => {
      const isExpanded = state.expandedJobIds.has(String(job.id));
      const scoring = jobIntelligenceScore(job);
      const trust = jobTrustScore(job);
      const applied = trackerEntry(job);
      const qualificationClass = scoring.status === "Qualified"
        ? "qualified-chip"
        : scoring.status === "Needs Review"
          ? "review-chip"
          : "disqualified-chip";
      const trustClass = trust.status === "Verified"
        ? "trusted-chip"
        : trust.status === "Risk"
          ? "risk-chip"
          : "review-chip";
      return `
      <article class="feed-job-card" data-job-card-id="${job.id}">
        <div class="feed-card-topline">
          <div class="feed-time-group">
            <span class="feed-time">${escapeHtml(`Collected ${centralDateTime(job.first_seen_at)}`)}</span>
            <span class="feed-time">${escapeHtml(postingTimestamp(job))}</span>
          </div>
          <div class="feed-actions">
            <span class="action-chip ${qualificationClass}">${escapeHtml(scoring.status)} ${scoring.score}</span>
            <span class="action-chip ${trustClass}">${escapeHtml(trust.status)} ${trust.score}</span>
            <span class="action-chip source-chip">${escapeHtml(sourceLabel(job.source))}</span>
            <button class="link-button action-chip" type="button" data-job-details-id="${job.id}" aria-expanded="${isExpanded}">
              ${isExpanded ? "Hide" : "Details"}
            </button>
            <button class="link-button action-chip" type="button" data-job-resume-lab-id="${job.id}" title="Open this job in Resume Lab">Resume Lab</button>
            <button class="link-button action-chip" type="button" data-job-resume-id="${job.id}">Send for resume</button>
            <button class="link-button action-chip" type="button" data-job-cover-letter-id="${job.id}">Cover letter</button>
            <button class="link-button action-chip ${applied ? "applied-chip" : ""}" type="button" data-job-applied-id="${job.id}">
              ${applied ? "Applied" : "Mark applied"}
            </button>
            ${
              job.job_url
                ? `<a class="link-button action-chip" href="${escapeHtml(job.job_url)}" target="_blank" rel="noreferrer">Open</a>`
                : ""
            }
          </div>
        </div>
        <div class="feed-job-main">
          <h3>${escapeHtml(job.title)}</h3>
          <p>${escapeHtml(job.company_name || "Unknown company")}</p>
          <p class="feed-location">${escapeHtml(job.location || "Unknown location")}</p>
        </div>
        <div class="feed-chip-row">
          <span class="tag ${workModeClass(job.work_mode)}">${escapeHtml(job.work_mode || (job.is_remote ? "Remote" : "On-site"))}</span>
          <span class="tag">${escapeHtml(job.job_type || "Type not listed")}</span>
          <span class="tag">${escapeHtml(formatSalary(job))}</span>
          <span class="tag ${scoreClass(job.visa_score)}">${escapeHtml(job.visa_score || "Unknown")} visa</span>
          <span class="tag visa-tag">${escapeHtml(job.visa_status || "Not specified")}</span>
          <span class="tag ${priorityClass(job.apply_priority)}">${escapeHtml(job.apply_priority || "Low")} priority</span>
          <span class="tag">${escapeHtml(`Fit: ${scoring.reasons.join(", ")}`)}</span>
          <span class="tag">${escapeHtml(`Trust: ${trust.reasons.join(", ")}`)}</span>
        </div>
        ${isExpanded ? renderInlineJobDetails(job) : ""}
      </article>
    `;
    })
    .join("");
}

function renderInlineJobDetails(job) {
  const scoring = jobIntelligenceScore(job);
  const trust = jobTrustScore(job);
  return `
    <div class="inline-job-details">
      <div class="inline-detail-header">
        <div>
          <strong>${escapeHtml(job.title)}</strong>
          <span>${escapeHtml(job.company_name || "Unknown company")} | ${escapeHtml(job.location || "Unknown location")}</span>
          <span>${escapeHtml(`Collected ${centralDateTime(job.first_seen_at)}`)} | ${escapeHtml(postingTimestamp(job))}</span>
          <span>${escapeHtml(`Profile score ${scoring.score}: ${scoring.reasons.join(", ")}`)}</span>
          <span>${escapeHtml(`Trust score ${trust.score}: ${trust.reasons.join(", ")}`)}</span>
        </div>
        <a class="secondary-button" href="${escapeHtml(job.job_url || "#")}" target="_blank" rel="noreferrer">Open job</a>
      </div>
      <p>${escapeHtml(job.description || "No description captured yet.")}</p>
    </div>
  `;
}

function renderTracker() {
  const localOnly = Object.values(state.applicationTracker).filter((entry) => (
    !state.applications.some((item) => String(item.job_id) === String(entry.job_id))
  ));
  const entries = [...state.applications, ...localOnly].sort((a, b) => (
    new Date(b.applied_at) - new Date(a.applied_at)
  ));
  if (els.trackerCountLabel) {
    els.trackerCountLabel.textContent = `${entries.length} applied job${entries.length === 1 ? "" : "s"}`;
  }
  if (!els.trackerTableBody) return;
  if (!entries.length) {
    empty(els.trackerTableBody, "No applications marked yet.");
    return;
  }
  els.trackerTableBody.innerHTML = entries.map((entry) => `
    <article class="feed-job-card">
      <div class="feed-card-topline">
        <div class="feed-time-group">
          <span class="feed-time">${escapeHtml(`Applied ${centralDateTime(entry.applied_at)}`)}</span>
          <span class="feed-time">${escapeHtml(sourceLabel(entry.source || entry.job?.source))}</span>
        </div>
        <div class="feed-actions">
          <span class="action-chip applied-chip">${escapeHtml(entry.status)}</span>
          ${(entry.job_url || entry.job?.job_url) ? `<a class="link-button action-chip" href="${escapeHtml(entry.job_url || entry.job.job_url)}" target="_blank" rel="noreferrer">Open</a>` : ""}
        </div>
      </div>
      <div class="feed-job-main">
        <h3>${escapeHtml(entry.title || entry.job?.title)}</h3>
        <p>${escapeHtml(entry.company_name || entry.job?.company_name || "Unknown company")}</p>
        <p class="feed-location">${escapeHtml(entry.location || entry.job?.location || "Unknown location")}</p>
      </div>
    </article>
  `).join("");
}

function renderSavedSearches() {
  if (els.savedSearchCountLabel) {
    els.savedSearchCountLabel.textContent = `${state.savedSearches.length} saved`;
  }
  if (!els.savedSearchesBody) return;
  if (!state.savedSearches.length) {
    empty(els.savedSearchesBody, "No saved searches yet.");
    return;
  }
  els.savedSearchesBody.innerHTML = state.savedSearches.map((search) => {
    const filters = search.filters || {};
    const summary = [
      filters.keyword,
      filters.location,
      filters.source,
      filters.work_mode,
      filters.qualification_status,
    ].filter(Boolean).join(" | ") || "All latest jobs";
    return `
      <article class="feed-job-card saved-search-card">
        <div class="feed-card-topline">
          <div>
            <h3>${escapeHtml(search.name)}</h3>
            <p>${escapeHtml(summary)}</p>
          </div>
          <div class="feed-actions">
            <button class="link-button action-chip" type="button" data-run-saved-search-id="${search.id}">Run</button>
            <button class="link-button action-chip risk-chip" type="button" data-delete-saved-search-id="${search.id}">Delete</button>
          </div>
        </div>
        <div class="feed-chip-row">
          <span class="tag">${escapeHtml(`Created ${centralDateTime(search.created_at)}`)}</span>
          <span class="tag">${escapeHtml(`Updated ${centralDateTime(search.updated_at)}`)}</span>
        </div>
      </article>
    `;
  }).join("");
}

function populatePreferencesForm() {
  document.querySelector("#prefRoles").value = state.preferences.roles || "";
  document.querySelector("#prefSkills").value = state.preferences.skills || "";
  document.querySelector("#prefLocations").value = state.preferences.locations || "";
  document.querySelector("#prefExperience").value = state.preferences.experience || "";
  document.querySelector("#prefVisa").value = state.preferences.visa || "H1B/TN/GC friendly";
}

function savePreferences(event) {
  event.preventDefault();
  state.preferences = {
    roles: document.querySelector("#prefRoles").value,
    skills: document.querySelector("#prefSkills").value,
    locations: document.querySelector("#prefLocations").value,
    experience: document.querySelector("#prefExperience").value,
    visa: document.querySelector("#prefVisa").value,
  };
  localStorage.setItem("job-intelligence-preferences", JSON.stringify(state.preferences));
  saveActiveProfile();
  saveProfileToApi();
}

function saveProfileStore() {
  localStorage.setItem("job-intelligence-profile-store", JSON.stringify(state.profileStore));
  localStorage.setItem("job-intelligence-active-profile", state.activeProfileKey);
}

function saveActiveProfile() {
  state.profileStore[state.activeProfileKey] = {
    ...(state.profileStore[state.activeProfileKey] || {}),
    preferences: state.preferences,
    baseResumeText: state.baseResumeText,
  };
  saveProfileStore();
}

async function switchProfile(profileKey) {
  saveActiveProfile();
  state.activeProfileKey = profileKey;
  const profile = state.profileStore[profileKey] || defaultProfileStore()[profileKey] || defaultProfileStore().santosh;
  state.preferences = profile.preferences;
  state.baseResumeText = profile.baseResumeText || "";
  localStorage.setItem("job-intelligence-preferences", JSON.stringify(state.preferences));
  localStorage.setItem("job-intelligence-base-resume", state.baseResumeText);
  saveProfileStore();
  populatePreferencesForm();
  renderResumeLab();
  await saveProfileToApi();
  showToast(`Profile switched to ${profile.label || profileKey}.`);
}

function profileToPreferences(profile) {
  state.preferences = {
    roles: (profile.target_roles || []).join(", "),
    skills: (profile.skills || []).join(", "),
    locations: (profile.preferred_locations || []).join(", "),
    experience: profile.experience_level || "",
    visa: profile.visa_need || "H1B/TN/GC friendly",
  };
}

function preferencesPayload() {
  return {
    target_roles: splitTermsForSave(state.preferences.roles),
    skills: splitTermsForSave(state.preferences.skills),
    preferred_locations: splitTermsForSave(state.preferences.locations),
    experience_level: state.preferences.experience || null,
    visa_need: state.preferences.visa || null,
    work_mode_preference: "Remote or Hybrid",
    job_type_preference: "Full-time",
    excluded_keywords: ["C2C", "USC only", "no sponsorship"],
  };
}

function splitTermsForSave(value) {
  return String(value || "")
    .split(/[,|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function saveProfileToApi() {
  try {
    const profile = await api("/profile", {
      method: "PUT",
      body: JSON.stringify(preferencesPayload()),
    });
    profileToPreferences(profile);
    await runSearch();
    showToast("Profile saved and backend job scores refreshed.");
  } catch (error) {
    renderJobs();
    showToast("Preferences saved locally.");
  }
}

function companyTargetVisaScore(target) {
  const text = `${target.sponsor_status || ""} ${target.h1b_or_funding || ""}`.toLowerCase();
  if (text.includes("strong") || text.includes("active") || /\d/.test(text)) return "High";
  if (text.includes("possible") || text.includes("funding")) return "Medium";
  return "Unknown";
}

function renderCompanyTargets() {
  els.companyTargetCountLabel.textContent = `${state.companyTargets.length} target companies`;
  if (!state.companyTargets.length) {
    empty(els.companyTargetsGrid, "No company target data loaded.");
    return;
  }
  els.companyTargetsGrid.innerHTML = state.companyTargets
    .map((target) => {
      const score = companyTargetVisaScore(target);
      return `
        <article class="target-card">
          <div>
            <strong>${escapeHtml(target.company)}</strong>
            <span>${escapeHtml(target.sector || "Sector not listed")}</span>
          </div>
          <span class="tag ${scoreClass(score)}">${escapeHtml(score)} visa signal</span>
          <p>${escapeHtml(target.sponsor_status || "Sponsor status not listed")}</p>
          <small>${escapeHtml(target.h1b_or_funding || "H1B/funding data not listed")}</small>
          ${
            target.career_url
              ? `<a class="link-button" href="${escapeHtml(target.career_url)}" target="_blank" rel="noreferrer">Career page</a>`
              : ""
          }
        </article>
      `;
    })
    .join("");
}

function renderSourceHealth() {
  const counts = state.sourceCounts;
  const experimentalSources = new Set([
    "yc_jobs",
    "usajobs_api",
    "simplify_new_grad",
    "github_internships",
  ]);
  els.sourceHealthLabel.textContent = `${supportedSources.length} sources`;
  els.sourceHealthGrid.innerHTML = supportedSources
    .map((source) => {
      const count = counts[source] || 0;
      const status = count > 0 ? "Data stored" : experimentalSources.has(source) ? "Experimental" : "Ready";
      const score = count > 0 ? "High" : experimentalSources.has(source) ? "Medium" : "Unknown";
      return `
        <article class="source-health-card">
          <div>
            <strong>${escapeHtml(sourceLabel(source))}</strong>
            <span>${escapeHtml(status)}</span>
          </div>
          <span class="tag ${scoreClass(score)}">${count.toLocaleString()} jobs</span>
        </article>
      `;
    })
    .join("");
}

function renderCompanies() {
  if (!els.companyCountLabel || !els.companiesGrid) return;
  els.companyCountLabel.textContent = `${state.companies.length} companies`;
  if (!state.companies.length) {
    empty(els.companiesGrid, "No companies stored yet.");
    return;
  }
  els.companiesGrid.innerHTML = state.companies
    .map(
      (company) => `
        <article class="company-card">
          <strong>${escapeHtml(company.name)}</strong>
          <span>${escapeHtml(company.website_url || "No website captured")}</span>
        </article>
      `
    )
    .join("");
}

function renderAll() {
  renderOverview();
  renderJobs();
  renderTracker();
  renderSavedSearches();
  renderResumeLab();
  renderSourceHealth();
  if (state.currentView === "targets") {
    renderCompanyTargets();
  }
}

async function loadData() {
  try {
    await api("/health");
    setApiStatus(true);
    const [profile, applications, savedSearches, jobs] = await Promise.all([
      api("/profile"),
      api("/applications"),
      api("/saved-searches"),
      api("/jobs?limit=100"),
    ]);
    profileToPreferences(profile);
    state.applications = applications;
    state.savedSearches = savedSearches;
    state.jobs = jobs;
    state.expandedJobIds.clear();
    populateSourceFilter(jobs);
    populateVisaStatusFilter(jobs);
    renderAll();
    await refreshSchedulerStatus();
    loadStats();
    loadSecondaryData();
  } catch (error) {
    setApiStatus(false);
    showToast("Could not load local API data.");
  }
}

async function loadStats() {
  try {
    const [stats, sourceCounts] = await Promise.all([
      api("/stats"),
      api("/source-counts"),
    ]);
    state.stats = stats;
    state.sourceCounts = sourceCounts.reduce((acc, row) => {
      acc[row.source] = row.job_count;
      return acc;
    }, {});
    renderOverview();
    renderSourceHealth();
  } catch (error) {
    showToast("Database totals are still unavailable.");
  }
}

async function loadSecondaryData() {
  try {
    const [companies, analytics, companyTargets] = await Promise.all([
      api("/companies?limit=500"),
      api("/analytics"),
      api("/company-targets?limit=500"),
    ]);
    state.companies = companies;
    state.analytics = analytics;
    state.companyTargets = companyTargets;
    renderOverview();
    renderSourceHealth();
    if (state.currentView === "targets") {
      renderCompanyTargets();
    }
  } catch (error) {
    showToast("Analytics panels are still unavailable.");
  }
}

function sourceLabel(source) {
  const labels = {
    careerbuilder: "CareerBuilder",
    careerhound: "Career Hound",
    career_page: "Career Pages",
    college_recruiter: "College Recruiter",
    dice: "Dice",
    dynamitejobs: "Dynamite Jobs",
    glassdoor: "Glassdoor",
    governmentjobs: "GovernmentJobs",
    github_internships: "GitHub Internships",
    glever: "Glever",
    google: "Google Jobs",
    hiringcafe: "HiringCafe",
    indeed: "Indeed",
    jobspresso: "Jobspresso",
    jobsgrep: "JobsGrep",
    jobright_h1b: "Jobright H1B",
    jobsh1b: "JobsH1B",
    linkedin: "LinkedIn",
    remotive: "Remotive",
    remotely: "Remotely.jobs",
    simplify_new_grad: "Simplify New Grad",
    usajobs_api: "USAJOBS",
    skipthedrive: "SkipTheDrive",
    visafriendly: "VisaFriendly",
    wellfound: "Wellfound",
    weworkremotely: "We Work Remotely",
    yc_jobs: "YC Jobs",
    zip_recruiter: "ZipRecruiter",
  };
  return labels[source] || source;
}

function populateSourceFilter(jobs) {
  const sourceInput = document.querySelector("#sourceInput");
  const current = sourceInput.value;
  const sources = [
    ...supportedSources,
    ...jobs.map((job) => job.source).filter(Boolean),
  ].filter((source, index, allSources) => allSources.indexOf(source) === index);
  sourceInput.innerHTML = [
    '<option value="">Any source</option>',
    ...sources.map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(sourceLabel(source))}</option>`),
  ].join("");
  if (sources.includes(current)) {
    sourceInput.value = current;
  }
}

function populateVisaStatusFilter(jobs) {
  const visaStatusInput = document.querySelector("#visaStatusInput");
  const current = visaStatusInput.value;
  const knownStatuses = [
    "C2C accepted",
    "H1B accepted",
    "No C2C",
    "No sponsorship",
    "Not specified",
    "OPT/CPT accepted",
    "Sponsorship available",
    "TN visa",
    "USC/GC required",
    "W2 only",
    "Work authorization required",
  ];
  const statuses = [
    ...new Set([...knownStatuses, ...jobs.map((job) => job.visa_status).filter(Boolean)]),
  ].sort();
  visaStatusInput.innerHTML = [
    '<option value="">Any visa status</option>',
    ...statuses.map((status) => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`),
  ].join("");
  if (statuses.includes(current)) {
    visaStatusInput.value = current;
  }
}

function getCollectPayload() {
  const isRemote = document.querySelector("#collectRemote").checked;
  const locationInput = document.querySelector("#collectLocation").value.trim();
  const location = isRemote && (!locationInput || locationInput.toLowerCase() === "texas")
    ? "United States"
    : locationInput || null;
  return {
    search_term: document.querySelector("#collectSearchTerm").value,
    location,
    sites: selectedSites(),
    results_wanted: Number(document.querySelector("#collectResults").value || 100),
    country_indeed: document.querySelector("#collectCountry").value || "usa",
    is_remote: isRemote,
    job_type: document.querySelector("#collectJobType").value || null,
    hours_old: document.querySelector("#collectHoursOld").value
      ? Number(document.querySelector("#collectHoursOld").value)
      : null,
    use_company_targets: document.querySelector("#useCompanyTargets").checked,
    visa_friendly_only: document.querySelector("#visaFriendlyOnly").checked,
  };
}

function switchView(view) {
  const titles = {
    collect: "Collect",
    jobs: "Jobs",
    overview: "Overview",
    preferences: "Preferences",
    resume: "Resume Lab",
    saved: "Saved searches",
    sources: "Sources",
    targets: "Company targets",
    tracker: "Applications",
  };
  state.currentView = view;
  document.querySelectorAll(".view").forEach((node) => {
    node.classList.toggle("is-visible", node.id === `${view}View`);
  });
  document.querySelectorAll(".nav-item").forEach((node) => {
    node.classList.toggle("is-active", node.dataset.view === view);
  });
  els.viewTitle.textContent = titles[view] || view[0].toUpperCase() + view.slice(1);
  if (view === "targets") {
    renderCompanyTargets();
  }
  if (view === "tracker") {
    renderTracker();
  }
  if (view === "saved") {
    renderSavedSearches();
  }
  if (view === "resume") {
    renderResumeLab();
  }
  if (view === "preferences") {
    populatePreferencesForm();
  }
}

function getSearchPayload() {
  const remoteValue = document.querySelector("#remoteInput").value;
  return {
    keyword: document.querySelector("#keywordInput").value || null,
    company: document.querySelector("#companyInput").value || null,
    location: document.querySelector("#locationInput").value || null,
    source: document.querySelector("#sourceInput").value || null,
    visa_status: document.querySelector("#visaStatusInput").value || null,
    job_type: document.querySelector("#jobTypeInput").value || null,
    work_mode: state.activeWorkMode || null,
    qualification_status: state.qualificationFilter
      ? state.qualificationFilter.replace(/\b\w/g, (letter) => letter.toUpperCase())
      : null,
    remote: state.activeWorkMode ? null : remoteValue === "" ? null : remoteValue === "true",
    limit: 100,
    offset: 0,
  };
}

async function searchJobs(event) {
  event.preventDefault();
  await runSearch();
}

async function runSearch() {
  try {
    state.jobs = await api("/search", {
      method: "POST",
      body: JSON.stringify(getSearchPayload()),
    });
    state.applications = await api("/applications");
    state.expandedJobIds.clear();
    renderOverview();
    renderJobs();
    renderTracker();
    switchView("jobs");
    showToast("Search results updated.");
  } catch (error) {
    showToast("Search failed.");
  }
}

async function saveCurrentSearch() {
  const payload = getSearchPayload();
  const labelParts = [
    payload.keyword,
    payload.location,
    payload.source,
    payload.qualification_status,
    payload.work_mode,
  ].filter(Boolean);
  const name = labelParts.length ? labelParts.join(" | ") : "All latest jobs";
  try {
    const savedSearch = await api("/saved-searches", {
      method: "POST",
      body: JSON.stringify({ name, filters: payload }),
    });
    state.savedSearches = [savedSearch, ...state.savedSearches];
    renderSavedSearches();
    showToast("Search saved.");
  } catch (error) {
    showToast("Could not save search.");
  }
}

async function runSavedSearch(searchId) {
  const savedSearch = state.savedSearches.find((item) => String(item.id) === String(searchId));
  if (!savedSearch) return;
  applySearchPayload(savedSearch.filters || {});
  await runSearch();
}

async function deleteSavedSearch(searchId) {
  try {
    await api(`/saved-searches/${searchId}`, { method: "DELETE" });
    state.savedSearches = state.savedSearches.filter((item) => String(item.id) !== String(searchId));
    renderSavedSearches();
    showToast("Saved search deleted.");
  } catch (error) {
    showToast("Could not delete saved search.");
  }
}

function applySearchPayload(payload) {
  document.querySelector("#keywordInput").value = payload.keyword || "";
  document.querySelector("#companyInput").value = payload.company || "";
  document.querySelector("#locationInput").value = payload.location || "";
  document.querySelector("#sourceInput").value = payload.source || "";
  document.querySelector("#visaStatusInput").value = payload.visa_status || "";
  document.querySelector("#jobTypeInput").value = payload.job_type || "";
  document.querySelector("#remoteInput").value = payload.remote === true ? "true" : payload.remote === false ? "false" : "";
  state.activeWorkMode = payload.work_mode || "";
  state.qualificationFilter = String(payload.qualification_status || "").toLowerCase();
}

async function setWorkMode(workMode) {
  state.activeWorkMode = workMode;
  state.qualificationFilter = "";
  document.querySelectorAll(".work-mode-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.workMode === workMode && !button.dataset.qualificationFilter);
  });
  await runSearch();
}

function setQualificationFilter(filter) {
  state.qualificationFilter = filter;
  state.activeWorkMode = "";
  document.querySelectorAll(".work-mode-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.qualificationFilter === filter);
  });
  runSearch();
}

function selectedSites() {
  return [...document.querySelectorAll("#collectForm fieldset input:checked")].map((input) => input.value);
}

function setSelectedSites(sites) {
  const siteSet = new Set(sites);
  document.querySelectorAll("#collectForm fieldset input[type='checkbox']").forEach((input) => {
    input.checked = siteSet.has(input.value);
  });
}

function setAllSources(checked) {
  document.querySelectorAll("#collectForm fieldset input[type='checkbox']").forEach((input) => {
    input.checked = checked;
  });
  showToast(checked ? "All sources selected." : "All sources deselected.");
}

function selectLinkedInOnly() {
  setSelectedSites(["linkedin"]);
  showToast("LinkedIn selected.");
}

function applyLinkedInLatestPreset(hoursOld) {
  document.querySelector("#collectSearchTerm").value = ".NET developer or Java developer";
  document.querySelector("#collectLocation").value = "";
  document.querySelector("#collectResults").value = "100";
  document.querySelector("#collectCountry").value = "usa";
  document.querySelector("#collectHoursOld").value = String(hoursOld);
  document.querySelector("#freshnessPreset").value = String(hoursOld);
  document.querySelector("#collectJobType").value = "";
  document.querySelector("#collectRemote").checked = false;
  document.querySelector("#useCompanyTargets").checked = false;
  document.querySelector("#visaFriendlyOnly").checked = false;
  setSelectedSites(["linkedin"]);
  switchView("collect");
}

async function collectLinkedInLatest(hoursOld) {
  applyLinkedInLatestPreset(hoursOld);
  showToast(`Collecting LinkedIn latest ${formatHoursOld(hoursOld)}.`);
  await collectJobs();
}

async function collectSelectedLinkedInLatest() {
  const hoursOld = Number(els.linkedinLatestHoursSelect.value || 1);
  await collectLinkedInLatest(hoursOld);
}

async function collectLinkedInCompanyTargets() {
  applyLinkedInLatestPreset(24);
  document.querySelector("#useCompanyTargets").checked = true;
  showToast("Collecting LinkedIn jobs for document companies.");
  await collectJobs();
}

async function collectVisaFriendlyCompanies() {
  applyLinkedInLatestPreset(24);
  document.querySelector("#useCompanyTargets").checked = true;
  document.querySelector("#visaFriendlyOnly").checked = true;
  setSelectedSites(["linkedin", "google", "career_page", "jobright_h1b", "dice", "governmentjobs", "remotive", "jobspresso"]);
  showToast("Collecting visa-friendly company jobs.");
  await collectJobs();
}

function formatHoursOld(hoursOld) {
  return hoursOld < 1 ? `${Math.round(hoursOld * 60)}m` : `${hoursOld}h`;
}

async function collectJobs(event) {
  event?.preventDefault();
  const payload = getCollectPayload();
  if (!payload.sites.length) {
    showToast("Select at least one source.");
    return;
  }

  els.collectButton.disabled = true;
  els.quickCollectButton.disabled = true;
  els.linkedinLatestButton.disabled = true;
  els.linkedinCompanyTargetsButton.disabled = true;
  els.visaFriendlyCompaniesButton.disabled = true;
  els.collectOutput.textContent = "Collecting latest jobs from selected job boards. This can take a few minutes.";
  try {
    const result = await api("/collect", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    els.collectOutput.textContent = [
      `Search run: ${result.search_run_id}`,
      `Jobs seen: ${result.jobs_seen}`,
      `New jobs added: ${result.jobs_added}`,
      `Errors: ${result.errors.length}`,
      ...result.errors,
    ].join("\n");
    await loadData();
    showToast("Collection complete.");
    switchView("overview");
  } catch (error) {
    els.collectOutput.textContent = `Collection failed.\n${error.message}`;
    showToast("Collection failed.");
  } finally {
    els.collectButton.disabled = false;
    els.quickCollectButton.disabled = false;
    els.linkedinLatestButton.disabled = false;
    els.linkedinCompanyTargetsButton.disabled = false;
    els.visaFriendlyCompaniesButton.disabled = false;
  }
}

function renderSchedulerStatus(status) {
  const parts = [];
  parts.push(status.running ? "Running every hour" : "Stopped");
  if (status.next_run_at) parts.push(`next ${shortDateTime(status.next_run_at)}`);
  if (status.last_run_at) {
    parts.push(`last run ${shortDateTime(status.last_run_at)}`);
    parts.push(`${status.last_jobs_seen || 0} jobs`);
    parts.push(`${status.last_error_count || 0} errors`);
  }
  els.schedulerStatusText.textContent = parts.join(" | ");
}

async function refreshSchedulerStatus() {
  try {
    const status = await api("/scheduler/status");
    renderSchedulerStatus(status);
  } catch (error) {
    els.schedulerStatusText.textContent = "Scheduler status unavailable";
  }
}

async function startHourlyRefresh() {
  const payload = {
    ...getCollectPayload(),
    hours_old: 1,
    results_wanted: Number(document.querySelector("#collectResults").value || 100),
  };
  if (!payload.sites.length) {
    showToast("Select at least one source before starting hourly refresh.");
    return;
  }
  els.startHourlyRefreshButton.disabled = true;
  try {
    const status = await api("/scheduler/start", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    renderSchedulerStatus(status);
    showToast("Hourly refresh started.");
  } catch (error) {
    showToast("Could not start hourly refresh.");
  } finally {
    els.startHourlyRefreshButton.disabled = false;
  }
}

async function stopHourlyRefresh() {
  els.stopHourlyRefreshButton.disabled = true;
  try {
    const status = await api("/scheduler/stop", { method: "POST" });
    renderSchedulerStatus(status);
    showToast("Hourly refresh stopped.");
  } catch (error) {
    showToast("Could not stop hourly refresh.");
  } finally {
    els.stopHourlyRefreshButton.disabled = false;
  }
}

function openDrawer(jobId) {
  const job = state.jobs.find((item) => String(item.id) === String(jobId));
  if (!job) return;
  els.drawerSource.textContent = job.source;
  els.drawerTitle.textContent = job.title;
  els.drawerCompany.textContent = `${job.company_name || "Unknown company"} | ${job.location || "Unknown location"}`;
  els.drawerMeta.innerHTML = [
    formatSalary(job),
    job.visa_status || "Not specified",
    `Visa score ${job.visa_score || "Unknown"}`,
    `Priority ${job.apply_priority || "Low"}`,
    job.job_type || "Type not listed",
    `Collected ${centralDateTime(job.first_seen_at)}`,
    postingTimestamp(job),
    job.work_mode || (job.is_remote ? "Remote" : "On-site"),
  ]
    .map((item) => `<span class="tag">${escapeHtml(item)}</span>`)
    .join("");
  els.drawerDescription.textContent = job.description || "No description captured yet.";
  els.drawerLink.href = job.job_url || "#";
  els.drawer.classList.add("is-open");
  els.drawer.setAttribute("aria-hidden", "false");
}

function toggleInlineDetails(jobId) {
  const key = String(jobId);
  if (state.expandedJobIds.has(key)) {
    state.expandedJobIds.delete(key);
  } else {
    state.expandedJobIds.clear();
    state.expandedJobIds.add(key);
  }
  renderJobs();
}

function closeDrawer() {
  els.drawer.classList.remove("is-open");
  els.drawer.setAttribute("aria-hidden", "true");
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

document.querySelector("#refreshButton").addEventListener("click", async () => {
  await loadData();
  showToast("Stored data refreshed.");
});
els.quickCollectButton.addEventListener("click", collectJobs);
els.selectAllSourcesButton.addEventListener("click", () => setAllSources(true));
els.clearAllSourcesButton.addEventListener("click", () => setAllSources(false));
els.linkedinOnlyButton.addEventListener("click", selectLinkedInOnly);
els.linkedinLatestButton.addEventListener("click", collectSelectedLinkedInLatest);
els.startHourlyRefreshButton.addEventListener("click", startHourlyRefresh);
els.stopHourlyRefreshButton.addEventListener("click", stopHourlyRefresh);
document.querySelectorAll(".work-mode-tab").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.qualificationFilter) {
      setQualificationFilter(button.dataset.qualificationFilter);
    } else {
      setWorkMode(button.dataset.workMode);
    }
  });
});
els.linkedinCompanyTargetsButton.addEventListener("click", collectLinkedInCompanyTargets);
els.visaFriendlyCompaniesButton.addEventListener("click", collectVisaFriendlyCompanies);
document.querySelector("#freshnessPreset").addEventListener("change", (event) => {
  document.querySelector("#collectHoursOld").value = event.target.value;
});
document.querySelector("#collectHoursOld").addEventListener("input", (event) => {
  const preset = document.querySelector("#freshnessPreset");
  if ([...preset.options].some((option) => option.value === event.target.value)) {
    preset.value = event.target.value;
  }
});
document.querySelector("#searchForm").addEventListener("submit", searchJobs);
els.saveSearchButton.addEventListener("click", saveCurrentSearch);
els.refreshResumeLabButton.addEventListener("click", renderResumeLab);
els.copyPromptButton.addEventListener("click", copyTailoringPrompt);
els.downloadPromptButton.addEventListener("click", downloadTailoringPrompt);
els.downloadAuthenticityButton.addEventListener("click", downloadAuthenticityReport);
els.profileSelect.addEventListener("change", (event) => {
  switchProfile(event.target.value);
});
els.resumeFileInput.addEventListener("change", importResumeFile);
els.resumeJobSelect.addEventListener("change", (event) => {
  state.resumeLabJobId = event.target.value;
  renderResumeLab();
});
els.baseResumeInput.addEventListener("input", (event) => {
  state.baseResumeText = event.target.value;
  localStorage.setItem("job-intelligence-base-resume", state.baseResumeText);
  saveActiveProfile();
});
document.querySelector("#collectForm").addEventListener("submit", collectJobs);
document.querySelector("#preferencesForm").addEventListener("submit", savePreferences);
document.querySelector("#drawerClose").addEventListener("click", closeDrawer);

document.body.addEventListener("click", (event) => {
  const resumeTarget = event.target.closest("[data-job-resume-id]");
  if (resumeTarget) {
    sendForResume(resumeTarget.dataset.jobResumeId);
    return;
  }
  const coverLetterTarget = event.target.closest("[data-job-cover-letter-id]");
  if (coverLetterTarget) {
    sendForCoverLetter(coverLetterTarget.dataset.jobCoverLetterId);
    return;
  }
  const appliedTarget = event.target.closest("[data-job-applied-id]");
  if (appliedTarget) {
    markApplied(appliedTarget.dataset.jobAppliedId);
    return;
  }
  const resumeLabTarget = event.target.closest("[data-job-resume-lab-id]");
  if (resumeLabTarget) {
    state.resumeLabJobId = resumeLabTarget.dataset.jobResumeLabId;
    switchView("resume");
    renderResumeLab();
    return;
  }
  const detailsTarget = event.target.closest("[data-job-details-id]");
  if (detailsTarget) {
    toggleInlineDetails(detailsTarget.dataset.jobDetailsId);
    return;
  }
  const runSavedTarget = event.target.closest("[data-run-saved-search-id]");
  if (runSavedTarget) {
    runSavedSearch(runSavedTarget.dataset.runSavedSearchId);
    return;
  }
  const deleteSavedTarget = event.target.closest("[data-delete-saved-search-id]");
  if (deleteSavedTarget) {
    deleteSavedSearch(deleteSavedTarget.dataset.deleteSavedSearchId);
    return;
  }
  const jobCardTarget = event.target.closest("[data-job-card-id]");
  if (jobCardTarget && !event.target.closest("a, button")) {
    toggleInlineDetails(jobCardTarget.dataset.jobCardId);
    return;
  }
  const target = event.target.closest("[data-job-id]");
  if (target) openDrawer(target.dataset.jobId);
});

loadData();
