import { getJson } from "./http.js";
import type { RepoStats } from "../types.js";

/**
 * Repository stats, for tracking the metric that actually matters.
 *
 * Stars are the number everyone watches and the weakest signal there is. The
 * Claude for OSS Ecosystem Impact Track is assessed on whether a project is
 * depended upon — so `outsideContributors` is the number to care about, and
 * it's the one this reports first.
 *
 * Works unauthenticated at 60 requests/hour. Set GITHUB_TOKEN for 5,000.
 */

interface RepoResponse {
  stargazers_count: number;
  forks_count: number;
  subscribers_count: number;
  open_issues_count: number;
  owner: { login: string };
}

interface ContributorResponse {
  login: string;
  type: string;
}

function auth(): Record<string, string> {
  const token = process.env["GITHUB_TOKEN"];
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function fetchStats(repo: string): Promise<RepoStats> {
  const base = `https://api.github.com/repos/${repo}`;

  const info = await getJson<RepoResponse>(base, auth());
  const contributors = await getJson<ContributorResponse[]>(
    `${base}/contributors?per_page=100`,
    auth(),
  ).catch(() => [] as ContributorResponse[]);

  // Bots inflate this and the owner isn't an outside contributor.
  const people = contributors
    .filter((c) => c.type !== "Bot")
    .map((c) => c.login)
    .filter((login) => login.toLowerCase() !== info.owner.login.toLowerCase());

  return {
    stars: info.stargazers_count,
    forks: info.forks_count,
    watchers: info.subscribers_count,
    openIssues: info.open_issues_count,
    outsideContributors: people.length,
    contributors: people,
  };
}

/** Honest read on where a project stands against the program's bar. */
export function assessEligibility(stats: RepoStats): string[] {
  const notes: string[] = [];

  notes.push(
    stats.stars >= 5000
      ? `${stats.stars} stars — clears the Maintainer Track bar.`
      : `${stats.stars} stars — Maintainer Track needs 5,000. ${(5000 - stats.stars).toLocaleString()} to go.`,
  );

  if (stats.outsideContributors === 0) {
    notes.push(
      "No outside contributors yet. This is the number that decides an Ecosystem " +
        "Impact application — a project with one author reads as a personal tool.",
    );
  } else if (stats.outsideContributors < 3) {
    notes.push(
      `${stats.outsideContributors} outside contributor(s). Three or more is where a ` +
        "project starts reading as infrastructure rather than a personal project.",
    );
  } else {
    notes.push(
      `${stats.outsideContributors} outside contributors — this is the strongest ` +
        "thing you can put in an Ecosystem Impact case. Name them in the application.",
    );
  }

  if (stats.openIssues === 0) {
    notes.push(
      "No open issues. An arriving contributor has nowhere to start — seed some " +
        "`good first issue` tickets.",
    );
  }
  return notes;
}
