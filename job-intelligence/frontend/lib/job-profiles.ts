export type JobProfile = {
  id: string;
  name: string;
  searchTerm: string;
  locations: string;
  preferredTitles: string[];
  skills: string[];
  baseResume: string;
};

export const defaultProfiles: JobProfile[] = [
  {
    id: "dotnet",
    name: ".NET Developer",
    searchTerm: ".NET Developer OR Dotnet Developer OR C# Developer OR ASP.NET Core Developer OR Senior .NET Developer OR Senior Backend .NET Developer OR Senior Software Engineer .NET OR Senior Software Engineer C# OR .NET Backend Engineer OR .NET Full Stack Developer OR Azure .NET Developer",
    locations: "Remote, Dallas, TX, DFW, Austin, Houston, San Antonio",
    preferredTitles: [
      ".NET Developer",
      "Dotnet Developer",
      "C# Developer",
      "ASP.NET Core Developer",
      "Senior .NET Developer",
      "Senior Backend .NET Developer",
      "Senior Software Engineer .NET",
      "Senior Software Engineer C#",
      ".NET Backend Engineer",
      ".NET Full Stack Developer",
      "Azure .NET Developer",
    ],
    skills: ["C#", ".NET", ".NET Core", "ASP.NET Core", "Azure", "SQL", "React", "API"],
    baseResume: "",
  },
  {
    id: "java",
    name: "Java Developer",
    searchTerm: "Senior Java Developer OR Senior Backend Java Developer OR Senior Software Engineer Java OR Java Full Stack Developer OR Spring Boot Developer OR Java Cloud Developer OR Microservices Java Developer OR Lead Java Developer OR Principal Java Developer OR Java Solutions Architect OR Senior Java Engineer OR Java Application Developer",
    locations: "United States, Remote",
    preferredTitles: [
      "Senior Java Developer",
      "Senior Backend Java Developer",
      "Senior Software Engineer Java",
      "Java Full Stack Developer",
      "Spring Boot Developer",
      "Java Cloud Developer",
      "Microservices Java Developer",
      "Lead Java Developer",
      "Principal Java Developer",
      "Java Solutions Architect",
      "Senior Java Engineer",
      "Java Application Developer",
    ],
    skills: ["Java", "Spring Boot", "Microservices", "Kafka", "AWS", "Azure", "SQL", "REST API"],
    baseResume: "",
  },
];

export function loadProfiles(): JobProfile[] {
  if (typeof window === "undefined") return defaultProfiles;
  const stored = window.localStorage.getItem("job-intelligence-profiles-v3");
  if (!stored) return defaultProfiles;
  try {
    const parsed = JSON.parse(stored) as JobProfile[];
    return parsed.length ? parsed : defaultProfiles;
  } catch {
    return defaultProfiles;
  }
}

export function saveProfiles(profiles: JobProfile[]) {
  window.localStorage.setItem("job-intelligence-profiles-v3", JSON.stringify(profiles));
}

export function expandSearchTerm(searchTerm: string) {
  const value = searchTerm.trim();
  if (!value) return value;
  // Already an OR query (profile-generated) — use as-is.
  if (value.includes(" OR ")) return value;
  const lower = value.toLowerCase();
  if (lower.includes(".net") || lower.includes("c#") || lower.includes("asp.net")) {
    return [
      value,
      "Dotnet Developer",
      "C#",
      "ASP.NET Core",
      ".NET Core",
      "Senior .NET Developer",
      "Senior Backend .NET Developer",
      "Azure .NET Developer",
      "Senior Software Engineer .NET",
      "Senior Software Engineer C#",
      ".NET Backend Engineer",
      ".NET Full Stack Developer",
      "Senior Backend Developer C#",
      ".NET Solutions Architect",
      "Lead .NET Developer",
    ].join(" OR ");
  }
  if (lower.includes("java")) {
    return [
      value,
      "Spring Boot",
      "Senior Software Engineer Java",
      "Backend Java Developer",
      "Java Full Stack Developer",
      "Microservices Java",
      "Java Cloud Developer",
      "Lead Java Developer",
    ].join(" OR ");
  }
  return value;
}

export function compactLocation(profile: JobProfile | undefined) {
  if (!profile) return "United States";
  return profile.locations || "United States";
}
