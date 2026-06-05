const state = {
  jobs: [],
  companies: [],
  companyTargets: [],
  analytics: null,
  stats: null,
  sourceCounts: {},
  currentView: "overview",
  activeWorkMode: "",
  expandedJobIds: new Set(),
};

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
  "hiringcafe",
  "yc_jobs",
  "remotely",
  "simplify_new_grad",
  "github_internships",
  "jobsh1b",
  "visafriendly",
  "glever",
  "jobsgrep",
  "wellfound",
  "college_recruiter",
  "weworkremotely",
  "careerbuilder",
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
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function centralDateTime(value) {
  if (!value) return "Not captured";
  return new Date(value).toLocaleString(undefined, {
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
  els.jobCountLabel.textContent = `${state.jobs.length} jobs`;
  if (!state.jobs.length) {
    els.jobsTableBody.innerHTML = `
      <div class="empty-state">No matching jobs found.</div>
    `;
    return;
  }

  els.jobsTableBody.innerHTML = state.jobs
    .map((job) => {
      const isExpanded = state.expandedJobIds.has(String(job.id));
      return `
      <article class="feed-job-card" data-job-card-id="${job.id}">
        <div class="feed-card-topline">
          <div class="feed-time-group">
            <span class="feed-time">${escapeHtml(`Collected ${centralDateTime(job.first_seen_at)}`)}</span>
            <span class="feed-time">${escapeHtml(postingTimestamp(job))}</span>
          </div>
          <div class="feed-actions">
            <span class="action-chip source-chip">${escapeHtml(sourceLabel(job.source))}</span>
            <button class="link-button action-chip" type="button" data-job-details-id="${job.id}" aria-expanded="${isExpanded}">
              ${isExpanded ? "Hide" : "Details"}
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
        </div>
        ${isExpanded ? renderInlineJobDetails(job) : ""}
      </article>
    `;
    })
    .join("");
}

function renderInlineJobDetails(job) {
  return `
    <div class="inline-job-details">
      <div class="inline-detail-header">
        <div>
          <strong>${escapeHtml(job.title)}</strong>
          <span>${escapeHtml(job.company_name || "Unknown company")} | ${escapeHtml(job.location || "Unknown location")}</span>
          <span>${escapeHtml(`Collected ${centralDateTime(job.first_seen_at)}`)} | ${escapeHtml(postingTimestamp(job))}</span>
        </div>
        <a class="secondary-button" href="${escapeHtml(job.job_url || "#")}" target="_blank" rel="noreferrer">Open job</a>
      </div>
      <p>${escapeHtml(job.description || "No description captured yet.")}</p>
    </div>
  `;
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
    "careerbuilder",
    "weworkremotely",
    "dice",
    "wellfound",
    "yc_jobs",
    "college_recruiter",
    "jobsh1b",
    "visafriendly",
    "glever",
    "jobsgrep",
    "hiringcafe",
    "usajobs_api",
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
  renderSourceHealth();
  if (state.currentView === "targets") {
    renderCompanyTargets();
  }
}

async function loadData() {
  try {
    await api("/health");
    setApiStatus(true);
    const jobs = await api("/jobs?limit=100");
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
    career_page: "Career Pages",
    college_recruiter: "College Recruiter",
    dice: "Dice",
    glassdoor: "Glassdoor",
    governmentjobs: "GovernmentJobs",
    github_internships: "GitHub Internships",
    glever: "Glever",
    google: "Google Jobs",
    hiringcafe: "HiringCafe",
    indeed: "Indeed",
    jobsgrep: "JobsGrep",
    jobright_h1b: "Jobright H1B",
    jobsh1b: "JobsH1B",
    linkedin: "LinkedIn",
    remotely: "Remotely.jobs",
    simplify_new_grad: "Simplify New Grad",
    usajobs_api: "USAJOBS",
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
    sources: "Sources",
    targets: "Company targets",
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
    state.expandedJobIds.clear();
    renderOverview();
    renderJobs();
    switchView("jobs");
    showToast("Search results updated.");
  } catch (error) {
    showToast("Search failed.");
  }
}

async function setWorkMode(workMode) {
  state.activeWorkMode = workMode;
  document.querySelectorAll(".work-mode-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.workMode === workMode);
  });
  await runSearch();
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
  setSelectedSites(["linkedin", "google", "career_page", "jobright_h1b", "jobsh1b", "visafriendly", "dice", "governmentjobs"]);
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
  button.addEventListener("click", () => setWorkMode(button.dataset.workMode));
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
document.querySelector("#collectForm").addEventListener("submit", collectJobs);
document.querySelector("#drawerClose").addEventListener("click", closeDrawer);

document.body.addEventListener("click", (event) => {
  const detailsTarget = event.target.closest("[data-job-details-id]");
  if (detailsTarget) {
    toggleInlineDetails(detailsTarget.dataset.jobDetailsId);
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
