import type { MetadataRoute } from "next";

import { EXAMS } from "@/lib/exam-photo/specs";
import { comparePages, RIVAL } from "@/lib/seo/alternatives";
import { COMPRESS_TARGETS } from "@/lib/seo/compress-targets";
import { SITE_ORIGIN, siteUrl } from "@/lib/site";
import { TOOLS } from "@/lib/tools";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: SITE_ORIGIN + "/",
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: siteUrl("/tools"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: siteUrl("/privacy"),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    ...TOOLS.map((tool) => ({
      url: siteUrl(`/tools/${tool.slug}`),
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.9,
    })),
    ...COMPRESS_TARGETS.map((target) => ({
      url: siteUrl(`/${target.slug}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...EXAMS.map((exam) => ({
      url: siteUrl(`/exam-photo/${exam.slug}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    {
      url: siteUrl("/alternatives"),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: siteUrl(`/alternatives/${RIVAL.slug}`),
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    ...comparePages().map((row) => ({
      url: siteUrl(`/alternatives/${RIVAL.slug}/${row.slug}`),
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];
}
