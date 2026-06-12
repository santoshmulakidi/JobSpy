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
    searchTerm: ".NET developer",
    locations: "Remote, Dallas, TX, DFW, Austin, Houston, San Antonio",
    preferredTitles: [
      "Senior .NET Developer",
      "Senior Full Stack .NET Developer",
      "Senior C# Developer",
      "Senior Azure Developer",
      "Senior Software Engineer .NET",
      ".NET Cloud Developer",
      "Senior ASP.NET Core Developer",
      "Senior Backend Developer C#",
      ".NET Solutions Architect",
      "Azure Application Architect",
      "Principal .NET Developer",
      "Lead .NET Developer",
    ],
    skills: ["C#", ".NET", ".NET Core", "ASP.NET Core", "Azure", "SQL", "React", "API"],
    baseResume: "",
  },
  {
    id: "java",
    name: "Java Developer",
    searchTerm: "Java developer",
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
    ],
    skills: ["Java", "Spring Boot", "Microservices", "Kafka", "AWS", "Azure", "SQL", "REST API"],
    baseResume: "",
  },
];

export function loadProfiles(): JobProfile[] {
  if (typeof window === "undefined") return defaultProfiles;
  const stored = window.localStorage.getItem("job-intelligence-profiles-v1");
  if (!stored) return defaultProfiles;
  try {
    const parsed = JSON.parse(stored) as JobProfile[];
    return parsed.length ? parsed : defaultProfiles;
  } catch {
    return defaultProfiles;
  }
}

export function saveProfiles(profiles: JobProfile[]) {
  window.localStorage.setItem("job-intelligence-profiles-v1", JSON.stringify(profiles));
}

export function expandSearchTerm(searchTerm: string) {
  const value = searchTerm.trim();
  const lower = value.toLowerCase();
  if (!value) return value;
  if (lower.includes(".net") || lower.includes("c#") || lower.includes("asp.net")) {
    return [
      value,
      "C#",
      "ASP.NET Core",
      ".NET Core",
      "Azure Developer",
      "Senior Software Engineer .NET",
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
