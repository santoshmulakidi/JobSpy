const state = {
  jobs: [],
  companies: [],
  analytics: null,
  currentView: "overview",
};

const els = {
  apiStatusDot: document.querySelector("#apiStatusDot"),
  apiStatusText: document.querySelector("#apiStatusText"),
  viewTitle: document.querySelector("#viewTitle"),
  totalJobs: document.querySelector("#totalJobs"),
  remoteJobs: document.querySelector("#remoteJobs"),
  companyCount: document.querySelector("#companyCount"),
  avgSalary: document.querySelector("#avgSalary"),
  companyChart: document.querySelector("#companyChart"),
  locationChart: document.querySelector("#locationChart"),
  skillCloud: document.querySelector("#skillCloud"),
  latestJobs: document.querySelector("#latestJobs"),
  jobsTableBody: document.querySelector("#jobsTableBody"),
  jobCountLabel: document.querySelector("#jobCountLabel"),
  companiesGrid: document.querySelector("#companiesGrid"),
  companyCountLabel: document.querySelector("#companyCountLabel"),
  collectOutput: document.querySelector("#collectOutput"),
  collectButton: document.querySelector("#collectButton"),
  quickCollectButton: document.querySelector("#quickCollectButton"),
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
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
  const salary = state.analytics?.salary_trends || {};
  const avgMin = salary.average_min_salary ? Math.round(salary.average_min_salary).toLocaleString() : null;
  const avgMax = salary.average_max_salary ? Math.round(salary.average_max_salary).toLocaleString() : null;

  els.totalJobs.textContent = jobs.length.toLocaleString();
  els.remoteJobs.textContent = jobs.filter((job) => job.is_remote).length.toLocaleString();
  els.companyCount.textContent = state.companies.length.toLocaleString();
  els.avgSalary.textContent = avgMin && avgMax ? `$${avgMin}-$${avgMax}` : "N/A";

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
      <tr><td colspan="6" class="empty-state">No matching jobs found.</td></tr>
    `;
    return;
  }

  els.jobsTableBody.innerHTML = state.jobs
    .map(
      (job) => `
      <tr>
        <td>
          <div class="role-cell">
            <strong>${escapeHtml(job.title)}</strong>
            <span class="tag">${job.is_remote ? "Remote" : "Location based"}</span>
          </div>
        </td>
        <td>${escapeHtml(job.company_name || "Unknown")}</td>
        <td>${escapeHtml(job.location || "Unknown")}</td>
        <td>${escapeHtml(job.source)}</td>
        <td><span class="tag visa-tag">${escapeHtml(job.visa_status || "Not specified")}</span></td>
        <td>${escapeHtml(formatSalary(job))}</td>
        <td><button class="link-button" type="button" data-job-id="${job.id}">Details</button></td>
      </tr>
    `
    )
    .join("");
}

function renderCompanies() {
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
  renderCompanies();
}

async function loadData() {
  try {
    await api("/health");
    setApiStatus(true);
    const [jobs, companies, analytics] = await Promise.all([
      api("/jobs?limit=250"),
      api("/companies?limit=500"),
      api("/analytics"),
    ]);
    state.jobs = jobs;
    state.companies = companies;
    state.analytics = analytics;
    populateSourceFilter(jobs);
    renderAll();
  } catch (error) {
    setApiStatus(false);
    showToast("Could not load local API data.");
  }
}

function sourceLabel(source) {
  const labels = {
    careerbuilder: "CareerBuilder",
    glassdoor: "Glassdoor",
    google: "Google Jobs",
    indeed: "Indeed",
    linkedin: "LinkedIn",
    remotely: "Remotely.jobs",
    weworkremotely: "We Work Remotely",
    zip_recruiter: "ZipRecruiter",
  };
  return labels[source] || source;
}

function populateSourceFilter(jobs) {
  const sourceInput = document.querySelector("#sourceInput");
  const current = sourceInput.value;
  const sources = [...new Set(jobs.map((job) => job.source).filter(Boolean))].sort();
  sourceInput.innerHTML = [
    '<option value="">Any source</option>',
    ...sources.map((source) => `<option value="${escapeHtml(source)}">${escapeHtml(sourceLabel(source))}</option>`),
  ].join("");
  if (sources.includes(current)) {
    sourceInput.value = current;
  }
}

function getCollectPayload() {
  return {
    search_term: document.querySelector("#collectSearchTerm").value,
    location: document.querySelector("#collectLocation").value || null,
    sites: selectedSites(),
    results_wanted: Number(document.querySelector("#collectResults").value || 50),
    country_indeed: document.querySelector("#collectCountry").value || "usa",
    is_remote: document.querySelector("#collectRemote").checked,
  };
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll(".view").forEach((node) => {
    node.classList.toggle("is-visible", node.id === `${view}View`);
  });
  document.querySelectorAll(".nav-item").forEach((node) => {
    node.classList.toggle("is-active", node.dataset.view === view);
  });
  els.viewTitle.textContent = view[0].toUpperCase() + view.slice(1);
}

function getSearchPayload() {
  const remoteValue = document.querySelector("#remoteInput").value;
  return {
    keyword: document.querySelector("#keywordInput").value || null,
    company: document.querySelector("#companyInput").value || null,
    location: document.querySelector("#locationInput").value || null,
    source: document.querySelector("#sourceInput").value || null,
    remote: remoteValue === "" ? null : remoteValue === "true",
    min_salary: document.querySelector("#minSalaryInput").value
      ? Number(document.querySelector("#minSalaryInput").value)
      : null,
    max_salary: document.querySelector("#maxSalaryInput").value
      ? Number(document.querySelector("#maxSalaryInput").value)
      : null,
    limit: 250,
    offset: 0,
  };
}

async function searchJobs(event) {
  event.preventDefault();
  try {
    state.jobs = await api("/search", {
      method: "POST",
      body: JSON.stringify(getSearchPayload()),
    });
    renderOverview();
    renderJobs();
    switchView("jobs");
    showToast("Search results updated.");
  } catch (error) {
    showToast("Search failed.");
  }
}

function selectedSites() {
  return [...document.querySelectorAll("#collectForm fieldset input:checked")].map((input) => input.value);
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
  els.collectOutput.textContent = "Collecting latest jobs from selected job boards. This can take a few minutes.";
  try {
    const result = await api("/collect", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    els.collectOutput.textContent = [
      `Search run: ${result.search_run_id}`,
      `Jobs seen: ${result.jobs_seen}`,
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
    job.job_type || "Type not listed",
    `Posted ${shortDate(job.date_posted)}`,
    job.is_remote ? "Remote" : "Location based",
  ]
    .map((item) => `<span class="tag">${escapeHtml(item)}</span>`)
    .join("");
  els.drawerDescription.textContent = job.description || "No description captured yet.";
  els.drawerLink.href = job.job_url || "#";
  els.drawer.classList.add("is-open");
  els.drawer.setAttribute("aria-hidden", "false");
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
document.querySelector("#searchForm").addEventListener("submit", searchJobs);
document.querySelector("#collectForm").addEventListener("submit", collectJobs);
document.querySelector("#drawerClose").addEventListener("click", closeDrawer);

document.body.addEventListener("click", (event) => {
  const target = event.target.closest("[data-job-id]");
  if (target) openDrawer(target.dataset.jobId);
});

loadData();
